"use strict";
/**
 * The last step before an analysis or Copilot answer leaves the pipeline: it decides, for THIS request and the paper's CURRENT licence,
 * what text from the paper the response may carry. It runs on every response (fresh, cached or deduplicated), so a licence that changed
 * after an answer was cached is honoured, and the cache itself never needs to know about licences.
 *
 *  1. Licence gate. Where licensePolicy says `redistributeText` is not "yes" (NonCommercial, NoDerivatives, publisher-specific, unknown):
 *       - `evidence[].text` is removed (the entry keeps its id, section and a reason, so the reader can still open the paper);
 *       - text that is a verbatim copy of the paper (the local-fallback answer, a verbatim abstract TL;DR) is replaced by a notice;
 *       - `textPolicy` says so explicitly, with the reason, so a screen can show "not shown because of the licence" rather than nothing.
 *     Model-written statements are not excerpts and are kept; the evidence endpoint (GET .../evidence/...) applies the same rule to
 *     the sentence behind a statement. This is a policy rule, not a legal conclusion (licensePolicy.js).
 *  2. Confidence. The heuristic `confidence.score` (and its factors) is a count-based number, not a probability of correctness. It is
 *     removed from every response. `level` and `basis` stay so existing readers do not break, and no screen may present them as a measure
 *     of accuracy.
 *
 * Pure: returns a new object, never mutates its input (cached bodies are shared).
 */
const { permissionsFor } = require("../papers/licensePolicy");

const WITHHELD_REASON = "LICENSE_DOES_NOT_ALLOW_SERVING_TEXT";
const SINGLE_VERBATIM_FIELDS = ["tldr", "researchProblem", "motivation", "methodology", "architecture", "dataset", "experimentalSetup", "findings", "novelty", "whyItMatters", "practicalImplications", "futureWork"];
const LIST_FIELDS = ["contributions", "techniques", "strengths", "limitations", "assumptions"];
const isVerbatim = (item) => item && typeof item === "object" && item.basis === "EXTRACTED_VERBATIM";

function stripConfidence(c) {
  if (!c || typeof c !== "object") return c;
  const out = {};
  if ("level" in c) out.level = c.level;
  if ("basis" in c) out.basis = c.basis;
  return out;
}

/**
 * @param {{httpStatus:number, body:object}} out
 * @param {{license?:string|null, sourceUrl?:string|null, doi?:string|null}} paper
 */
function gateResponse(out, paper) {
  if (!out || !out.body || typeof out.body !== "object") return out;
  const perm = permissionsFor(paper && paper.license);
  const allowed = perm.redistributeText === "yes";
  const body = { ...out.body };
  if ("confidence" in body) body.confidence = stripConfidence(body.confidence);
  body.textPolicy = {
    evidenceText: allowed ? "INCLUDED" : "WITHHELD_BY_LICENSE",
    license: perm.license.normalised,
    permission: perm.redistributeText,
    ...(allowed ? {} : { reason: WITHHELD_REASON, notice: "The paper's licence does not clearly allow showing its text here. Open the original paper to read it." }),
    policyNote: perm.notice
  };
  if (allowed) return { ...out, body };

  if (Array.isArray(body.evidence)) {
    body.evidence = body.evidence.map((e) => {
      if (!e || typeof e !== "object") return e;
      const { text, ...rest } = e; // eslint-disable-line no-unused-vars
      return { ...rest, textAvailable: false, textWithheldReason: WITHHELD_REASON };
    });
  }
  if (body.modelMode === "LOCAL_DETERMINISTIC" && typeof body.answer === "string") {
    body.answer = "No AI model was used, and the paper's licence does not clearly allow showing its text here, so no passages are shown. Open the original paper to read it.";
  }
  if (body.intelligence && typeof body.intelligence === "object") {
    const intel = { ...body.intelligence };
    const removed = [];
    for (const f of SINGLE_VERBATIM_FIELDS) {
      if (isVerbatim(intel[f])) { intel[f] = null; removed.push(f); }
    }
    for (const f of LIST_FIELDS) {
      if (Array.isArray(intel[f]) && intel[f].some(isVerbatim)) { intel[f] = intel[f].filter((x) => !isVerbatim(x)); removed.push(f); }
    }
    body.intelligence = intel;
    if (removed.length) body.textPolicy.verbatimFieldsRemoved = removed;
  }
  return { ...out, body };
}

module.exports = { gateResponse, stripConfidence, WITHHELD_REASON };
