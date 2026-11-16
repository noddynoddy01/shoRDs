"use strict";
/** Fictional, OpenAlex-shaped works for the browser harness. DOIs match backend/tests/node/paperFixtures.js so the real analysis pipeline can resolve them. */
const invert = (text) => { const idx = {}; text.split(/\s+/).forEach((w, i) => { (idx[w] = idx[w] || []).push(i); }); return idx; };
const F = require("../../backend/tests/node/paperFixtures");

const mk = (n, { doi, title, abstract, year, authors, venue, field, cites, oa }) => ({
  id: `https://openalex.org/W9900000${n}`,
  doi: doi ? `https://doi.org/${doi}` : null,
  title, display_name: title,
  publication_year: year,
  cited_by_count: cites,
  authorships: authors.map((a) => ({ author: { display_name: a } })),
  primary_location: { source: { display_name: venue, host_organization_name: venue }, pdf_url: oa ? `https://example.test/pdf/${n}.pdf` : null },
  open_access: { is_oa: !!oa, oa_url: oa ? `https://example.test/pdf/${n}.pdf` : null },
  primary_topic: { display_name: field, field: { display_name: field } },
  abstract_inverted_index: abstract ? invert(abstract) : null
});

const WORKS = [
  mk(1, { doi: F.FIXTURE_DOI, title: F.TITLE, abstract: F.ABSTRACT, year: 2024, authors: F.AUTHORS, venue: "Journal of Fictional Systems", field: "Computer Science", cites: 12, oa: true }),
  mk(2, { doi: F.DOI_B, title: F.B_TITLE, abstract: F.FIXTURE_PAPERS[F.DOI_B].abstract, year: 2023, authors: ["Dee Fixture", "Eli Sample"], venue: "Proceedings of Imaginary Computing", field: "Computer Science", cites: 4, oa: true }),
  mk(3, { doi: F.DOI_ABSTRACT, title: F.FIXTURE_PAPERS[F.DOI_ABSTRACT].title, abstract: F.FIXTURE_PAPERS[F.DOI_ABSTRACT].abstract, year: 2022, authors: ["Fay Placeholder"], venue: "Fictional Cognitive Science Letters", field: "Psychology", cites: 0, oa: false }),
  mk(4, { doi: F.DOI_META, title: F.FIXTURE_PAPERS[F.DOI_META].title, abstract: "", year: 2019, authors: [], venue: "", field: "Medicine", cites: 0, oa: false })
];

function response(url) {
  const u = new URL(url);
  const q = (u.searchParams.get("search") || "").toLowerCase();
  // A query matches a work when its first word is in the title or abstract. Topic filters and feed queries match nothing literally, so they get
  // every fixture work; only the sentinel "zzzz" returns nothing (used to show the empty state).
  const hits = q ? WORKS.filter((w) => `${w.title} ${Object.keys(w.abstract_inverted_index || {}).join(" ")}`.toLowerCase().includes(q.split(/\s+/)[0])) : WORKS;
  const rows = q.includes("zzzz") ? [] : hits.length ? hits : WORKS;
  return { meta: { count: rows.length, page: 1, per_page: 15 }, results: rows.length ? rows : [] };
}
module.exports = { WORKS, response };
