"use strict";
/**
 * Input validation for the community layer. Every validator either returns a clean value or throws SocialError(400). Nothing is
 * "repaired" silently except trimming and de-duplicating lists. Free text may not contain control characters (a NUL byte would
 * reach PostgreSQL and surface as a 503); multi-line fields allow \n and \t only.
 */

const { SocialError } = require("./errors");

const LS_PS = String.fromCharCode(0x2028, 0x2029); // line / paragraph separator
const CONTROL = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f" + LS_PS + "]"); // \t \n \r allowed through here, then \r is normalised
const CONTROL_SINGLE_LINE = new RegExp("[\\u0000-\\u001f\\u007f" + LS_PS + "]");
const BIDI = new RegExp("[\\u202a-\\u202e\\u2066-\\u2069]"); // bidi override characters can disguise text in a UI

const bad = (field, message) => new SocialError("INVALID_" + field.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase(), message, 400);

/** A required or optional string. Returns the trimmed string, or `null` when empty and not required. */
function text(value, field, { min = 0, max, required = false, multiline = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required || min > 0) throw bad(field, `\`${field}\` is required.`);
    return null;
  }
  if (typeof value !== "string") throw bad(field, `\`${field}\` must be text.`);
  const s = (multiline ? value.replace(/\r\n?/g, "\n") : value).trim();
  if ((multiline ? CONTROL : CONTROL_SINGLE_LINE).test(s) || BIDI.test(s)) throw bad(field, `\`${field}\` contains characters that are not allowed.`);
  if (s.length === 0) {
    if (required || min > 0) throw bad(field, `\`${field}\` is required.`);
    return null;
  }
  if (s.length < min) throw bad(field, `\`${field}\` must be at least ${min} characters.`);
  if (s.length > max) throw bad(field, `\`${field}\` must be at most ${max} characters.`);
  return s;
}

function oneOf(value, field, allowed, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad(field, `\`${field}\` is required.`);
    return null;
  }
  if (typeof value !== "string" || !allowed.includes(value)) throw bad(field, `\`${field}\` must be one of ${allowed.join(", ")}.`);
  return value;
}

/** A list of short strings: trimmed, empty items dropped, case-insensitive duplicates removed, bounded in count and length. */
function list(value, field, { maxItems = 15, maxLen = 60 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad(field, `\`${field}\` must be a list.`);
  if (value.length > maxItems * 3) throw bad(field, `\`${field}\` has too many entries.`);
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const s = text(raw, field, { max: maxLen });
    if (s === null) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  if (out.length > maxItems) throw bad(field, `\`${field}\` may have at most ${maxItems} entries.`);
  return out;
}

/** An https URL without credentials. `host` (optional) restricts it to a domain and its subdomains. */
function url(value, field, { host = null, max = 300, required = false } = {}) {
  const s = text(value, field, { max, required });
  if (s === null) return null;
  let u;
  try {
    u = new URL(s);
  } catch (_) {
    throw bad(field, `\`${field}\` must be a valid https link.`);
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) throw bad(field, `\`${field}\` must be a valid https link.`);
  if (host && !(u.hostname === host || u.hostname.endsWith("." + host))) throw bad(field, `\`${field}\` must be a ${host} link.`);
  return u.toString();
}

function urlList(value, field, { maxItems = 6 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw bad(field, `\`${field}\` must be a list of at most ${maxItems} links.`);
  const out = [];
  for (const v of value) {
    const u = url(v, field);
    if (u !== null && !out.includes(u)) out.push(u);
  }
  return out;
}

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
function orcid(value, field = "orcid") {
  const s = text(value, field, { max: 40 });
  if (s === null) return null;
  const id = s.replace(/^https?:\/\/orcid\.org\//i, "");
  if (!ORCID_RE.test(id)) throw bad(field, "`orcid` must look like 0000-0002-1825-0097.");
  return id;
}

function integer(value, field, { min, max, required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad(field, `\`${field}\` is required.`);
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw bad(field, `\`${field}\` must be a whole number from ${min} to ${max}.`);
  return value;
}

function boolean(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw bad(field, `\`${field}\` must be true or false.`);
  return value;
}

/** Reject any key of `body` that is not in `allowed`. Privileged names get their own message so a forged role is reported as such. */
const PRIVILEGED = new Set(["uid", "email", "role", "roles", "isAdmin", "admin", "verifiedMentor", "verified_mentor", "mentorStatus", "mentor_status", "mentorVerified", "status", "createdAt", "updatedAt"]);
function onlyKeys(body, allowed, what = "request") {
  for (const k of Object.keys(body)) {
    if (allowed.includes(k)) continue;
    if (PRIVILEGED.has(k)) throw new SocialError("FIELD_NOT_ALLOWED", `\`${k}\` cannot be set through this ${what}.`, 400);
    throw new SocialError("UNKNOWN_FIELD", `\`${k}\` is not a recognised field.`, 400);
  }
}

/** Escape LIKE/ILIKE wildcards so a search term is matched literally. Use with `ESCAPE '\'`. */
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);

const intParam = (raw, { def, min = 0, max }) => {
  if (raw === undefined || raw === null || raw === "") return def;
  if (!/^\d{1,9}$/.test(String(raw))) throw new SocialError("INVALID_PAGINATION", "Pagination values must be whole numbers.", 400);
  const n = Number(raw);
  if (n < min || n > max) throw new SocialError("INVALID_PAGINATION", `Pagination values must be between ${min} and ${max}.`, 400);
  return n;
};

module.exports = { text, oneOf, list, url, urlList, orcid, integer, boolean, onlyKeys, likeEscape, intParam, PRIVILEGED };
