"use strict";
/**
 * Minimal PostgreSQL client for the production runtime. No dependencies (the npm `pg` package cannot be installed
 * in the locked-down build environment, and adding it was explicitly not to be used to hide that problem).
 *
 * Implements the v3 wire protocol: startup, SCRAM-SHA-256 (the Postgres 14+ default), cleartext and MD5 password auth,
 * optional TLS (sslmode=require|verify-full), and the extended query protocol so every value is sent as a bound
 * parameter (no string interpolation of user data anywhere). Results are returned as { rows, rowCount, fields }.
 *
 * Never falls back to anything: if the database cannot answer, the call rejects with a categorised PgError.
 */

const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

class PgError extends Error {
  /** code: PG_NOT_CONFIGURED | PG_CONNECT_FAILED | PG_TLS_FAILED | PG_AUTH_FAILED | PG_TIMEOUT | PG_CONNECTION_LOST |
   *        PG_PROTOCOL_ERROR | PG_QUERY_ERROR | PG_POOL_EXHAUSTED | PG_CLOSED. sqlState is set for PG_QUERY_ERROR. */
  constructor(code, message, extra = {}) {
    super(`[${code}] ${message}`);
    this.name = "PgError";
    this.code = code;
    if (extra.sqlState) this.sqlState = extra.sqlState;
  }
}

function parsePgUrl(url) {
  if (!url || typeof url !== "string") throw new PgError("PG_NOT_CONFIGURED", "DATABASE_URL is not set");
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    throw new PgError("PG_NOT_CONFIGURED", "DATABASE_URL is not a valid URL");
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    throw new PgError("PG_NOT_CONFIGURED", `unsupported scheme ${u.protocol}`);
  }
  const database = decodeURIComponent((u.pathname || "").replace(/^\//, ""));
  if (!u.username) throw new PgError("PG_NOT_CONFIGURED", "DATABASE_URL has no user");
  if (!database) throw new PgError("PG_NOT_CONFIGURED", "DATABASE_URL has no database name");
  const sslmode = (u.searchParams.get("sslmode") || "disable").toLowerCase();
  if (!["disable", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) {
    throw new PgError("PG_NOT_CONFIGURED", `unsupported sslmode ${sslmode}`);
  }
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: u.password ? decodeURIComponent(u.password) : "",
    database,
    sslmode
  };
}

// ---------- wire helpers ----------
function int32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}
function int16(n) {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
}
function cstr(s) {
  return Buffer.concat([Buffer.from(String(s), "utf8"), Buffer.from([0])]);
}
function frame(type, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
}
function readCString(buf, pos) {
  const end = buf.indexOf(0, pos);
  if (end === -1) throw new PgError("PG_PROTOCOL_ERROR", "unterminated string in message");
  return { value: buf.toString("utf8", pos, end), next: end + 1 };
}
function parseErrorFields(body) {
  const f = {};
  let p = 0;
  while (p < body.length && body[p] !== 0) {
    const code = String.fromCharCode(body[p]);
    const { value, next } = readCString(body, p + 1);
    f[code] = value;
    p = next;
  }
  return f; // S severity, C sqlstate, M message
}

function parseValue(oid, text) {
  if (text === null) return null;
  switch (oid) {
    case 16:
      return text === "t";
    case 20: {
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : text; // bigint beyond 2^53 stays a string rather than losing precision
    }
    case 21:
    case 23:
    case 26:
    case 700:
    case 701:
      return Number(text);
    case 114:
    case 3802:
      return JSON.parse(text);
    case 1114: // timestamp (no tz): treated as UTC
      return new Date(text.replace(" ", "T") + "Z").toISOString();
    case 1184: // timestamptz
      return new Date(text).toISOString();
    default:
      return text;
  }
}

function encodeParam(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v); // objects/arrays are sent as JSON text (for json/jsonb columns)
  return String(v);
}

// ---------- SCRAM-SHA-256 ----------
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}
function scramClientFirst() {
  const nonce = crypto.randomBytes(18).toString("base64");
  return { nonce, bare: `n=,r=${nonce}`, message: `n,,n=,r=${nonce}` };
}
function scramClientFinal(password, state, serverFirst) {
  const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
  if (!attrs.r || !attrs.s || !attrs.i) throw new PgError("PG_PROTOCOL_ERROR", "malformed SCRAM server-first message");
  if (!attrs.r.startsWith(state.nonce)) throw new PgError("PG_AUTH_FAILED", "SCRAM server nonce mismatch");
  const iterations = Number(attrs.i);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
    throw new PgError("PG_PROTOCOL_ERROR", "SCRAM iteration count out of range");
  }
  const salt = Buffer.from(attrs.s, "base64");
  const salted = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = hmac(salted, "Client Key");
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const withoutProof = `c=biws,r=${attrs.r}`;
  const authMessage = `${state.bare},${serverFirst},${withoutProof}`;
  const proof = xor(clientKey, hmac(storedKey, authMessage));
  const serverKey = hmac(salted, "Server Key");
  return {
    message: `${withoutProof},p=${proof.toString("base64")}`,
    expectedServerSignature: hmac(serverKey, authMessage).toString("base64")
  };
}

// ---------- connection ----------
class PgConnection {
  constructor(target, opts = {}) {
    this.target = target;
    this.opts = { connectTimeoutMs: 3000, queryTimeoutMs: 10000, ...opts };
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.handler = null;
    this.alive = false;
    this.busy = false;
  }

  async connect() {
    await this._openSocket();
    await this._startup();
    this.alive = true;
  }

  _openSocket() {
    const { host, port, sslmode } = this.target;
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      let done = false;
      const fail = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sock.destroy();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(new PgError("PG_CONNECT_FAILED", `connect timed out after ${this.opts.connectTimeoutMs}ms`)),
        this.opts.connectTimeoutMs
      );
      sock.once("error", (e) => fail(new PgError("PG_CONNECT_FAILED", String(e.code || e.message))));
      sock.once("connect", () => {
        sock.setNoDelay(true);
        sock.setKeepAlive(true, 15000);
        if (sslmode === "disable") {
          done = true;
          clearTimeout(timer);
          this._attach(sock);
          return resolve();
        }
        // SSLRequest
        sock.write(Buffer.concat([int32(8), int32(80877103)]));
        sock.once("data", (d) => {
          const answer = String.fromCharCode(d[0]);
          if (answer === "S") {
            const secure = tls.connect({
              socket: sock,
              servername: net.isIP(host) ? undefined : host,
              rejectUnauthorized: sslmode === "verify-full" || sslmode === "verify-ca"
            });
            secure.once("error", (e) => fail(new PgError("PG_TLS_FAILED", String(e.code || e.message))));
            secure.once("secureConnect", () => {
              done = true;
              clearTimeout(timer);
              this._attach(secure);
              resolve();
            });
          } else if (sslmode === "prefer") {
            done = true;
            clearTimeout(timer);
            this._attach(sock);
            resolve();
          } else {
            fail(new PgError("PG_TLS_FAILED", `server does not support TLS but sslmode=${sslmode}`));
          }
        });
      });
    });
  }

  _attach(sock) {
    this.sock = sock;
    sock.removeAllListeners("error");
    sock.on("data", (c) => this._onData(c));
    sock.on("error", (e) => this._lost(new PgError("PG_CONNECTION_LOST", String(e.code || e.message))));
    sock.on("close", () => this._lost(new PgError("PG_CONNECTION_LOST", "connection closed")));
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      while (this.buf.length >= 5) {
        const len = this.buf.readInt32BE(1);
        if (len < 4) throw new PgError("PG_PROTOCOL_ERROR", "bad message length");
        if (this.buf.length < 1 + len) break;
        const type = String.fromCharCode(this.buf[0]);
        const body = this.buf.subarray(5, 1 + len);
        this.buf = this.buf.subarray(1 + len);
        if (type === "N" || type === "S" || type === "K") continue; // notice / parameter status / backend key
        if (this.handler) this.handler(type, body);
      }
    } catch (e) {
      this._lost(e instanceof PgError ? e : new PgError("PG_PROTOCOL_ERROR", e.message));
    }
  }

  _lost(err) {
    this.alive = false;
    const h = this.onLost;
    this.onLost = null;
    this.handler = null;
    if (this.sock) this.sock.destroy();
    this.sock = null;
    if (h) h(err);
  }

  /**
   * Send `bytes`, feed incoming messages to `onMessage(type, body, finish)` until finish()/fail() is called.
   * A timeout destroys the connection (a late reply would otherwise be read as the next command's reply).
   */
  _exchange(bytes, onMessage, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new PgError("PG_CONNECTION_LOST", "not connected"));
      let settled = false;
      const settle = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.handler = null;
        this.onLost = null;
        fn(v);
      };
      const timer = setTimeout(() => {
        const e = new PgError("PG_TIMEOUT", `no response within ${timeoutMs}ms`);
        settle(reject, e);
        this._lost(e);
      }, timeoutMs);
      this.onLost = (err) => settle(reject, err);
      this.handler = (type, body) => {
        try {
          onMessage(type, body, (v) => settle(resolve, v), (e) => settle(reject, e));
        } catch (e) {
          settle(reject, e instanceof PgError ? e : new PgError("PG_PROTOCOL_ERROR", e.message));
        }
      };
      if (bytes) this.sock.write(bytes);
    });
  }

  _startup() {
    const { user, database, password } = this.target;
    const params = Buffer.concat([cstr("user"), cstr(user), cstr("database"), cstr(database), cstr("client_encoding"), cstr("UTF8"), cstr("application_name"), cstr("shords-backend"), Buffer.from([0])]);
    const startup = Buffer.concat([int32(params.length + 8), int32(196608), params]);
    let scram = null;
    let pendingError = null;
    return this._exchange(
      startup,
      (type, body, finish, fail) => {
        if (type === "R") {
          const code = body.readInt32BE(0);
          if (code === 0) return; // AuthenticationOk
          if (code === 3) return this.sock.write(frame("p", cstr(password)));
          if (code === 5) {
            const salt = body.subarray(4, 8);
            const inner = crypto.createHash("md5").update(password + user).digest("hex");
            const outer = crypto.createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
            return this.sock.write(frame("p", cstr("md5" + outer)));
          }
          if (code === 10) {
            const mechs = body.subarray(4).toString("utf8").split("\0").filter(Boolean);
            if (!mechs.includes("SCRAM-SHA-256")) return fail(new PgError("PG_AUTH_FAILED", "server offers no supported SASL mechanism"));
            scram = scramClientFirst();
            const initial = Buffer.from(scram.message);
            return this.sock.write(frame("p", cstr("SCRAM-SHA-256"), int32(initial.length), initial));
          }
          if (code === 11) {
            if (!scram) return fail(new PgError("PG_PROTOCOL_ERROR", "unexpected SASLContinue"));
            const out = scramClientFinal(password, scram, body.subarray(4).toString("utf8"));
            scram.expected = out.expectedServerSignature;
            return this.sock.write(frame("p", Buffer.from(out.message)));
          }
          if (code === 12) {
            const v = body.subarray(4).toString("utf8");
            if (!scram || v !== `v=${scram.expected}`) return fail(new PgError("PG_AUTH_FAILED", "SCRAM server signature mismatch"));
            return;
          }
          return fail(new PgError("PG_AUTH_FAILED", `unsupported authentication method (${code})`));
        }
        if (type === "E") {
          const f = parseErrorFields(body);
          const authFailure = f.C === "28P01" || f.C === "28000";
          pendingError = new PgError(authFailure ? "PG_AUTH_FAILED" : "PG_CONNECT_FAILED", `${f.S || "ERROR"} ${f.C || ""}: ${f.M || "startup failed"}`, { sqlState: f.C });
          return fail(pendingError);
        }
        if (type === "Z") return finish();
      },
      this.opts.connectTimeoutMs
    );
  }

  /** Extended protocol with bound text parameters. */
  query(text, params = [], timeoutMs = this.opts.queryTimeoutMs) {
    const encoded = params.map(encodeParam);
    const bind = Buffer.concat([
      cstr(""),
      cstr(""),
      int16(0),
      int16(encoded.length),
      ...encoded.map((p) => (p === null ? int32(-1) : Buffer.concat([int32(Buffer.byteLength(p)), Buffer.from(p, "utf8")]))),
      int16(0)
    ]);
    const bytes = Buffer.concat([
      frame("P", cstr(""), cstr(text), int16(0)),
      frame("B", bind),
      frame("D", Buffer.from("P"), cstr("")),
      frame("E", cstr(""), int32(0)),
      frame("S")
    ]);
    return this._collect(bytes, timeoutMs);
  }

  /** Simple protocol: may contain several statements, no parameters. For migrations only. */
  simple(sql, timeoutMs = this.opts.queryTimeoutMs) {
    return this._collect(frame("Q", cstr(sql)), timeoutMs);
  }

  _collect(bytes, timeoutMs) {
    let fields = null;
    const rows = [];
    let rowCount = 0;
    let error = null;
    return this._exchange(
      bytes,
      (type, body, finish, fail) => {
        if (type === "T") {
          let p = 0;
          const n = body.readInt16BE(p);
          p += 2;
          fields = [];
          for (let i = 0; i < n; i++) {
            const { value: name, next } = readCString(body, p);
            p = next + 4 + 2; // tableOid, column attr
            const oid = body.readInt32BE(p);
            p += 4 + 2 + 4 + 2; // typeOid, typlen, typmod, format
            fields.push({ name, oid });
          }
        } else if (type === "D") {
          const n = body.readInt16BE(0);
          let p = 2;
          const row = {};
          for (let i = 0; i < n; i++) {
            const len = body.readInt32BE(p);
            p += 4;
            let text = null;
            if (len >= 0) {
              text = body.toString("utf8", p, p + len);
              p += len;
            }
            row[fields[i].name] = parseValue(fields[i].oid, text);
          }
          rows.push(row);
        } else if (type === "C") {
          const tag = readCString(body, 0).value;
          const m = /(\d+)$/.exec(tag);
          if (m) rowCount = Number(m[1]);
        } else if (type === "E") {
          const f = parseErrorFields(body);
          error = new PgError("PG_QUERY_ERROR", `${f.S || "ERROR"} ${f.C || ""}: ${f.M || "query failed"}`, { sqlState: f.C });
        } else if (type === "Z") {
          if (error) return fail(error);
          return finish({ rows, rowCount, fields: fields || [] });
        }
        // '1' '2' 'n' 'I' 's' 't': ParseComplete, BindComplete, NoData, EmptyQuery, ... carry nothing we need
      },
      timeoutMs
    );
  }

  close() {
    this.alive = false;
    if (this.sock) {
      try {
        this.sock.write(frame("X"));
      } catch (_) {
        /* ignore */
      }
      this.sock.destroy();
      this.sock = null;
    }
  }
}

// ---------- pool ----------
class PgPool {
  /**
   * @param {object} opts
   * @param {string} opts.url
   * @param {number} [opts.max=5]
   * @param {number} [opts.connectTimeoutMs=3000]
   * @param {number} [opts.queryTimeoutMs=10000]
   * @param {number} [opts.acquireTimeoutMs=5000]
   */
  constructor(opts = {}) {
    this.opts = { max: 5, connectTimeoutMs: 3000, queryTimeoutMs: 10000, acquireTimeoutMs: 5000, ...opts };
    this.target = parsePgUrl(opts.url); // throws PG_NOT_CONFIGURED for a missing/invalid URL
    this.idle = [];
    this.total = 0;
    this.waiters = [];
    this.closed = false;
  }

  async _acquire() {
    if (this.closed) throw new PgError("PG_CLOSED", "pool is closed");
    while (this.idle.length) {
      const c = this.idle.pop();
      if (c.alive) {
        c.busy = true;
        return c;
      }
      this.total--;
    }
    if (this.total < this.opts.max) {
      this.total++;
      const c = new PgConnection(this.target, this.opts);
      try {
        await c.connect();
      } catch (e) {
        this.total--;
        c.close();
        throw e;
      }
      c.busy = true;
      return c;
    }
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new PgError("PG_POOL_EXHAUSTED", `no connection available within ${this.opts.acquireTimeoutMs}ms`));
      }, this.opts.acquireTimeoutMs);
      this.waiters.push(w);
    });
  }

  _release(c) {
    c.busy = false;
    if (!c.alive) {
      this.total--;
      c.close();
      // a slot freed up: let a waiter try to open a fresh connection
      const w = this.waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        this._acquire().then(w.resolve, w.reject);
      }
      return;
    }
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      c.busy = true;
      return w.resolve(c);
    }
    this.idle.push(c);
  }

  async query(text, params = []) {
    const c = await this._acquire();
    try {
      return await c.query(text, params, this.opts.queryTimeoutMs);
    } finally {
      this._release(c);
    }
  }

  /** Exclusive connection, for transactions and session-level advisory locks. fn receives { query, simple }. */
  async withClient(fn) {
    const c = await this._acquire();
    try {
      return await fn({
        query: (t, p) => c.query(t, p || [], this.opts.queryTimeoutMs),
        simple: (s) => c.simple(s, this.opts.queryTimeoutMs)
      });
    } finally {
      this._release(c);
    }
  }

  async transaction(fn) {
    return this.withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const r = await fn(c);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        try {
          await c.query("ROLLBACK");
        } catch (_) {
          /* connection may already be gone */
        }
        throw e;
      }
    });
  }

  /** Does not throw. `ok` is true only when SELECT 1 returned 1. */
  async ping() {
    const started = Date.now();
    try {
      const r = await this.query("SELECT 1 AS ok");
      return { ok: r.rows[0] && r.rows[0].ok === 1, latencyMs: Date.now() - started };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, error: e.code || "PG_ERROR" };
    }
  }

  async end() {
    this.closed = true;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new PgError("PG_CLOSED", "pool closed"));
    }
    this.waiters = [];
    for (const c of this.idle) c.close();
    this.idle = [];
  }
}

module.exports = { PgPool, PgConnection, PgError, parsePgUrl, parseValue, encodeParam };
