"use strict";
/**
 * Regression: a reservation of 1e14 micro-USD or more used to be written to Redis as "3e+14", which the reserved-amount parser could
 * not read, so such a reservation counted as ZERO against the limit (the in-memory store counted it correctly). Reachable only with an
 * absurd price override and AI_BUDGET_REQUEST_MAX_USD=unlimited, but the two stores must agree for every amount the gate accepts.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { infraSkip, INFRA } = require("./helpers");
const { RedisClient } = require("../../data/redisClient");
const { createRedisBudgetStore, createMemoryBudgetStore } = require("../../llm/aiBudget");

const skip = infraSkip();
const NOW = Date.now();
const scope = (id) => ({ kind: "user", id, key: `shords:aib:test:big:${id}`, zkey: `shords:aib:test:big:${id}:res`, limitMicro: 5e14, maxConcurrent: null, maxCalls: null });

test("reservations of 1e14 micro-USD or more are counted by the Redis store exactly as by the memory store", { skip }, async () => {
  const redis = new RedisClient({ url: INFRA.redisUrl });
  try {
    for (const [label, store, sc] of [["redis", createRedisBudgetStore(redis), scope("r")], ["memory", createMemoryBudgetStore(), scope("m")]]) {
      await store.seed({ scope: sc, spentMicro: 0, calls: 0 });
      const first = await store.reserve({ scopes: [sc], amountMicro: 3e14, reservationId: "a", expiresAtMs: NOW + 60000, nowMs: NOW });
      const second = await store.reserve({ scopes: [sc], amountMicro: 3e14, reservationId: "b", expiresAtMs: NOW + 60000, nowMs: NOW });
      assert.equal(first.ok, true, `${label}: first reservation fits`);
      assert.equal(second.ok, false, `${label}: second would exceed the limit and must be refused`);
      assert.equal((await store.peek({ scope: sc, nowMs: NOW })).reservedMicro, 3e14, `${label}: the held amount is reported exactly`);
      await store.settle({ scopes: [sc], reservationId: "a", chargeMicro: 0 });
      assert.equal((await store.peek({ scope: sc, nowMs: NOW })).reservedMicro, 0, `${label}: released`);
    }
  } finally {
    await redis.close();
  }
});
