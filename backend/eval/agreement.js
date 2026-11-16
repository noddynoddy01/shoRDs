"use strict";
/**
 * Agreement statistics for rating studies. Pure functions, no dependencies.
 *  - cohenKappa: chance-corrected agreement between two raters (or a rater and an automatic method) over the same items.
 *  - confusion / perClass: where an automatic method disagrees with the reference labels, and how often it is right per class.
 * Kappa is undefined (null) when both sides use one single label throughout, instead of returning NaN or 1.
 */

const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

function confusion(reference, predicted, labels = null) {
  if (reference.length !== predicted.length) throw new Error("reference and predicted must have the same length");
  const L = labels || [...new Set([...reference, ...predicted])].sort();
  const m = Object.fromEntries(L.map((r) => [r, Object.fromEntries(L.map((p) => [p, 0]))]));
  reference.forEach((r, i) => { if (m[r] && predicted[i] in m[r]) m[r][predicted[i]] += 1; });
  return { labels: L, matrix: m };
}

function cohenKappa(a, b) {
  if (a.length !== b.length) throw new Error("both raters must label the same items");
  const n = a.length;
  if (!n) return { n: 0, observed: null, expected: null, kappa: null };
  const L = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i += 1) if (a[i] === b[i]) agree += 1;
  const observed = agree / n;
  let expected = 0;
  for (const l of L) expected += (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n);
  return { n, observed: round(observed), expected: round(expected), kappa: expected === 1 ? null : round((observed - expected) / (1 - expected)) };
}

function perClass(reference, predicted, labels = null) {
  const { labels: L, matrix } = confusion(reference, predicted, labels);
  const out = {};
  for (const l of L) {
    const tp = matrix[l][l];
    const fn = L.reduce((n, p) => n + (p === l ? 0 : matrix[l][p]), 0);
    const fp = L.reduce((n, r) => n + (r === l ? 0 : matrix[r][l]), 0);
    const precision = tp + fp ? tp / (tp + fp) : null;
    const recall = tp + fn ? tp / (tp + fn) : null;
    out[l] = { support: tp + fn, precision: round(precision), recall: round(recall), f1: precision && recall ? round((2 * precision * recall) / (precision + recall)) : null };
  }
  return out;
}

/** Collapse four labels into the decision a reader cares about: can this claim be trusted as written? */
const trustable = (label) => (label === "SUPPORTED" ? "TRUST" : "CHECK");

module.exports = { cohenKappa, confusion, perClass, trustable };
