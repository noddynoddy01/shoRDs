"use strict";
/** Real PostgreSQL 16 (SCRAM-SHA-256) and real Redis 7 (open and password-protected). Skipped, loudly, when the infra is not configured. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { PgPool, PgError, parsePgUrl } = require("../../data/pgClient");
const { RedisClient, RedisError, parseRedisUrl, parseReply, encodeCommand } = require("../../data/redisClient");
const { runMigrations, schemaStatus, MIGRATIONS } = require("../../data/migrations");
const { INFRA, infraSkip, resetInfra } = require("./helpers");

const skip = infraSkip();
const RAUTH = process.env.TEST_REDIS_AUTH_URL || null;

test("URL parsing: missing / malformed / unsupported configuration is categorised, never defaulted", () => {
  assert.throws(() => parsePgUrl(undefined), (e) => e.code === "PG_NOT_CONFIGURED");
  assert.throws(() => parsePgUrl("not a url"), (e) => e.code === "PG_NOT_CONFIGURED");
  assert.throws(() => parsePgUrl("mysql://u:p@h/db"), (e) => e.code === "PG_NOT_CONFIGURED");
  assert.throws(() => parsePgUrl("postgresql://h/db"), (e) => e.code === "PG_NOT_CONFIGURED");
  assert.throws(() => parsePgUrl("postgresql://u:p@h/"), (e) => e.code === "PG_NOT_CONFIGURED");
  assert.throws(() => parsePgUrl("postgresql://u:p@h/db?sslmode=bogus"), (e) => e.code === "PG_NOT_CONFIGURED");
  assert.deepEqual(parsePgUrl("postgresql://us%40er:p%3Aw@h.example:6543/mydb?sslmode=require"), { host: "h.example", port: 6543, user: "us@er", password: "p:w", database: "mydb", sslmode: "require" });
  assert.throws(() => parseRedisUrl(""), (e) => e.code === "REDIS_NOT_CONFIGURED");
  assert.equal(parseRedisUrl("rediss://u:p@h:6380/2").tls, true);
  assert.equal(parseRedisUrl("redis://h:6380").tls, false);
  assert.throws(() => parseRedisUrl("http://h"), (e) => e.code === "REDIS_NOT_CONFIGURED");
  assert.deepEqual(parseRedisUrl("redis://default:pa%20ss@h:6380/2"), { host: "h", port: 6380, username: "default", password: "pa ss", db: 2, tls: false });
});

test("RESP codec round-trips binary-safe values and partial frames", () => {
  const enc = encodeCommand(["SET", "k", "a b\r\nc é"]);
  assert.equal(enc.toString(), "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$9\r\na b\r\nc é\r\n");
  assert.equal(parseReply(Buffer.from("$5\r\nhel"), 0), null, "incomplete bulk string waits for more bytes");
  const arr = parseReply(Buffer.from("*2\r\n$3\r\nfoo\r\n:42\r\n"), 0);
  assert.deepEqual(arr.value, ["foo", 42]);
  assert.equal(parseReply(Buffer.from("$-1\r\n"), 0).value, null);
});

test("PostgreSQL client", { skip }, async (t) => {
  await resetInfra();
  const pool = new PgPool({ url: INFRA.databaseUrl, max: 3, queryTimeoutMs: 3000 });
  t.after(() => pool.end());

  await t.test("SCRAM-SHA-256 login and typed results", async () => {
    const r = await pool.query("SELECT $1::int AS n, $2::bigint AS b, $3::bool AS t, $4::jsonb AS j, $5::text AS s, $6::text AS nul, now() AS ts", [7, "9007199254740993", true, { a: [1, 2] }, "héllo 'q' \"d\" ; --", null]);
    const row = r.rows[0];
    assert.equal(row.n, 7);
    assert.equal(row.b, "9007199254740993", "bigint beyond 2^53 stays a string");
    assert.equal(row.t, true);
    assert.deepEqual(row.j, { a: [1, 2] });
    assert.equal(row.s, "héllo 'q' \"d\" ; --");
    assert.equal(row.nul, null);
    assert.match(row.ts, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(await pool.ping().then((p) => p.ok), true);
  });

  await t.test("values are bound, never interpolated: an injection string is stored as data", async () => {
    await pool.query("CREATE TABLE inj (v text)");
    const evil = "x'); DROP TABLE inj; --";
    await pool.query("INSERT INTO inj (v) VALUES ($1)", [evil]);
    const r = await pool.query("SELECT v FROM inj");
    assert.deepEqual(r.rows, [{ v: evil }]);
  });

  await t.test("errors carry a category and SQLSTATE, not server text beyond the message", async () => {
    await assert.rejects(pool.query("SELEC 1"), (e) => e instanceof PgError && e.code === "PG_QUERY_ERROR" && e.sqlState === "42601");
    await assert.rejects(pool.query("SELECT * FROM does_not_exist"), (e) => e.sqlState === "42P01");
    assert.equal((await pool.query("SELECT 1 AS ok")).rows[0].ok, 1, "the connection is reusable after an error");
  });

  await t.test("transactions commit and roll back", async () => {
    await pool.query("CREATE TABLE tx (id int primary key)");
    await pool.transaction(async (c) => { await c.query("INSERT INTO tx VALUES (1)"); });
    await assert.rejects(pool.transaction(async (c) => { await c.query("INSERT INTO tx VALUES (2)"); throw new Error("abort"); }), /abort/);
    assert.deepEqual((await pool.query("SELECT id FROM tx ORDER BY id")).rows, [{ id: 1 }]);
  });

  await t.test("concurrent queries beyond the pool size queue and all complete", async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => pool.query("SELECT pg_sleep(0.02), $1::int AS i", [i])));
    assert.deepEqual(rs.map((r) => r.rows[0].i), Array.from({ length: 20 }, (_, i) => i));
  });

  await t.test("a query timeout discards the connection and the pool keeps working", async () => {
    const short = new PgPool({ url: INFRA.databaseUrl, max: 1, queryTimeoutMs: 150 });
    await assert.rejects(short.query("SELECT pg_sleep(2)"), (e) => e.code === "PG_TIMEOUT");
    assert.equal((await short.query("SELECT 5 AS n")).rows[0].n, 5, "a fresh connection serves the next query");
    await short.end();
  });

  await t.test("wrong password -> PG_AUTH_FAILED; closed port -> PG_CONNECT_FAILED; no TLS on server but sslmode=require -> PG_TLS_FAILED", async () => {
    const u = new URL(INFRA.databaseUrl);
    const bad = new URL(u); bad.password = "definitely-wrong";
    const pingOf = async (url) => { const p = new PgPool({ url }); try { return await p.ping(); } finally { await p.end(); } };
    assert.equal((await pingOf(bad.toString())).error, "PG_AUTH_FAILED");
    const dead = new URL(u); dead.port = "1";
    assert.equal((await pingOf(dead.toString())).error, "PG_CONNECT_FAILED");
    const tls = new URL(u); tls.searchParams.set("sslmode", "require");
    assert.equal((await pingOf(tls.toString())).error, "PG_TLS_FAILED");
  });

  await t.test("migrations are idempotent and safe to run from two replicas at once", async () => {
    await resetInfra();
    const p1 = new PgPool({ url: INFRA.databaseUrl, max: 2 });
    const p2 = new PgPool({ url: INFRA.databaseUrl, max: 2 });
    await p1.query("DROP SCHEMA public CASCADE"); await p1.query("CREATE SCHEMA public");
    const [a, b] = await Promise.all([runMigrations(p1), runMigrations(p2)]);
    assert.equal(a.applied.length + b.applied.length, MIGRATIONS.length, "each migration applied exactly once across both replicas");
    assert.deepEqual(await schemaStatus(p1), { ok: true, current: MIGRATIONS.at(-1).version, expected: MIGRATIONS.at(-1).version });
    assert.deepEqual((await runMigrations(p1)).applied, []);
    await p1.end(); await p2.end();
  });
});

test("Redis client", { skip }, async (t) => {
  const open = new RedisClient({ url: INFRA.redisUrl });
  t.after(() => open.close());

  await t.test("commands carry values with spaces, newlines and unicode", async () => {
    assert.equal(await open.command("SET", "t:k", "a b\r\nc é ✓"), "OK");
    assert.equal(await open.command("GET", "t:k"), "a b\r\nc é ✓");
    assert.equal(await open.command("GET", "t:missing"), null);
    assert.deepEqual(await open.ping().then((p) => p.ok), true);
  });

  await t.test("Lua scripts run atomically", async () => {
    await open.command("DEL", "t:ctr");
    const rs = await Promise.all(Array.from({ length: 50 }, () => open.eval("return redis.call('INCR', KEYS[1])", ["t:ctr"], [])));
    assert.deepEqual([...rs].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  });

  await t.test("a server error reply rejects with REDIS_COMMAND_ERROR; the connection stays usable", async () => {
    await assert.rejects(open.command("NOSUCHCOMMAND"), (e) => e instanceof RedisError && e.code === "REDIS_COMMAND_ERROR");
    assert.equal(await open.command("PING"), "PONG");
  });

  await t.test("a command timeout discards the connection (late replies cannot be mismatched) and the client reconnects", async () => {
    const c = new RedisClient({ url: INFRA.redisUrl, commandTimeoutMs: 150 });
    await assert.rejects(c.command("BLPOP", "t:never", 2), (e) => e.code === "REDIS_TIMEOUT");
    assert.equal(await c.command("PING"), "PONG");
    await c.close();
  });

  await t.test("unreachable server -> REDIS_CONNECT_FAILED, reported by ping() without throwing", async () => {
    const dead = new RedisClient({ url: "redis://127.0.0.1:1" });
    assert.equal((await dead.ping()).error, "REDIS_CONNECT_FAILED");
    await assert.rejects(dead.command("GET", "x"), (e) => e.code === "REDIS_CONNECT_FAILED");
    await dead.close();
  });

  await t.test("password-protected server: correct password works, wrong/missing password -> REDIS_AUTH_FAILED", { skip: RAUTH ? false : "TEST_REDIS_AUTH_URL not set" }, async () => {
    const ok = new RedisClient({ url: RAUTH });
    assert.equal(await ok.command("PING"), "PONG");
    await ok.close();
    const wrong = new URL(RAUTH); wrong.password = "nope";
    const pingOf = async (url) => { const c = new RedisClient({ url }); try { return await c.ping(); } finally { await c.close(); } };
    assert.equal((await pingOf(wrong.toString())).error, "REDIS_AUTH_FAILED");
    const none = new URL(RAUTH); none.username = ""; none.password = "";
    assert.equal((await pingOf(none.toString())).error, "REDIS_AUTH_FAILED", "NOAUTH is categorised as an auth failure");
  });
});
