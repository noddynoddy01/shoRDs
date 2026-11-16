#!/usr/bin/env node
"use strict";
/**
 * Memory budget calculator for a dense transformer served by llama.cpp with a partial GPU offload (Phase 6A).
 *   node scripts/llm_memory_budget.js [--ctx 24576] [--vram-mib 4096] [--desktop-mib 600]
 *
 * VERIFIED inputs (Hugging Face config.json / API for Qwen/Qwen3-8B and Qwen/Qwen3-8B-GGUF): 36 layers, 8 key-value heads, head size 128,
 * hidden 4096, vocab 151,936, Q4_K_M file 5,027,783,488 bytes.
 * ASSUMPTIONS (estimates, replace with the llama-server load log): bits per weight of the embedding (4.5, Q4_K) and output matrix (6.56, Q6_K),
 * the CUDA context + compute buffer on the GPU, host-side overhead, and that llama.cpp keeps each offloaded layer's key-value cache on the
 * same device as the layer (its default). The load log is the authority; this is only used to choose a PROVISIONAL starting -ngl.
 */
const MiB = 1048576;
const A = {
  layers: 36, kvHeads: 8, headDim: 128, hidden: 4096, vocab: 151936, fileBytes: 5027783488, cacheBytesPerElement: 2,
  embedBpw: 4.5, outputBpw: 6.56,
  gpuFixedMiB: 700, // CUDA context (~350) + compute buffer at the default micro-batch (~350): ESTIMATE
  hostOverheadMiB: 600 // server process, tokenizer, CPU compute buffers: ESTIMATE
};
function kvBytesPerTokenPerLayer(a = A) { return 2 * a.kvHeads * a.headDim * a.cacheBytesPerElement; } // K and V
function budget(ctx, ngl, a = A) {
  const perLayerKv = kvBytesPerTokenPerLayer(a) * ctx;
  const embed = (a.vocab * a.hidden * a.embedBpw) / 8, output = (a.vocab * a.hidden * a.outputBpw) / 8;
  const perLayerW = (a.fileBytes - embed - output) / a.layers;
  const n = Math.max(0, Math.min(ngl, a.layers)); // output matrix stays on the CPU unless ngl exceeds the layer count
  const gpu = n > 0 ? n * (perLayerW + perLayerKv) + a.gpuFixedMiB * MiB : 0;
  const ram = (a.layers - n) * (perLayerW + perLayerKv) + embed + output + a.hostOverheadMiB * MiB;
  return { ngl: n, ctx, kvPerLayerMiB: perLayerKv / MiB, kvTotalMiB: (perLayerKv * a.layers) / MiB, weightPerLayerMiB: perLayerW / MiB, gpuMiB: Math.round(gpu / MiB), ramMiB: Math.round(ram / MiB) };
}
module.exports = { budget, kvBytesPerTokenPerLayer, A };
if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : Number(process.argv[i + 1]); };
  const ctx = arg("ctx", 24576), vram = arg("vram-mib", 4096), desk = arg("desktop-mib", 600);
  console.log(`ctx ${ctx}; card ${vram} MiB; Windows/desktop already using ~${desk} MiB (assumed); KV per token = ${kvBytesPerTokenPerLayer() * A.layers} bytes`);
  console.log("ngl | GPU MiB | headroom MiB | RAM MiB (GiB) | KV on GPU MiB");
  for (const ngl of [0, 4, 8, 12, 16]) {
    const b = budget(ctx, ngl);
    console.log(`${String(ngl).padStart(3)} | ${String(b.gpuMiB).padStart(7)} | ${String(vram - desk - b.gpuMiB).padStart(12)} | ${String(b.ramMiB).padStart(6)} (${(b.ramMiB / 1024).toFixed(1)}) | ${Math.round(ngl * b.kvPerLayerMiB)}`);
  }
  const b = budget(ctx, 0);
  console.log(`total KV at ${ctx} tokens: ${b.kvTotalMiB} MiB (${(b.kvTotalMiB / 1024).toFixed(3)} GiB); per layer ${b.kvPerLayerMiB} MiB; weights per layer ${b.weightPerLayerMiB.toFixed(1)} MiB`);
}
