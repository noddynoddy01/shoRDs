/**
 * Sentence splitting for scientific prose. Used wherever the app shows a sentence from a paper.
 *
 * Why this exists: the earlier code split on every period. In a scientific abstract that cuts "runs 3.1 times faster" at "3." and keeps the
 * fragment "1 times faster": a wrong number shown as the paper's. A period ends a sentence here only when it is followed by the end of the
 * text or by whitespace and then something that can start a sentence, and it does not follow a known abbreviation or a single initial.
 * Decimals ("93.2"), versions ("v1.2"), DOIs and URLs never contain whitespace after the period, so they are never split.
 *
 * It is a rule-based splitter and will make mistakes on unusual prose (for example a sentence that starts with a lower-case symbol such as "pH").
 * It never alters a character of the text: every returned sentence is an exact slice of the input (surrounding whitespace trimmed).
 */

const ABBREVIATIONS = new Set([
  "e.g", "i.e", "et al", "al", "fig", "figs", "eq", "eqs", "vs", "approx", "cf", "ca", "no", "nos", "ref", "refs", "sec", "secs", "tab", "vol", "pp", "dr", "prof", "mr", "mrs", "ms", "st", "etc", "inc", "ltd", "co", "viz", "resp"
]);

function endsWithAbbreviation(before: string): boolean {
  // `before` is the text up to (not including) the period.
  const m = /([A-Za-z.]+(?: al)?)$/.exec(before);
  if (!m) return false;
  const word = m[1].toLowerCase().replace(/^\.+/, "");
  if (ABBREVIATIONS.has(word)) return true;
  // A single capital letter is treated as an initial ("J. Smith"). When unsure the splitter joins: two sentences shown as one are still whole
  // and unaltered, whereas a cut sentence can change a number.
  return /(^|[\s(])[A-Z]$/.test(before);
}

export function splitSentences(text: string): string[] {
  const s = (text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "." || c === "!" || c === "?") {
      let j = i;
      while (j + 1 < s.length && /[.!?]/.test(s[j + 1])) j++;
      let k = j;
      while (k + 1 < s.length && /["'”’)\]]/.test(s[k + 1])) k++;
      const atEnd = k + 1 >= s.length;
      const spaceAfter = !atEnd && s[k + 1] === " ";
      if (atEnd || spaceAfter) {
        const next = atEnd ? "" : s.slice(k + 2).match(/^[^\s]/)?.[0] ?? "";
        const isPeriodOnly = c === "." && j === i;
        const lowerNext = /[a-z]/.test(next);
        const abbr = isPeriodOnly && endsWithAbbreviation(s.slice(start, i));
        if (atEnd || (!abbr && !(isPeriodOnly && lowerNext))) {
          const sentence = s.slice(start, k + 1).trim();
          if (sentence) out.push(sentence);
          start = k + 1;
        }
      }
      i = k + 1;
      continue;
    }
    i++;
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** The sentences of `text` that match `pattern`, whole and unaltered. */
export function sentencesMatching(text: string, pattern: RegExp): string[] {
  const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  return splitSentences(text).filter(x => re.test(x));
}
