"use strict";
/**
 * Minimal Redis client (RESP2) for the production runtime. No dependencies.
 *
 * Why this exists: the older TypeScript adapter (services/redisCacheAdapter.ts) sends inline commands, cannot
 * authenticate, cannot carry values containing spaces, and silently falls back to per-process maps when Redis
 * is unreachable, which makes "distributed" rate limits and locks per-replica without any signal. This client
 * never falls back: if Redis cannot answer, the call rejects with a categorised error and the caller decides.
 *
 * Supported: redis://[user]:[password]@host:port[/db]   plain TCP (Railway private network and Railway's TCP proxy are plain TCP)
 *            rediss://[user]:[password]@host:port[/db]  TLS, ALWAYS with certificate and host-name verification (system CAs,
 *                                                       or the PEM in `tlsCa` / REDIS_TLS_CA for a private CA). There is deliberately
 *                                                       no "skip verification" switch.
 * One connection per client, commands pipelined in FIFO order, per-command timeout, lazy (re)connect.
 * Use `duplicate()` for a dedicated connection when issuing blocking commands (BRPOP).
 */

const net = require("net");
const tls = require("tls");

class RedisError extends Error {
  /** code: REDIS_NOT_CONFIGURED | REDIS_TLS_UNSUPPORTED | REDIS_CONNECT_FAILED | REDIS_AUTH_FAILED | REDIS_TIMEOUT |
   *        REDIS_CONNECTION_LOST | REDIS_PROTOCOL_ERROR | REDIS_COMMAND_ERROR | REDIS_CLOSED */
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "RedisError";
    this.code = code;
  }
}

/** An error reply from the server ("-ERR ..."), carried as a value until a command promise rejects with it. */
class RedisReplyError extends Error {
  constructor(line) {
    super(line);
    this.name = "RedisReplyError";
  }
}

function parseRedisUrl(url) {
  if (!url || typeof url !== "string") throw new RedisError("REDIS_NOT_CONFIGURED", "REDIS_URL is not set");
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    throw new RedisError("REDIS_NOT_CONFIGURED", "REDIS_URL is not a valid URL");
  }
  if (u.protocol !== "redis:" && u.protocol !== "rediss:") throw new RedisError("REDIS_NOT_CONFIGURED", `unsupported scheme ${u.protocol}`);
  const db = u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) throw new RedisError("REDIS_NOT_CONFIGURED", "REDIS_URL database index is invalid");
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : "",
    password: u.password ? decodeURIComponent(u.password) : "",
    db,
    tls: u.protocol === "rediss:"
  };
}

function encodeCommand(args) {
  const chunks = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.isBuffer(a) ? a : Buffer.from(String(a), "utf8");
    chunks.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

/** Parse one reply starting at `pos`. Returns { value, next } or null when more bytes are needed. */
function parseReply(buf, pos) {
  if (pos >= buf.length) return null;
  const type = String.fromCharCode(buf[pos]);
  const eol = buf.indexOf("\r\n", pos + 1);
  if (eol === -1) return null;
  const line = buf.toString("utf8", pos + 1, eol);
  const next = eol + 2;
  switch (type) {
    case "+":
      return { value: line, next };
    case "-":
      return { value: new RedisReplyError(line), next };
    case ":":
      return { value: Number(line), next };
    case "$": {
      const len = Number(line);
      if (len === -1) return { value: null, next };
      if (!Number.isInteger(len) || len < 0) throw new RedisError("REDIS_PROTOCOL_ERROR", "bad bulk length");
      if (buf.length < next + len + 2) return null;
      return { value: buf.toString("utf8", next, next + len), next: next + len + 2 };
    }
    case "*": {
      const n = Number(line);
      if (n === -1) return { value: null, next };
      if (!Number.isInteger(n) || n < 0) throw new RedisError("REDIS_PROTOCOL_ERROR", "bad array length");
      const out = [];
      let p = next;
      for (let i = 0; i < n; i++) {
        const r = parseReply(buf, p);
        if (!r) return null;
        out.push(r.value);
        p = r.next;
      }
      return { value: out, next: p };
    }
    default:
      throw new RedisError("REDIS_PROTOCOL_ERROR", `unexpected reply type byte 0x${buf[pos].toString(16)}`);
  }
}

class RedisClient {
  /**
   * @param {object} opts
   * @param {string} opts.url
   * @param {number} [opts.connectTimeoutMs=2000]
   * @param {number} [opts.commandTimeoutMs=2000]
   */
  constructor(opts = {}) {
    this.opts = { connectTimeoutMs: 2000, commandTimeoutMs: 2000, ...opts };
    this.target = parseRedisUrl(opts.url); // throws a categorised error for a missing/invalid/TLS URL
    this.sock = null;
    this.ready = false;
    this.connecting = null;
    this.pending = [];
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.lastConnectFailure = null; // { at, error }
  }

  duplicate(overrides = {}) {
    return new RedisClient({ ...this.opts, ...overrides });
  }

  /** Does not throw; `ok` is true only when the server answered PONG. */
  async ping() {
    const started = Date.now();
    try {
      const r = await this.command("PING");
      return { ok: r === "PONG", latencyMs: Date.now() - started };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, error: e.code || "REDIS_ERROR" };
    }
  }

  async command(...args) {
    return this._commandWithTimeout(this.opts.commandTimeoutMs, args);
  }

  /** Atomic server-side script. */
  async eval(script, keys, argv) {
    return this.command("EVAL", script, keys.length, ...keys, ...argv);
  }

  async _commandWithTimeout(timeoutMs, args) {
    if (this.closed) throw new RedisError("REDIS_CLOSED", "client is closed");
    await this._ensureConnected();
    return this._send(args, timeoutMs);
  }

  _ensureConnected() {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const recent = this.lastConnectFailure;
    if (recent && Date.now() - recent.at < 300) return Promise.reject(recent.error); // do not hammer a dead server
    this.connecting = this._connect()
      .then(() => {
        this.lastConnectFailure = null;
      })
      .catch((e) => {
        this.lastConnectFailure = { at: Date.now(), error: e };
        throw e;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const { host, port } = this.target;
      const useTls = this.target.tls;
      // TLS: verified against the system trust store (or REDIS_TLS_CA); the server name is checked unless the host is a bare IP
      // (then the certificate must list that IP). rejectUnauthorized is never turned off.
      const sock = useTls
        ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: true, ...(this.opts.tlsCa ? { ca: this.opts.tlsCa } : {}), minVersion: "TLSv1.2" })
        : net.createConnection({ host, port });
      this.sock = sock;
      this.buf = Buffer.alloc(0);
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 15000);

      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(new RedisError("REDIS_CONNECT_FAILED", `connect timed out after ${this.opts.connectTimeoutMs}ms`)),
        this.opts.connectTimeoutMs
      );

      // Every handler checks that this socket is still the client's current one: a discarded socket's late 'close'
      // event must not tear down the connection that replaced it.
      sock.on("data", (chunk) => {
        if (this.sock === sock) this._onData(chunk);
      });
      sock.on("error", (e) => {
        if (!settled) return fail(new RedisError("REDIS_CONNECT_FAILED", `${e.code || e.message}`));
        if (this.sock === sock) this._teardown(new RedisError("REDIS_CONNECTION_LOST", `${e.code || e.message}`));
      });
      sock.on("close", () => {
        if (!settled) return fail(new RedisError("REDIS_CONNECT_FAILED", "connection closed during connect"));
        if (this.sock === sock) this._teardown(new RedisError("REDIS_CONNECTION_LOST", "connection closed"));
      });
      sock.once(useTls ? "secureConnect" : "connect", async () => {
        try {
          const { username, password, db } = this.target;
          if (password) {
            const authArgs = username ? ["AUTH", username, password] : ["AUTH", password];
            await this._send(authArgs, this.opts.connectTimeoutMs, true);
          }
          if (db) await this._send(["SELECT", db], this.opts.connectTimeoutMs, true);
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.ready = true;
          resolve();
        } catch (e) {
          fail(e);
        }
      });
    });
  }

  _send(args, timeoutMs, internal = false) {
    return new Promise((resolve, reject) => {
      if (!this.sock || this.sock.destroyed) return reject(new RedisError("REDIS_CONNECTION_LOST", "not connected"));
      const entry = { resolve, reject, internal, timer: null };
      entry.timer = setTimeout(() => {
        // The reply may arrive later and would be matched to the wrong command, so the connection is discarded.
        this._teardown(new RedisError("REDIS_TIMEOUT", `command ${String(args[0]).toUpperCase()} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.push(entry);
      this.sock.write(encodeCommand(args));
    });
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      for (;;) {
        const r = parseReply(this.buf, 0);
        if (!r) break;
        this.buf = this.buf.subarray(r.next);
        const entry = this.pending.shift();
        if (!entry) continue; // unsolicited data; ignore
        clearTimeout(entry.timer);
        if (r.value instanceof RedisReplyError) {
          const m = r.value.message;
          const code = /^(WRONGPASS|NOAUTH|ERR invalid password|ERR AUTH)/.test(m) ? "REDIS_AUTH_FAILED" : "REDIS_COMMAND_ERROR";
          entry.reject(new RedisError(code, m));
        } else {
          entry.resolve(r.value);
        }
      }
    } catch (e) {
      this._teardown(e instanceof RedisError ? e : new RedisError("REDIS_PROTOCOL_ERROR", e.message));
    }
  }

  _teardown(err) {
    const sock = this.sock;
    this.sock = null;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    const pending = this.pending;
    this.pending = [];
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    if (sock) sock.destroy();
  }

  async close() {
    this.closed = true;
    this._teardown(new RedisError("REDIS_CLOSED", "client closed"));
  }
}

module.exports = { RedisClient, RedisError, parseRedisUrl, parseReply, encodeCommand };
