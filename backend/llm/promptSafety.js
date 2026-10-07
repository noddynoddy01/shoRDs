"use strict";
/**
 * Prompt-delimiter safety shared by the copilot and the paper-intelligence prompts.
 *
 * Untrusted text (paper excerpts, titles, the user's question) is placed between the server's own
 * structural tags (<paper_excerpts>, <excerpt>, <question>, <coverage>). Untrusted text must never be able
 * to forge one of those tags.
 *
 *  1. Exact tags, and the look-alikes a model reads as the same tag ("< /excerpt>", "<EXCERPT id=..>",
 *     full-width "\uFF1C/excerpt\uFF1E"), are replaced with "[tag removed]".
 *  2. Every other "<" (or full-width/small look-alike) that is not plainly mathematical ("p<0.05", "x <= 3")
 *     is escaped to "&lt;", so no angle bracket that could begin a tag survives, including variants with
 *     zero-width characters inside ("<\u200B/excerpt>", "</paper_ex\u200Bcerpts>").
 *
 * Both steps are linear time (no unbounded `[^>]*` scan, which was quadratic on "<excerpt <excerpt ...").
 * Text is deliberately NOT Unicode-normalised: NFKC would corrupt scientific text (superscripts, \u00B5, \u00C5).
 */

const TAG_NAMES = ["paper_excerpts", "excerpt", "question", "coverage"];
const OPEN = "[<\\uFF1C\\uFE64]";
const CLOSE = "[>\\uFF1E\\uFE65]";

// step 1: known tag, any look-alike spacing/case/bracket; attribute run capped so the scan is bounded.
const KNOWN_TAG = new RegExp(`${OPEN}[\\s/]*(?:${TAG_NAMES.join("|")})\\b[^<>\\uFF1C\\uFF1E\\uFE64\\uFE65]{0,200}${CLOSE}?`, "gi");
// step 2: any remaining opening bracket, except when it is followed (after <=3 spaces) by something that cannot start a tag name.
const OTHER_OPEN = new RegExp(`${OPEN}(?!\\s{0,3}[=\\d.+\\-\\u2212(\\[])`, "g");

function neutralizeTags(text) {
  if (typeof text !== "string") return "";
  return text.replace(KNOWN_TAG, "[tag removed]").replace(OTHER_OPEN, "&lt;");
}

const MAX_TITLE_CHARS = 500;

/** A paper title for use inside a `title="..."` attribute: bounded, single line, quote-free, tag-safe. */
function safeTitleAttribute(title) {
  const capped = String(title == null ? "" : title).slice(0, MAX_TITLE_CHARS).replace(/[\r\n\u2028\u2029]+/g, " ");
  return neutralizeTags(capped).replace(/"/g, "'");
}

module.exports = { neutralizeTags, safeTitleAttribute, MAX_TITLE_CHARS };
