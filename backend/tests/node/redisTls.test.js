"use strict";
/**
 * rediss:// (TLS) against a real TLS-enabled redis-server started by the test with a throw-away private CA.
 * Skipped (not silently passed) when redis-server or openssl is not installed.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const { RedisClient } = require("../../data/redisClient");

const have = (bin, args = ["--version"]) => { try { return spawnSync(bin, args, { stdio: "ignore" }).status === 0; } catch (_) { return false; } };
const skip = !have("redis-server") || !have("openssl", ["version"]) ? "redis-server and openssl are required" : false;
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sh = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`); };

test("rediss:// TLS: verified connections work; unverifiable or mismatched certificates are refused; plain TCP to a TLS port fails", { skip }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shords-redis-tls-"));
  const mkCert = (name, san, ca = "ca") => {
    sh("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", "/CN=redis"], dir);
    fs.writeFileSync(path.join(dir, `${name}.ext`), `subjectAltName=${san}\n`);
    sh("openssl", ["x509", "-req", "-in", `${name}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`, "-CAcreateserial", "-out", `${name}.crt`, "-days", "2", "-extfile", `${name}.ext`], dir);
  };
  sh("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "2", "-subj", "/CN=shords-test-ca"], dir);
  sh("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "rogue.key", "-out", "rogue.crt", "-days", "2", "-subj", "/CN=rogue-ca"], dir);
  mkCert("good", "DNS:localhost,IP:127.0.0.1");
  mkCert("wrongname", "DNS:not-this-host.example");
  const port = await freePort();
  const start = async (cert) => {
    const child = spawn("redis-server", ["--port", "0", "--tls-port", String(port), "--bind", "127.0.0.1", "--tls-cert-file", path.join(dir, `${cert}.crt`), "--tls-key-file", path.join(dir, `${cert}.key`), "--tls-ca-cert-file", path.join(dir, "ca.crt"), "--tls-auth-clients", "no", "--requirepass", "tls-test-pass", "--save", ""], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("redis-server (TLS) did not start; this redis build may lack TLS")), 5000);
      child.stdout.on("data", (d) => { if (String(d).includes("Ready to accept")) { clearTimeout(timer); resolve(); } });
      child.on("exit", (c) => { clearTimeout(timer); reject(new Error(`redis-server exited ${c}`)); });
    });
    return child;
  };
  const stop = (c) => new Promise((r) => { c.once("exit", r); c.kill("SIGKILL"); });
  const ca = fs.readFileSync(path.join(dir, "ca.crt"), "utf8");
  const url = (host = "127.0.0.1", pw = "tls-test-pass") => `rediss://default:${pw}@${host}:${port}`;
  const mk = (u, extra = {}) => new RedisClient({ url: u, connectTimeoutMs: 1500, commandTimeoutMs: 1500, ...extra });
  const outcome = async (c, fn = () => c.command("PING")) => { try { return { ok: await fn() }; } catch (e) { return { err: e.code }; } finally { await c.close(); } };

  let server = await start("good");
  try {
    await t.test("trusted private CA: PING, AUTH, a value with spaces, a Lua script and a blocking-style duplicate all work over TLS", async () => {
      const c = mk(url(), { tlsCa: ca });
      assert.equal(await c.command("PING"), "PONG");
      await c.command("SET", "k", "value with  spaces\r\nand newline");
      assert.equal(await c.command("GET", "k"), "value with  spaces\r\nand newline");
      assert.equal(await c.eval("return redis.call('INCR', KEYS[1])", ["n"], []), 1);
      const d = c.duplicate();
      assert.equal(await d.command("PING"), "PONG");
      assert.equal((await c.ping()).ok, true);
      await d.close(); await c.close();
    });
    await t.test("wrong password over TLS is an auth failure, not a TLS failure", async () => {
      assert.deepEqual(await outcome(mk(url("127.0.0.1", "nope"), { tlsCa: ca })), { err: "REDIS_AUTH_FAILED" });
    });
    await t.test("a certificate that does not chain to a trusted CA is REFUSED (no silent downgrade, no skip-verify)", async () => {
      assert.deepEqual(await outcome(mk(url())), { err: "REDIS_CONNECT_FAILED" }, "system trust store does not know the private CA");
      assert.deepEqual(await outcome(mk(url(), { tlsCa: fs.readFileSync(path.join(dir, "rogue.crt"), "utf8") })), { err: "REDIS_CONNECT_FAILED" }, "a different CA does not vouch for it");
    });
    await t.test("the client has no switch that disables verification", () => {
      const src = fs.readFileSync(path.resolve(__dirname, "../../data/redisClient.js"), "utf8");
      assert.ok(!/rejectUnauthorized:\s*false/.test(src));
      assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(src));
    });
    await t.test("plain redis:// against a TLS-only port fails cleanly", async () => {
      const r = await outcome(mk(`redis://default:tls-test-pass@127.0.0.1:${port}`));
      assert.ok(["REDIS_CONNECT_FAILED", "REDIS_CONNECTION_LOST", "REDIS_TIMEOUT", "REDIS_PROTOCOL_ERROR"].includes(r.err), JSON.stringify(r));
    });
    await t.test("the TLS-error text never contains the password", async () => {
      let msg = "";
      try { await mk(url()).command("PING"); } catch (e) { msg = e.message; }
      assert.ok(msg && !msg.includes("tls-test-pass"));
    });
  } finally {
    await stop(server);
  }

  server = await start("wrongname");
  try {
    await t.test("a certificate for another host name is REFUSED even though the CA is trusted (host-name verification)", async () => {
      assert.deepEqual(await outcome(mk(url("localhost"), { tlsCa: ca })), { err: "REDIS_CONNECT_FAILED" });
      assert.deepEqual(await outcome(mk(url("127.0.0.1"), { tlsCa: ca })), { err: "REDIS_CONNECT_FAILED" });
    });
  } finally {
    await stop(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
