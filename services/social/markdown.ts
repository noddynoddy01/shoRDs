/**
 * A small, safe Markdown parser for assistant answers. It produces a typed tree; it never produces HTML and never evaluates anything.
 * Supported: paragraphs, "-"/"*" and "1." lists, fenced code, "#" headings (shown as bold lines), block quotes, **bold**, *italic*,
 * `code` and [text](https://link). Raw HTML is shown as plain text. Only https links are links; every other URL stays text.
 * Pure TypeScript with no imports, so it is unit-tested under Node.
 */

export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "italic"; v: string } | { t: "code"; v: string } | { t: "link"; v: string; href: string };
export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "code"; v: string }
  | { t: "quote"; c: Inline[] };

const MAX_INPUT = 12000;
const MAX_BLOCKS = 200;

/** Only https links without credentials qualify. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (!/^https:\/\/[^\s]+$/i.test(s) || s.length > 500) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

const INLINE = /(\*\*([^*\n]+?)\*\*|`([^`\n]+?)`|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|(?<![*\w])\*([^*\n]+?)\*(?![*\w]))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ t: "bold", v: m[2] });
    else if (m[3] !== undefined) out.push({ t: "code", v: m[3] });
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      out.push(href ? { t: "link", v: m[4], href } : { t: "text", v: m[0] });
    } else if (m[6] !== undefined) out.push({ t: "italic", v: m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

export function parseMarkdown(input: string): Block[] {
  const lines = String(input).slice(0, MAX_INPUT).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length && blocks.length < MAX_BLOCKS; i += 1) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i += 1; }
      blocks.push({ t: "code", v: code.join("\n") });
      continue;
    }
    if (line.trim() === "") { flush(); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { flush(); blocks.push({ t: "h", c: parseInline(h[1]) }); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flush(); blocks.push({ t: "quote", c: parseInline(q[1]) }); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*[-*]\s+/, ""))); i += 1; }
      i -= 1;
      blocks.push({ t: "ul", items });
      continue;
    }
    if (/^\s*\d{1,3}[.)]\s+/.test(line)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d{1,3}[.)]\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*\d{1,3}[.)]\s+/, ""))); i += 1; }
      i -= 1;
      blocks.push({ t: "ol", items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** Plain text of an answer, for the Copy button (Markdown markers removed, structure kept). */
export function toPlainText(input: string): string {
  const flat = (c: Inline[]) => c.map((x) => (x.t === "link" ? `${x.v} (${x.href})` : x.v)).join("");
  return parseMarkdown(input)
    .map((b) => {
      if (b.t === "p" || b.t === "h" || b.t === "quote") return flat(b.c);
      if (b.t === "code") return b.v;
      if (b.t === "ul") return b.items.map((x) => `- ${flat(x)}`).join("\n");
      return b.items.map((x, n) => `${n + 1}. ${flat(x)}`).join("\n");
    })
    .join("\n\n");
}
