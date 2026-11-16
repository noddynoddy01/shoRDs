#!/usr/bin/env node
"use strict";
// Exact worst-case spend per analysis, computed with the production functions. No network, no model call.
const path = require("path").resolve(__dirname, "..", "backend") + "/";
const { estimateMaxCost } = require(path + "llm/aiBudget");
const { resolveProfile, resolveModelConfig, PRICING_PER_MTOK } = require(path + "llm/anthropicClient");
const I = require(path + "llm/intelligence");

const dflt = require(path + "llm/evidence").DEFAULT_MAX_CONTEXT_CHARS;
const model = resolveModelConfig({}).model;
const rows = [];
for (const depth of ["QUICK", "STANDARD", "DEEP"]) {
  const p = resolveProfile(depth);
  // worst case input: the full context budget of excerpt text plus the wrapper per excerpt (80 excerpts max assumed) plus the system prompt
  const excerptBytes = dflt + 80 * 160;
  const user = "x".repeat(excerptBytes + 400);
  const one = estimateMaxCost({ model, system: I.SYSTEM_PROMPT, user, maxTokens: p.maxTokens, attempts: 1, env: {} });
  const two = estimateMaxCost({ model, system: I.SYSTEM_PROMPT, user, maxTokens: p.maxTokens, attempts: 2, env: {} });
  rows.push({ depth, maxTokens: p.maxTokens, inputBoundTokens: one.inputTokensBound, perAttemptUsd: one.perAttemptMicro / 1e6, withOneRetryUsd: two.reservationMicro / 1e6, fiftyAttemptsUsd: 50 * one.perAttemptMicro / 1e6, fiftyWithRetryUsd: 50 * two.reservationMicro / 1e6 });
}
console.log(JSON.stringify({ model, price: PRICING_PER_MTOK[model], defaultMaxContextChars: dflt, rows }, null, 1));
