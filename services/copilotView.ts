/**
 * Pure helpers for the Research Copilot screen (no React, no imports), so they are unit-tested in Node.
 */

/** Example questions. They only fill the box; the person still presses Ask. */
export const EXAMPLE_QUESTIONS = [
  "What problem does this paper address?",
  "What method do the authors use?",
  "What are the main results?",
  "What limitations do the authors state?"
] as const;

/** Turns what a person typed into the reference the backend accepts (doi:, pmid:, arxiv:), or null if it is none of them. */
export function normalizePaperRef(raw: string): string | null {
  const t = raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (!t) return null;
  let m = /^doi:\s*(10\.\d{4,9}\/\S+)$/i.exec(t) || /^(10\.\d{4,9}\/\S+)$/.exec(t);
  if (m) return `doi:${m[1].toLowerCase()}`;
  m = /^(?:pmid:?\s*)?(\d{1,9})$/i.exec(t);
  if (m) return `pmid:${m[1]}`;
  m = /^(?:arxiv:?\s*)((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)$/i.exec(t);
  if (m) return `arxiv:${m[1]}`;
  return null;
}

export type AnswerPart = { kind: "text"; text: string } | { kind: "cite"; indexes: number[]; raw: string };

/** Splits an answer into plain text and citations. A bracket is a citation only when every id in it is one of the server's evidence chunks. */
export function splitAnswer(answer: string, evidence: { chunkId: string }[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const re = /\[([^\[\]\n]{1,400})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer))) {
    const ids = m[1].split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
    const indexes = ids.map((id) => evidence.findIndex((e) => e.chunkId === id));
    if (ids.length === 0 || indexes.some((i) => i < 0)) continue;
    if (m.index > last) parts.push({ kind: "text", text: answer.slice(last, m.index) });
    parts.push({ kind: "cite", indexes, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

