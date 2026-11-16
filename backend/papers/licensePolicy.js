"use strict";
/**
 * Licence policy for retrieved papers: what a paper's recorded licence allows shoRDs to do with its text BEYOND showing it to
 * the user who asked for it.
 *
 * This module is conservative by design and is NOT legal advice. It exists so that tooling which keeps paper text (evaluation
 * corpora, any future fine-tuning data) cannot quietly include a paper whose licence does not clearly allow it.
 *
 * It does not change what the product does today: analysing a paper at a signed-in user's request is unchanged and is not decided here.
 *
 * Four SEPARATE permissions are reported, because a licence can allow one and not another:
 *   inference          send the text to a model to answer one requester's question; the output goes to that requester only
 *   evalCorpus         keep the text, and outputs derived from it, in an internal evaluation set
 *   trainingData       use the text to train or fine-tune any model
 *   redistributeText   serve the text (or long excerpts) to people other than the requester
 *
 * Answers are "yes" (the recorded licence clearly allows it), "review" (it might, under conditions a person must check), or
 * "no" (the licence forbids it, or it is unknown). Unknown, missing or unparseable licences are "no" for the last three. `inference`
 * is advisory only: it is never "no", because the product's current behaviour (analysing a paper at a signed-in user's request) is
 * not decided here.
 *
 * Every result carries `basis`: what the licence's own deed says for each permission, with the deed URL. The deeds are plain-language
 * summaries published by Creative Commons, which says they have no legal value; the licence text governs. These are POLICY RULES,
 * NOT LEGAL CONCLUSIONS. Where the answer depends on law outside the licence (copyright exceptions, database rights) the result is "review".
 * Open questions are recorded in docs/research/SIGMOBILE_RESEARCH_STRATEGY.md (ACM's own pages say nothing about text mining or AI use).
 */

const DEED = {
  CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
  CC_BY: "https://creativecommons.org/licenses/by/4.0/",
  CC_BY_SA: "https://creativecommons.org/licenses/by-sa/4.0/",
  CC_BY_ND: "https://creativecommons.org/licenses/by-nd/4.0/",
  CC_BY_NC: "https://creativecommons.org/licenses/by-nc/4.0/",
  CC_BY_NC_SA: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  CC_BY_NC_ND: "https://creativecommons.org/licenses/by-nc-nd/4.0/"
};
const NOTICE = "Policy rule, not a legal conclusion. The licence text governs; the deed is a summary.";

const YES = "yes";
const REVIEW = "review";
const NO = "no";

/**
 * Normalise the licence strings seen from OpenAlex (`cc-by`, `publisher-specific-oa`), Europe PMC, and Creative Commons URLs.
 * @param {unknown} raw
 * @returns {{kind:string, known:boolean, attribution:boolean, commercial:boolean, derivatives:"yes"|"no"|"sharealike", normalised:string|null}}
 */
function parseLicense(raw) {
  const unknown = { kind: "UNKNOWN", known: false, attribution: false, commercial: false, derivatives: "no", normalised: null };
  if (typeof raw !== "string") return unknown;
  let s = raw.trim().toLowerCase();
  if (!s || s.length > 300) return unknown;
  const url = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?([0-9.]*)/.exec(s);
  if (url) s = url[1] === "publicdomain" ? (url[2] === "zero" ? "cc0" : "public-domain") : `cc-${url[2]}`;
  s = s.replace(/[\s_]+/g, "-").replace(/-?(1\.0|2\.0|2\.5|3\.0|4\.0)$/, "").replace(/^cc-by/, "cc-by");
  if (s === "cc0" || s === "cc-zero" || s === "cc0-1.0") return { kind: "CC0", known: true, attribution: false, commercial: true, derivatives: "yes", normalised: "cc0" };
  if (s === "public-domain" || s === "pd" || s === "pdm") return { kind: "PUBLIC_DOMAIN", known: true, attribution: false, commercial: true, derivatives: "yes", normalised: "public-domain" };
  const m = /^cc-by(-nc)?(-sa|-nd)?$/.exec(s);
  if (m) {
    const nc = !!m[1];
    const tail = m[2] || "";
    return {
      kind: `CC_BY${nc ? "_NC" : ""}${tail ? "_" + tail.slice(1).toUpperCase() : ""}`,
      known: true,
      attribution: true,
      commercial: !nc,
      derivatives: tail === "-nd" ? "no" : tail === "-sa" ? "sharealike" : "yes",
      normalised: s
    };
  }
  // Recognised but not a reusable licence: the right to read, not a right to keep or reuse.
  if (["publisher-specific-oa", "implied-oa", "other-oa", "publisher-specific", "arxiv-nonexclusive", "arxiv"].includes(s) || /arxiv\.org\/licenses\/nonexclusive/.test(s)) {
    return { kind: "READ_ONLY", known: true, attribution: false, commercial: false, derivatives: "no", normalised: s };
  }
  return unknown;
}

/**
 * @param {unknown} rawLicense the licence recorded for the paper
 * @returns {{
 *   license: ReturnType<typeof parseLicense>,
 *   inference: "yes"|"review",             // advisory only; see header
 *   evalCorpus: "yes"|"review"|"no",
 *   trainingData: "yes"|"review"|"no",
 *   redistributeText: "yes"|"review"|"no",
 *   attributionRequired: boolean,
 *   reason: string,
 *   basis: {deed: string|null, inference: string, evalCorpus: string, trainingData: string, redistributeText: string},
 *   notice: string
 * }}
 */
function permissionsFor(rawLicense) {
  const license = parseLicense(rawLicense);
  const mk = (inference, evalCorpus, trainingData, redistributeText, reason, basis) => ({
    license, inference, evalCorpus, trainingData, redistributeText, attributionRequired: license.attribution, reason, notice: NOTICE,
    basis: { deed: DEED[license.kind] || null, ...basis }
  });
  if (!license.known) {
    const b = "no licence recorded, or not one this module recognises: no permission beyond the requester's own reading is assumed";
    return mk(REVIEW, NO, NO, NO, "licence unknown or missing", { inference: b + " (product behaviour unchanged)", evalCorpus: b, trainingData: b, redistributeText: b });
  }
  if (license.kind === "READ_ONLY") {
    const b = "free to read, but the licence recorded does not grant reuse";
    return mk(REVIEW, NO, NO, NO, "free to read; no reuse licence recorded", { inference: b + " (product behaviour unchanged)", evalCorpus: b, trainingData: b, redistributeText: b });
  }
  if (license.kind === "CC0" || license.kind === "PUBLIC_DOMAIN") {
    const b = "no restrictions recorded (CC0 waiver or public domain)";
    return mk(YES, YES, YES, YES, "no restrictions recorded", { inference: b, evalCorpus: b, trainingData: b, redistributeText: b });
  }
  // Creative Commons "BY" family.
  if (!license.commercial) {
    const b = "NonCommercial: the deed bars use primarily intended for business advantage or money; shoRDs is not entitled to assume its use is non-commercial";
    return mk(REVIEW, NO, NO, NO, "non-commercial licence", { inference: b, evalCorpus: b, trainingData: b, redistributeText: b + (license.derivatives === "no" ? "; NoDerivatives also forbids distributing adaptations" : "") });
  }
  if (license.derivatives === "no") {
    return mk(REVIEW, REVIEW, NO, REVIEW, "no-derivatives licence", {
      inference: "NoDerivatives bars distributing remixed or transformed material; a summary shown to one requester may or may not be 'distribution'",
      evalCorpus: "NoDerivatives: stored outputs derived from the text are adaptations; keeping them internally may be fine, sharing them is not",
      trainingData: "a model trained on the text is arguably built on it; NoDerivatives gives no permission to do that",
      redistributeText: "verbatim sharing with credit is allowed by the deed; excerpts or changed text are not"
    });
  }
  if (license.derivatives === "sharealike") {
    return mk(YES, YES, REVIEW, REVIEW, "share-alike licence", {
      inference: "the deed allows adapting and commercial use with credit; ShareAlike applies when adapted material is shared",
      evalCorpus: "adaptation and commercial use allowed with credit; internal evaluation sets are not shared",
      trainingData: "ShareAlike may attach to material built from the text; whether a model is such material is a legal question",
      redistributeText: "allowed with credit, but the result must carry the same or a compatible licence"
    });
  }
  // Plain CC BY.
  return mk(YES, YES, REVIEW, YES, "CC BY: reuse with attribution", {
    inference: "the deed allows copying, adapting and commercial use with credit",
    evalCorpus: "the deed allows copying and adapting for any purpose with credit; keep the attribution with the stored text",
    trainingData: "the deed does not mention AI training; Creative Commons also says its conditions are not triggered where a copyright exception applies, so the answer depends on law and on facts outside the licence: a person must decide",
    redistributeText: "the deed allows redistribution in any medium for any purpose with credit, a link to the licence and a note of any changes"
  });
}

/**
 * Split candidate papers into those that may enter an evaluation corpus and those that may not, with the reason for each.
 * @param {Array<{paperId?:string, license?:unknown}>} papers
 * @param {{allowReview?:boolean}} [opts] allowReview: also admit "review" papers (only after a person has reviewed them)
 */
function selectEvalCorpus(papers, { allowReview = false } = {}) {
  const included = [];
  const excluded = [];
  for (const p of papers) {
    const perm = permissionsFor(p && p.license);
    const ok = perm.evalCorpus === YES || (allowReview && perm.evalCorpus === REVIEW);
    (ok ? included : excluded).push({ paperId: p && p.paperId ? p.paperId : null, license: perm.license.normalised, decision: perm.evalCorpus, reason: perm.reason });
  }
  return { included, excluded };
}

module.exports = { parseLicense, permissionsFor, selectEvalCorpus, YES, REVIEW, NO };
