"use strict";
/** Hand-checked arithmetic for the Qwen3-8B memory budget (scripts/llm_memory_budget.js). Proves the formulas, not the estimates. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { budget, kvBytesPerTokenPerLayer, A } = require("../../../scripts/llm_memory_budget");

test("KV cache: 36 layers x 2 (K,V) x 8 heads x 128 x 2 bytes = 147,456 bytes per token; 96 MiB per layer and 3456 MiB (3.375 GiB) at 24,576 tokens", () => {
  assert.equal(kvBytesPerTokenPerLayer() * A.layers, 147456);
  const b = budget(24576, 0);
  assert.equal(b.kvPerLayerMiB, 96);
  assert.equal(b.kvTotalMiB, 3456);
  assert.equal(budget(8192, 0).kvTotalMiB, 1152);
});
test("offload moves a layer's weights AND its cache from RAM to the GPU; more layers on the GPU means less RAM and more VRAM", () => {
  const a = budget(24576, 8), c = budget(24576, 12);
  assert.ok(c.gpuMiB > a.gpuMiB && c.ramMiB < a.ramMiB);
  assert.ok(Math.abs((c.gpuMiB - a.gpuMiB) / 4 - (96 + a.weightPerLayerMiB)) <= 1, "each extra layer costs its weights plus 96 MiB of cache");
  assert.equal(budget(24576, 0).gpuMiB, 0);
});
test("the provisional start (-ngl 8) leaves room on a 4096 MiB card with 600 MiB already used; -ngl 12 is marginal; -ngl 16 does not fit", () => {
  assert.ok(4096 - 600 - budget(24576, 8).gpuMiB > 700);
  assert.ok(4096 - 600 - budget(24576, 12).gpuMiB < 400);
  assert.ok(4096 - 600 - budget(24576, 16).gpuMiB < 0);
});
