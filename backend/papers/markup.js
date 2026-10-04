"use strict";
/**
 * A small, tolerant XML/HTML tree parser (no dependency can be installed in this project), used to read JATS full-text XML
 * (Europe PMC) and article HTML (arXiv). It is not a general HTML5 parser; it handles what scholarly articles need:
 * nested elements, void elements, comments, CDATA, doctype, entities, <script>/<style> removal.
 *
 * Safety: input size is capped by the caller; nesting depth is capped here; no entity expansion beyond a fixed table
 * (so no "billion laughs"); nothing is ever evaluated.
 */

const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr", "source", "track", "embed", "param"]);
const RAW_TEXT = new Set(["script", "style"]);
const MAX_DEPTH = 200;
const MAX_NODES = 400000;

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", minus: "−", times: "×", plusmn: "±", deg: "°", micro: "µ", mu: "μ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", lambda: "λ", sigma: "σ", le: "≤", ge: "≥", ne: "≠", approx: "≈", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", eacute: "é", egrave: "è", uuml: "ü", ouml: "ö", auml: "ä" };

function decodeEntities(s) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (m, g) => {
    if (g[0] === "#") {
      const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, g) ? NAMED[g] : m;
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    if (!(name in attrs)) attrs[name] = decodeEntities(v);
  }
  return attrs;
}

const NAME_RE = /[a-zA-Z][\w:.-]*/y;
const RAW_CLOSE = { script: /<\/script\s*>/gi, style: /<\/style\s*>/gi };
const MAX_TAG_CHARS = 4096;
const DEFAULT_BUDGET_MS = 4000;

/**
 * Read one start/end tag beginning at src[lt] === "<". Returns null when it is not a well-formed tag (the "<" is then plain
 * text). Cost is bounded by MAX_TAG_CHARS per attempt; quoted attribute values may contain ">".
 */
function readTag(src, lt) {
  let i = lt + 1;
  const closing = src[i] === "/";
  if (closing) i += 1;
  NAME_RE.lastIndex = i;
  const nm = NAME_RE.exec(src);
  if (!nm) return null;
  const nameEnd = i + nm[0].length;
  const limit = Math.min(src.length, lt + MAX_TAG_CHARS);
  let j = nameEnd;
  while (j < limit) {
    const c = src.charCodeAt(j);
    if (c === 62) {
      // ">"
      let attrEnd = j;
      let selfClose = false;
      if (src.charCodeAt(j - 1) === 47 && j - 1 >= nameEnd) {
        selfClose = true;
        attrEnd = j - 1;
      }
      return { closing, name: nm[0].toLowerCase(), attrSrc: src.slice(nameEnd, attrEnd), selfClose, end: j + 1 };
    }
    if (c === 34 || c === 39) {
      const q = src.indexOf(src[j], j + 1);
      if (q === -1 || q >= limit) return null; // unterminated quote: not a tag
      j = q + 1;
      continue;
    }
    j += 1;
  }
  return null;
}

/**
 * @param {string} input
 * @param {{budgetMs?:number}} [opts]
 * @returns {{name:string, attrs:object, children:Array, parent:object|null}} a synthetic root whose children are the document
 * @throws Error("MARKUP_TOO_COMPLEX") when the depth, node or time budget is exceeded
 */
function parse(input, opts = {}) {
  const budgetMs = opts.budgetMs || DEFAULT_BUDGET_MS;
  const t0 = Date.now();
  const root = { name: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let depth = 0;
  let nodes = 0;
  let ops = 0;
  const src = String(input);
  const n = src.length;
  const addText = (t) => {
    if (t) cur.children.push({ text: t });
  };
  let pos = 0;
  while (pos < n) {
    const lt = src.indexOf("<", pos);
    if (lt === -1) {
      addText(decodeEntities(src.slice(pos)));
      break;
    }
    if (lt > pos) addText(decodeEntities(src.slice(pos, lt)));
    if (++ops % 1000 === 0 && Date.now() - t0 > budgetMs) throw new Error("MARKUP_TOO_COMPLEX");

    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      pos = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      addText(src.slice(lt + 9, e === -1 ? n : e));
      pos = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) {
      const e = src.indexOf(">", lt + 2);
      pos = e === -1 ? n : e + 1;
      continue;
    }
    const tag = readTag(src, lt);
    if (!tag) {
      addText("<");
      pos = lt + 1;
      continue;
    }
    pos = tag.end;
    const name = tag.name;
    if (tag.closing) {
      // pop to the matching open element if there is one; stray close tags are ignored
      let node = cur;
      let d = depth;
      while (node && node !== root && node.name !== name) {
        node = node.parent;
        d -= 1;
      }
      if (node && node !== root) {
        cur = node.parent;
        depth = d - 1;
      }
      continue;
    }
    if (++nodes > MAX_NODES) throw new Error("MARKUP_TOO_COMPLEX");
    const el = { name, attrs: parseAttrs(tag.attrSrc), children: [], parent: cur };
    cur.children.push(el);
    if (tag.selfClose || VOID.has(name)) continue;
    if (RAW_TEXT.has(name)) {
      const re = RAW_CLOSE[name];
      re.lastIndex = pos;
      const cm = re.exec(src);
      pos = cm ? cm.index + cm[0].length : n; // raw text of script/style is dropped
      continue;
    }
    cur = el;
    depth += 1;
    if (depth > MAX_DEPTH) throw new Error("MARKUP_TOO_COMPLEX");
  }
  return root;
}

const isEl = (n) => n && typeof n.name === "string";

function* walk(node) {
  for (const c of node.children || []) {
    if (isEl(c)) {
      yield c;
      yield* walk(c);
    }
  }
}

function findAll(node, name) {
  const out = [];
  for (const n of walk(node)) if (n.name === name) out.push(n);
  return out;
}
function findFirst(node, name) {
  for (const n of walk(node)) if (n.name === name) return n;
  return null;
}
const childEls = (node, name) => (node.children || []).filter((c) => isEl(c) && (!name || c.name === name));

/**
 * Plain text of a node. Options: skip(name) -> true drops an element's text. `math` elements contribute their alttext
 * (LaTeXML) so formulas keep their symbols instead of vanishing.
 */
function textOf(node, opts = {}) {
  const skip = opts.skip || (() => false);
  const parts = [];
  const visit = (n) => {
    if (n.text !== undefined) {
      parts.push(n.text);
      return;
    }
    if (skip(n)) return;
    if (n.name === "math") {
      parts.push(n.attrs.alttext ? ` ${n.attrs.alttext} ` : ` ${textOf(n)} `);
      return;
    }
    const block = /^(p|div|br|li|tr|sec|title|caption|h[1-6]|table|figure)$/.test(n.name);
    if (block) parts.push(" ");
    for (const c of n.children) visit(c);
    if (block) parts.push(" ");
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

module.exports = { parse, findAll, findFirst, childEls, textOf, decodeEntities, isEl, walk };
