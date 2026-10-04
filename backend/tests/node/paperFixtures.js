"use strict";
/**
 * TEST FIXTURES ONLY (never imported by production code; a test checks that).
 *
 * Hand-written payloads shaped like the real provider responses (OpenAlex work, Europe PMC search result, Europe PMC JATS
 * full text, arXiv Atom, arXiv/LaTeXML HTML). The papers are FICTIONAL, so no figure here can be mistaken for a real
 * finding. Real-provider behaviour is checked separately by `node scripts/verify_retrieval_live.js` where the network allows.
 */

const FIXTURE_DOI = "10.9999/fixture.sparse.2021";
const FIXTURE_PMID = "99000001";
const FIXTURE_PMCID = "PMC9900001";
const FIXTURE_ARXIV = "2101.00001";
const OTHER_DOI = "10.9999/fixture.other.2020";

const para = (...s) => s.join(" ");

const INTRO = [
  para("Long-context language models struggle to retrieve facts that appear far from the question. Existing attention variants reduce cost but degrade recall on distant evidence.", "We study whether routing tokens to a small set of learned memory slots can keep recall high while cutting compute."),
  para("Our contributions are threefold. First, we introduce Sparse Attention Routing (SAR), a layer that assigns each token to at most four memory slots. Second, we provide a training recipe that keeps routing stable.", "Third, we release a benchmark of 1,200 long-document questions with annotated evidence spans.")
];
const METHODS = [
  para("SAR replaces the dense attention of every fourth transformer layer. Each token is projected to a routing vector and assigned to its top-k slots by dot product, with k set to 4.", "Slots are updated with an exponential moving average of the assigned token states, using a decay of 0.97."),
  para("We train on 38 billion tokens of public web text and fine-tune on the benchmark training split for three epochs with a learning rate of 2e-5. Training used 64 accelerators for nine days.", "The routing temperature is annealed linearly from 1.0 to 0.1 over the first 20 percent of training.")
];
const RESULTS = [
  para("On the benchmark test split SAR reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline and 82.6 percent for a sliding-window baseline.", "Inference latency at 128k tokens falls from 41.2 seconds to 18.7 seconds per query."),
  para("Ablations show that removing the moving-average update reduces accuracy to 83.0 percent, and that using k equal to 1 reduces it to 80.9 percent.", "Accuracy is stable across five random seeds, with a standard deviation of 0.6 points.")
];
const DISCUSSION = [
  para("The gains concentrate on questions whose evidence lies more than 64k tokens from the question. For shorter spans the methods are statistically indistinguishable.", "We attribute this to slots acting as a compressed long-term store.")
];
const LIMITS = [
  para("We evaluated only English text and a single model scale of 7 billion parameters. The benchmark was annotated by three people, and we did not measure annotator agreement on the evidence spans.", "Routing adds a hyperparameter set that we tuned on the validation split only.")
];
const CONCLUSION = [para("Sparse Attention Routing keeps long-range recall high at lower cost. Future work will test larger models and multilingual data.")];

const ABSTRACT = "Long-context language models lose recall on distant evidence. We propose Sparse Attention Routing (SAR), which routes tokens to a small set of learned memory slots. On a new benchmark of 1,200 questions, SAR reaches 87.4 percent exact match versus 79.1 percent for a dense baseline while cutting latency at 128k tokens by more than half.";
const TITLE = "Sparse Attention Routing for Long-Context Retrieval";
const AUTHORS = ["Ada Fixture", "Bo Example", "Chandra Placeholder"];

const jatsSec = (title, paras, inner = "") => `<sec><title>${title}</title>${paras.map((p) => `<p>${p} <xref ref-type="bibr" rid="B1">[1]</xref></p>`).join("")}${inner}</sec>`;

function jats({ title = TITLE, abstract = ABSTRACT, withBody = true, bodySecs = null, intro = INTRO, methods = METHODS, results = RESULTS, discussion = DISCUSSION, limits = LIMITS, conclusion = CONCLUSION } = {}) {
  const secs = bodySecs || [
    jatsSec("1. Introduction", intro),
    jatsSec("2. Methods", methods, jatsSec("2.1 Training setup", [methods[1]])),
    jatsSec("3. Results", results, `<table-wrap id="T1"><caption><p>Exact-match accuracy on the test split.</p></caption><table><thead><tr><th>Model</th><th>Accuracy (%)</th><th>Latency (s)</th></tr></thead><tbody><tr><td>Dense</td><td>79.1</td><td>41.2</td></tr><tr><td>Sliding window</td><td>82.6</td><td>25.0</td></tr><tr><td>SAR</td><td>87.4</td><td>18.7</td></tr></tbody></table></table-wrap><fig id="F1"><caption><p>Accuracy as a function of evidence distance.</p></caption></fig>`),
    jatsSec("4. Discussion", discussion),
    jatsSec("5. Limitations", limits),
    jatsSec("6. Conclusion", conclusion),
    `<sec><title>Acknowledgements</title><p>We thank the reviewers for their comments and the compute provider for credits.</p></sec>`,
    `<sec><title>Data availability</title><p>The benchmark is available from the authors on request.</p></sec>`
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD v1.2 20190208//EN" "JATS-archivearticle1.dtd">
<article xmlns:xlink="http://www.w3.org/1999/xlink" article-type="research-article">
<front><article-meta><title-group><article-title>${title}</article-title></title-group>
<abstract><p>${abstract}</p></abstract></article-meta></front>
${withBody ? `<body>${secs.join("")}</body>` : ""}
<back><ref-list><ref id="B1"><mixed-citation>Someone S. A cited work. 2019.</mixed-citation></ref></ref-list></back>
</article>`;
}

const ltxPara = (t) => `<div class="ltx_para"><p class="ltx_p">${t}</p></div>`;
function arxivHtml({ title = TITLE } = {}) {
  return `<!DOCTYPE html><html><head><title>${title}</title><script>var secret = "should never be read";</script><style>.x{}</style></head><body>
<article class="ltx_document"><h1 class="ltx_title ltx_title_document">${title}</h1>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6><p class="ltx_p">${ABSTRACT}</p></div>
<section class="ltx_section" id="S1"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">1 </span>Introduction</h2>${INTRO.map(ltxPara).join("")}</section>
<section class="ltx_section" id="S2"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">2 </span>Methods</h2>${METHODS.map(ltxPara).join("")}
<section class="ltx_subsection" id="S2.SS1"><h3 class="ltx_title ltx_title_subsection">Routing objective</h3>${ltxPara("The routing loss is <math alttext=\"L = L_{task} + \\lambda L_{route}\"><mi>L</mi></math> with lambda set to 0.01.")}</section></section>
<section class="ltx_section" id="S3"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">3 </span>Results</h2>${RESULTS.map(ltxPara).join("")}
<figure class="ltx_table"><figcaption class="ltx_caption">Table 1: Exact-match accuracy on the test split.</figcaption><table class="ltx_tabular"><tr><th>Model</th><th>Accuracy (%)</th></tr><tr><td>Dense</td><td>79.1</td></tr><tr><td>SAR</td><td>87.4</td></tr></table></figure>
<figure class="ltx_figure"><figcaption class="ltx_caption">Figure 1: Accuracy as a function of evidence distance.</figcaption></figure></section>
<section class="ltx_section" id="S4"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">4 </span>Limitations</h2>${LIMITS.map(ltxPara).join("")}</section>
<section class="ltx_section" id="S5"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">5 </span>Conclusion</h2>${CONCLUSION.map(ltxPara).join("")}</section>
<section class="ltx_bibliography" id="bib"><h2 class="ltx_title ltx_title_bibliography">References</h2><ul class="ltx_biblist"><li class="ltx_bibitem"><span class="ltx_bibblock">Someone. A cited work. 2019.</span></li></ul></section>
</article></body></html>`;
}

const openAlexWork = (over = {}) => ({
  id: "https://openalex.org/W9990000001",
  doi: `https://doi.org/${FIXTURE_DOI}`,
  title: TITLE,
  display_name: TITLE,
  publication_year: 2021,
  ids: { openalex: "https://openalex.org/W9990000001", doi: `https://doi.org/${FIXTURE_DOI}`, pmid: `https://pubmed.ncbi.nlm.nih.gov/${FIXTURE_PMID}`, pmcid: `https://www.ncbi.nlm.nih.gov/pmc/articles/${FIXTURE_PMCID}` },
  authorships: AUTHORS.map((n) => ({ author: { display_name: n } })),
  primary_location: { source: { display_name: "Journal of Fictional Results" }, landing_page_url: `https://doi.org/${FIXTURE_DOI}` },
  locations: [{ landing_page_url: `https://doi.org/${FIXTURE_DOI}`, pdf_url: null }],
  best_oa_location: { license: "cc-by" },
  open_access: { is_oa: true, oa_url: `https://europepmc.org/articles/${FIXTURE_PMCID}` },
  abstract_inverted_index: invert(ABSTRACT),
  ...over
});

function invert(text) {
  const inv = {};
  text.split(" ").forEach((w, i) => {
    (inv[w] = inv[w] || []).push(i);
  });
  return inv;
}

const europePmcSearch = (over = {}) => ({
  hitCount: 1,
  resultList: {
    result: [{
      id: FIXTURE_PMID, source: "MED", pmid: FIXTURE_PMID, pmcid: FIXTURE_PMCID, doi: FIXTURE_DOI, title: `${TITLE}.`,
      authorString: "Fixture A, Example B, Placeholder C.", pubYear: "2021", isOpenAccess: "Y", license: "cc by",
      journalInfo: { journal: { title: "Journal of Fictional Results" } }, abstractText: ABSTRACT, ...over
    }]
  }
});

const arxivAtom = ({ id = FIXTURE_ARXIV, title = TITLE, summary = ABSTRACT } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><title>arXiv Query</title>
<entry><id>http://arxiv.org/abs/${id}v2</id><published>2021-01-04T18:00:00Z</published><title>${title}</title><summary>  ${summary}  </summary>
${AUTHORS.map((n) => `<author><name>${n}</name></author>`).join("")}</entry></feed>`;

const arxivNotFound = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv Query</title><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title><summary>incorrect id format</summary></entry></feed>`;


// ---------------------------------------------------------------------------------------------------------------
// A small fictional "scholarly web" for integration tests: several papers behind fake provider endpoints.
// ---------------------------------------------------------------------------------------------------------------
const DOI_B = "10.9999/fixture.graph.2020";
const DOI_ABSTRACT = "10.9999/fixture.abstract.2022";
const DOI_META = "10.9999/fixture.meta.2019";
const DOI_MISSING = "10.9999/fixture.missing.2018";

const B_TITLE = "Graph Pruning for Edge Inference";
const B_ABSTRACT = "Deploying graph neural networks on edge devices is limited by memory. We present a structured pruning method that removes 62 percent of edges while preserving accuracy. On three citation graphs the pruned model retains 93.2 percent top-1 accuracy and runs 3.1 times faster on a mobile processor.";
const B_RESULTS = [
  "On the citation graphs the pruned model retains 93.2 percent top-1 accuracy compared with 94.0 percent for the unpruned model. Inference on a mobile processor is 3.1 times faster, and peak memory falls from 410 MB to 150 MB.",
  "Pruning more than 62 percent of edges reduces accuracy sharply, to 88.5 percent at 80 percent sparsity. The method was tested on three graphs with fewer than 20,000 nodes each."
];
const B_METHODS = [
  "Edges are scored by a learned importance weight and the lowest scoring edges are removed in rounds of 10 percent. After each round the model is fine-tuned for five epochs with a learning rate of 1e-3.",
  "We use a two layer graph convolution with 64 hidden units. Training used a single accelerator for six hours per graph."
];

const FIXTURE_PAPERS = {
  [FIXTURE_DOI]: { doi: FIXTURE_DOI, pmid: FIXTURE_PMID, pmcid: FIXTURE_PMCID, title: TITLE, abstract: ABSTRACT, oa: true, jats: () => jats() },
  [DOI_B]: {
    doi: DOI_B, pmid: "99000002", pmcid: "PMC9900002", title: B_TITLE, abstract: B_ABSTRACT, oa: true,
    jats: () => jats({ title: B_TITLE, abstract: B_ABSTRACT, intro: ["Graph neural networks are widely used, yet memory limits their deployment on edge devices. We study how many edges can be removed without hurting accuracy.", "We contribute a structured pruning schedule and an evaluation on three public citation graphs."], methods: B_METHODS, results: B_RESULTS, discussion: ["Gains are largest for sparse graphs. Dense graphs lose accuracy earlier, which we attribute to redundant paths being more informative."], limits: ["Only small graphs were tested and the speedups were measured on one processor. We did not study heterophilous graphs."], conclusion: ["Structured edge pruning reduces memory at a small cost in accuracy. Larger graphs remain future work."] })
  },
  [DOI_ABSTRACT]: { doi: DOI_ABSTRACT, pmid: null, pmcid: null, title: "A Paper Without Open Access Full Text", abstract: "This fictional study examines how reading order affects comprehension of dense technical prose. Participants who read summaries first scored 12 percent higher on a delayed recall test than participants who read the full text first, across 96 volunteers.", oa: false },
  [DOI_META]: { doi: DOI_META, pmid: null, pmcid: null, title: "A Record With Metadata Only", abstract: "", oa: false }
};

/** N distinct fictional full-text papers (for tests that need many different papers). */
function bulkPapers(n, base = FIXTURE_PAPERS) {
  const out = { ...base };
  for (let i = 0; i < n; i++) {
    const doi = `10.9999/fixture.bulk${i}.2020`;
    const title = `Bulk Study Number ${i} of Fictional Systems`;
    const abstract = `Study ${i} of a fictional system reports that a simple scheduling rule reduces mean waiting time by ${10 + i} percent across 48 simulated workloads.`;
    out[doi] = { doi, pmid: `9800${String(i).padStart(4, "0")}`, pmcid: `PMC98${String(i).padStart(5, "0")}`, title, abstract, oa: true, jats: () => jats({ title, abstract }) };
  }
  return out;
}

/** A fake of the HTTP function used by backend/papers/providers.js, serving FIXTURE_PAPERS. Counts calls per provider host. */
function createFixtureHttp({ papers = FIXTURE_PAPERS, fail = null } = {}) {
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    if (fail && fail(url)) return { status: 503, headers: {}, body: "{}" };
    const json = (b) => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const notFound = { status: 404, headers: {}, body: "{}" };
    let m;
    if ((m = /api\.openalex\.org\/works\/doi:([^?]+)/.exec(url))) {
      const p = papers[decodeURIComponent(m[1])];
      if (!p) return notFound;
      return json(openAlexWork({
        doi: `https://doi.org/${p.doi}`, title: p.title, display_name: p.title,
        ids: { doi: `https://doi.org/${p.doi}`, ...(p.pmid ? { pmid: `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}` } : {}), ...(p.pmcid ? { pmcid: `https://www.ncbi.nlm.nih.gov/pmc/articles/${p.pmcid}` } : {}) },
        open_access: { is_oa: p.oa }, abstract_inverted_index: p.abstract ? invert(p.abstract) : null
      }));
    }
    if ((m = /europepmc\/webservices\/rest\/search\?query=([^&]+)/.exec(url))) {
      const q = decodeURIComponent(m[1]);
      const dm = /DOI:"([^"]+)"/.exec(q);
      const p = dm && papers[dm[1]];
      if (!p) return json({ hitCount: 0, resultList: { result: [] } });
      return json(europePmcSearch({ doi: p.doi, pmid: p.pmid || undefined, pmcid: p.pmcid || undefined, title: `${p.title}.`, abstractText: p.abstract, isOpenAccess: p.oa ? "Y" : "N" }));
    }
    if ((m = /rest\/(PMC\d+)\/fullTextXML/.exec(url))) {
      const p = Object.values(papers).find((x) => x.pmcid === m[1] && x.jats);
      return p ? { status: 200, headers: { "content-type": "application/xml" }, body: p.jats() } : notFound;
    }
    return notFound;
  };
  http.calls = calls;
  http.count = (needle) => calls.filter((u) => u.includes(needle)).length;
  return http;
}

module.exports = {
  FIXTURE_DOI, FIXTURE_PMID, FIXTURE_PMCID, FIXTURE_ARXIV, OTHER_DOI, TITLE, ABSTRACT, AUTHORS,
  jats, arxivHtml, openAlexWork, europePmcSearch, arxivAtom, arxivNotFound,
  METHODS, RESULTS, DOI_B, DOI_ABSTRACT, DOI_META, DOI_MISSING, B_TITLE, FIXTURE_PAPERS, createFixtureHttp, bulkPapers
};
