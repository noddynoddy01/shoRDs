"use strict";
/**
 * The on-device brief (rule-based, services/paperSummarizer.ts) must show the paper's own sentences, whole. Regression for a defect found
 * on 2026-11-03: sentences were split at every period, so "runs 3.1 times faster" was cut at "3." and the brief said "1 times faster".
 * The app modules are run in Node with their React Native imports stubbed; nothing is fetched. The papers here are fictional.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
require("./registerTs").install(true); // transpile to CommonJS so the "@/" alias hook below applies on every Node version

const stubs = {
  "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
  "react-native": { Platform: { OS: "node" } }
};
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs[request]) return stubs[request];
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return realLoad.call(this, request, parent, ...rest);
};
test.after(() => { Module._load = realLoad; });

const { splitSentences, sentencesMatching } = require(path.join(root, "services/sentenceSplit.ts"));

test("sentence splitting keeps decimals, abbreviations, initials, versions and DOIs whole and never alters text", () => {
  const cases = [
    ["The model retains 93.2 percent accuracy. It runs 3.1 times faster.", ["The model retains 93.2 percent accuracy.", "It runs 3.1 times faster."]],
    ["Smith et al. showed a gain. We confirm it.", ["Smith et al. showed a gain.", "We confirm it."]],
    ["See Fig. 3 and Eq. 2 for details. Results follow.", ["See Fig. 3 and Eq. 2 for details.", "Results follow."]],
    ["Gains were large, e.g. 12.5% on average. Costs fell.", ["Gains were large, e.g. 12.5% on average.", "Costs fell."]],
    ["J. Smith and A. Jones co-led it. It worked.", ["J. Smith and A. Jones co-led it.", "It worked."]],
    ["Version v1.2 shipped (doi:10.1000/abc.def). Did it work? Yes!", ["Version v1.2 shipped (doi:10.1000/abc.def).", "Did it work?", "Yes!"]],
    ["He said \"it works.\" Then left.", ["He said \"it works.\"", "Then left."]],
    ["No terminal punctuation here", ["No terminal punctuation here"]],
    // Documented limit: a period followed by a lower-case letter is not a boundary, so these stay together (whole and unaltered).
    ["p < 0.05. n = 1.5e3.", ["p < 0.05. n = 1.5e3."]]
  ];
  for (const [input, expected] of cases) assert.deepEqual(splitSentences(input), expected, input);
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   \n "), []);
  // every returned sentence is an exact slice of the (whitespace-normalised) input
  const text = "Accuracy was 87.4 percent (95% CI 85.1 to 89.7). Latency fell from 410 ms to 150 ms. We did not test larger graphs.";
  assert.equal(splitSentences(text).join(" "), text);
  assert.deepEqual(sentencesMatching("It is limited to 3.5 GB of memory. Other text.", /limited to/i), ["It is limited to 3.5 GB of memory."]);
});

test("device brief: every number in the abstract section survives, and no sentence is cut at a decimal point", async () => {
  const S = require(path.join(root, "services/paperSummarizer.ts"));
  const abstract = "Deploying graph neural networks on edge devices is limited by memory. We present a structured pruning method that removes 62 percent of edges while preserving accuracy. On three citation graphs the pruned model retains 93.2 percent top-1 accuracy and runs 3.1 times faster on a mobile processor.";
  const brief = await S.generateGroundedResearchBriefAsync({ id: "t1", title: "Edge pruning", authors: ["A"], fullTextStatus: "ABSTRACT_ONLY", summary: abstract });
  const thirty = brief.sections.find((s) => s.sectionId === "sec_30sec");
  assert.ok(thirty, "the 30-second section exists");
  assert.equal(thirty.content.replace(/\s+/g, " ").trim(), abstract, "the three sentences are shown whole and in order");
  for (const fragment of ["93.2 percent", "3.1 times faster", "62 percent"]) assert.ok(thirty.content.includes(fragment), fragment);
  assert.ok(!/(^|\s)1 times faster/.test(thirty.content.replace("3.1 times faster", "")), "no fragment of a decimal is shown as a number of its own");
  // The statement that is cited as a claim is the same whole text.
  for (const claim of brief.allClaims) assert.ok(!/^\s*\d+ times/.test(claim.text), claim.text);
});
