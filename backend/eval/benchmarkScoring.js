"use strict";
/**
 * Scores the faithfulness evaluator against reference labels, and (when two or more raters are present) the raters against each other.
 *
 * Input item: { id, license, source, claims: [{ text, cites?, label?, ratings?: { raterA: "SUPPORTED", raterB: "PARTIAL" }, adjudicated? }] }
 * Reference label for a claim: `adjudicated` if present, else `label`. A benchmark with no adjudicated labels from at least two
 * independent people is not a human benchmark; the result says which kind it is.
 */

const { evaluateFaithfulness } = require("./faithfulness");
const { cohenKappa, confusion, perClass, trustable } = require("./agreement");
const { selectEvalCorpus } = require("../papers/licensePolicy");

const LABELS = ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONTRADICTED"];
const FICTIONAL = "fictional";

async function scoreBenchmark(doc, { judge = null } = {}) {
  const items = Array.isArray(doc.items) ? doc.items : [];
  // Real papers pass the licence gate; fictional text is the engineers' own and is exempt.
  const gate = selectEvalCorpus(items.filter((i) => i.license !== FICTIONAL).map((i) => ({ paperId: i.id, license: i.license })));
  const admitted = new Set([...gate.included.map((x) => x.paperId), ...items.filter((i) => i.license === FICTIONAL).map((i) => i.id)]);

  const reference = [];
  const predicted = [];
  const raterPairs = {};
  const disagreements = [];
  for (const item of items) {
    if (!admitted.has(item.id)) continue;
    const r = await evaluateFaithfulness({ source: item.source, claims: item.claims.map((c) => ({ text: c.text, cites: c.cites })) }, { judge });
    item.claims.forEach((c, i) => {
      const ref = c.adjudicated || c.label;
      const got = r.claims[i].status;
      if (!LABELS.includes(ref) || !LABELS.includes(got)) return;
      reference.push(ref); predicted.push(got);
      if (ref !== got) disagreements.push({ item: item.id, claim: c.text.slice(0, 90), reference: ref, evaluator: got, flags: r.claims[i].flags.map((f) => f.code) });
      const names = Object.keys(c.ratings || {});
      for (let a = 0; a < names.length; a += 1) for (let b = a + 1; b < names.length; b += 1) {
        const k = `${names[a]}|${names[b]}`;
        raterPairs[k] = raterPairs[k] || { a: [], b: [] };
        raterPairs[k].a.push(c.ratings[names[a]]); raterPairs[k].b.push(c.ratings[names[b]]);
      }
    });
  }
  const interRater = Object.fromEntries(Object.entries(raterPairs).map(([k, v]) => [k, cohenKappa(v.a, v.b)]));
  const kappa = cohenKappa(reference, predicted);
  const trust = { reference: reference.map(trustable), predicted: predicted.map(trustable) };
  const trustPer = perClass(trust.reference, trust.predicted, ["TRUST", "CHECK"]);
  const humanRated = Object.keys(interRater).length > 0 && doc._kind !== "DEV_FIXTURE_NOT_HUMAN_RATED";
  return {
    kind: humanRated ? "HUMAN_RATED" : (doc._kind || "NOT_HUMAN_RATED"),
    claims: reference.length,
    excludedByLicence: gate.excluded,
    exactAgreement: kappa.observed,
    cohenKappaVsReference: kappa.kappa,
    confusion: confusion(reference, predicted, LABELS),
    perClass: perClass(reference, predicted, LABELS),
    // the decision a reader cares about: is it safe to read this claim as written? Missing an unsafe claim is the costly error.
    unsafeClaimsMissed: trust.reference.filter((r, i) => r === "CHECK" && trust.predicted[i] === "TRUST").length,
    unsafeClaims: trust.reference.filter((r) => r === "CHECK").length,
    trustVsCheck: trustPer,
    interRaterKappa: interRater,
    disagreements
  };
}

module.exports = { scoreBenchmark, LABELS };
