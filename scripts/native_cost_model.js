#!/usr/bin/env node
"use strict";
/**
 * Cost and scaling model for the native engine (Phase 5, deliverable 11). PURE ARITHMETIC: no network, no model call, no purchase.
 *
 * EVERYTHING below the "INPUTS" line is an assumption or a quoted third-party price, not a measurement of shoRDs. The model exists so the owner
 * can change an input and see what moves. Prices are USD per million tokens (hosted APIs) or per GPU-hour (rentals), read on 2026-11-04 from
 * aggregator pages (cloudprice.net, haimaker.ai, hostinger.com GPU price table dated September 2026): third-party, not provider-primary, and
 * volatile. Throughput numbers are placeholders for a measurement that has NOT been run.
 *
 *   node scripts/native_cost_model.js            # markdown tables
 *   node scripts/native_cost_model.js --json
 */
const HOURS_PER_MONTH = 730;

// ------------------------------------------------------------------------------------------------ INPUTS
// Tokens per paper. Claude = the production single call (backend/llm/intelligence.js; context budget 120,000 chars ~ 30k tokens at 4 chars/token).
// Native = derived from the call structure and caps in backend/native (12 field calls with <= 9,000 chars each, one call per section group of <= 8,000 chars, one brief call).
const TOKENS = {
  typical: { claude: { in: 17000, out: 3000 }, direct: { in: 16000, out: 2000 }, pipeline: { in: 51000, out: 11700 } },
  long:    { claude: { in: 32000, out: 3500 }, direct: { in: 16000, out: 2000 }, pipeline: { in: 72000, out: 14000 } }
};
const PRICES = { // USD per million tokens
  "Claude Sonnet 5.5 (pinned in code, backend/llm/anthropicClient.js)": { in: 2, out: 10 },
  "Qwen3.8-27B hosted, DeepInfra-type price": { in: 0.40, out: 3.00 },
  "Qwen3.8-27B hosted, cheapest listed (router)": { in: 0.15, out: 1.88 },
  "gpt-oss-120b hosted, typical (Fireworks/Groq/Bedrock-type)": { in: 0.15, out: 0.60 },
  "gpt-oss-120b hosted, cheapest listed (DeepInfra)": { in: 0.037, out: 0.17 }
};
const GPU = { // USD per GPU-hour on demand, Hostinger table (Sept 2026)
  "H100 80GB (RunPod secure PCIe)": 2.89, "H100 80GB (Vast.ai marketplace, from)": 1.33, "L40S 48GB (RunPod secure)": 0.99, "RTX 4090 24GB (RunPod secure)": 0.74
};
// Serving throughput of ONE GPU for a ~27B-class model with batching. NOT MEASURED. Three scenarios so the sensitivity is visible.
const THROUGHPUT = { low: { prefill: 8000, decode: 800 }, mid: { prefill: 20000, decode: 1800 }, high: { prefill: 40000, decode: 3500 } };

// ------------------------------------------------------------------------------------------------ model
const apiCost = (t, p) => (t.in * p.in + t.out * p.out) / 1e6;
const secondsPerPaper = (t, tp) => t.in / tp.prefill + t.out / tp.decode;
const gpuMarginal = (t, tp, rate, util) => (secondsPerPaper(t, tp) * rate / 3600) / util; // cost per paper while the GPU is busy a fraction `util` of the time it is paid for
const capacity = (t, tp, util) => Math.floor(HOURS_PER_MONTH * 3600 / secondsPerPaper(t, tp) * util); // papers per GPU-month
const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : x >= 0.01 ? `$${x.toFixed(3)}` : `$${x.toFixed(4)}`);
const fmtN = (n) => n.toLocaleString("en-US");

function build() {
  const out = { assumptions: { TOKENS, PRICES, GPU, THROUGHPUT, HOURS_PER_MONTH }, tables: {} };
  const claudeKey = Object.keys(PRICES)[0];
  // 1. cost per paper by architecture
  const rows = [];
  for (const size of ["typical", "long"]) {
    const T = TOKENS[size];
    rows.push({ size, system: "Claude, current single call", perPaper: apiCost(T.claude, PRICES[claudeKey]) });
    for (const [name, p] of Object.entries(PRICES).slice(1)) {
      rows.push({ size, system: `${name}: one-shot`, perPaper: apiCost(T.direct, p) });
      rows.push({ size, system: `${name}: multi-stage pipeline`, perPaper: apiCost(T.pipeline, p) });
    }
    for (const [tpn, tp] of Object.entries(THROUGHPUT)) for (const util of [1, 0.5, 0.2]) rows.push({ size, system: `Self-hosted H100 $${GPU["H100 80GB (RunPod secure PCIe)"]}/h, ${tpn} throughput, ${util * 100}% busy: pipeline`, perPaper: gpuMarginal(T.pipeline, tp, GPU["H100 80GB (RunPod secure PCIe)"], util) });
  }
  out.tables.perPaper = rows;
  // 2. totals at 1k / 10k / 100k papers for the typical paper, no cache
  const N = [1000, 10000, 100000];
  const T = TOKENS.typical;
  const h100 = GPU["H100 80GB (RunPod secure PCIe)"];
  const tp = THROUGHPUT.mid;
  const arch = {
    "Claude API (current path)": (n) => n * apiCost(T.claude, PRICES[claudeKey]),
    "Hosted gpt-oss-120b, typical price, pipeline": (n) => n * apiCost(T.pipeline, PRICES["gpt-oss-120b hosted, typical (Fireworks/Groq/Bedrock-type)"]),
    "Hosted Qwen3.8-27B, DeepInfra-type price, pipeline": (n) => n * apiCost(T.pipeline, PRICES["Qwen3.8-27B hosted, DeepInfra-type price"]),
    "Self-hosted H100 24/7 (RunPod), mid throughput, pipeline": (n) => Math.max(1, Math.ceil(n / capacity(T.pipeline, tp, 0.5))) * h100 * HOURS_PER_MONTH, // papers PER MONTH, sized for 50% busy
    "Hybrid: 90% hosted gpt-oss-120b pipeline + 10% Claude (fallback/escalation)": (n) => 0.9 * n * apiCost(T.pipeline, PRICES["gpt-oss-120b hosted, typical (Fireworks/Groq/Bedrock-type)"]) + 0.1 * n * apiCost(T.claude, PRICES[claudeKey])
  };
  out.tables.totals = Object.entries(arch).map(([name, f]) => ({ name, perMonthAt: Object.fromEntries(N.map((n) => [n, f(n)])) }));
  // 3. cache effect on the Claude path and the hosted pipeline
  out.tables.cache = [0, 0.3, 0.6].map((h) => ({ hitRate: h, claude10k: 10000 * (1 - h) * apiCost(T.claude, PRICES[claudeKey]), hostedGptOss10k: 10000 * (1 - h) * apiCost(T.pipeline, PRICES["gpt-oss-120b hosted, typical (Fireworks/Groq/Bedrock-type)"]) }));
  // 4. break-even: papers per month at which one 24/7 H100 costs the same as paying per paper elsewhere
  const fixed = h100 * HOURS_PER_MONTH;
  out.tables.breakEven = {
    fixedPerMonth: fixed,
    versus: Object.fromEntries([["Claude single call", apiCost(T.claude, PRICES[claudeKey])], ["Hosted Qwen3.8-27B pipeline", apiCost(T.pipeline, PRICES["Qwen3.8-27B hosted, DeepInfra-type price"])], ["Hosted gpt-oss-120b pipeline", apiCost(T.pipeline, PRICES["gpt-oss-120b hosted, typical (Fireworks/Groq/Bedrock-type)"])]].map(([k, c]) => [k, { perPaper: c, breakEvenPapersPerMonth: Math.ceil(fixed / c), withOps1500: Math.ceil((fixed + 1500) / c) }])),
    capacityPerGpuMonth: Object.fromEntries(Object.entries(THROUGHPUT).map(([k, v]) => [k, { at100: capacity(T.pipeline, v, 1), at50: capacity(T.pipeline, v, 0.5), at20: capacity(T.pipeline, v, 0.2), secondsPerPaper: Number(secondsPerPaper(T.pipeline, v).toFixed(1)) }]))
  };
  return out;
}

function markdown(o) {
  const L = [];
  L.push("## Cost per paper (USD), by architecture\n", "| paper | system | per paper |", "|---|---|---|");
  for (const r of o.tables.perPaper) L.push(`| ${r.size} | ${r.system} | ${money(r.perPaper)} |`);
  L.push("\n## Monthly cost at volume (typical paper, no cache; self-hosted row is the GPU rental, sized for 50% busy)\n", "| architecture | 1,000 / month | 10,000 / month | 100,000 / month |", "|---|---|---|---|");
  for (const t of o.tables.totals) L.push(`| ${t.name} | ${Object.values(t.perMonthAt).map((x) => money(x)).join(" | ")} |`);
  L.push("\n## Caching (10,000 papers / month)\n", "| cache hit rate | Claude path | hosted gpt-oss-120b pipeline |", "|---|---|---|");
  for (const c of o.tables.cache) L.push(`| ${c.hitRate * 100}% | ${money(c.claude10k)} | ${money(c.hostedGptOss10k)} |`);
  const b = o.tables.breakEven;
  L.push(`\n## Break-even for one H100 rented 24/7 (${money(b.fixedPerMonth)} / month)\n`, "| compared with | cost per paper there | break-even papers / month | with $1,500 / month ops overhead (illustrative) |", "|---|---|---|---|");
  for (const [k, v] of Object.entries(b.versus)) L.push(`| ${k} | ${money(v.perPaper)} | ${fmtN(v.breakEvenPapersPerMonth)} | ${fmtN(v.withOps1500)} |`);
  L.push("\n## Capacity of one GPU-month for the pipeline (typical paper)\n", "| throughput scenario (NOT MEASURED) | seconds / paper | papers / month at 100% | at 50% | at 20% |", "|---|---|---|---|---|");
  for (const [k, v] of Object.entries(b.capacityPerGpuMonth)) L.push(`| ${k} | ${v.secondsPerPaper} | ${fmtN(v.at100)} | ${fmtN(v.at50)} | ${fmtN(v.at20)} |`);
  return L.join("\n");
}

const model = build();
if (process.argv.includes("--json")) console.log(JSON.stringify(model, null, 1)); else console.log(markdown(model));
