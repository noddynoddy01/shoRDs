# shoRDs Product Overview & Feature Matrix

## 1. Vision & Problem Statement
Academic research is severely constrained by information overload, 100-page dense PDF friction, and disconnected tools. Researchers spend 70% of their time finding, reading, formatting citations, and synthesizing papers rather than innovating.

**shoRDs** is the **5-Stage Research Operating System** designed to streamline scientific exploration from discovery to publication.

---

## 2. The 5-Stage Research Journey

```
+---------------------------------------------------------------------------------------+
|                                5-STAGE RESEARCH JOURNEY                               |
+---------------+----------------+----------------+-----------------+-------------------+
|  1. DISCOVER  | 2. UNDERSTAND  |   3. DISCUSS   |    4. CREATE    |    5. PUBLISH     |
| - ReelCard    | - 4-Section    | - AI Scholarly | - Literature    | - BibTeX Export   |
|   Magazine    |   Smart Digest |   Debates      |   Review Studio | - Zotero / Mendeley|
| - Federated   | - Audio Briefs | - Socratic     | - Citation      | - LaTeX Citation  |
|   arXiv/DOAJ  | - Vector Zoom  |   Research     |   Knowledge     |   Formatting      |
|   Search      |   Figures      |   Tutor        |   Graph         | - PDF Brief Export|
+---------------+----------------+----------------+-----------------+-------------------+
```

---

## 3. Flagship Capabilities & Component Architecture

### A. Swipeable ReelCard Magazine Feed (`components/ReelCard.tsx`, `app/(tabs)/index.tsx`)
- High-efficiency card-based mobile feed presenting core contributions, takeaways, and metrics for recent publications.
- Native gestures for bookmarking, audio playback, and deep inspection.

### B. Smart 4-Section Digest & Text Segmentation (`services/paperSummarizer.ts`)
- Automatically segments scientific literature into four structured dimensions:
  1. **Background & Objective** (Problem Framing)
  2. **Core Methodology** (Architectural Innovations & Experimental Setup)
  3. **Empirical Results** (Quantitative Metrics & Benchmark Comparisons)
  4. **Key Takeaways & Limitations** (Practical Insights)

### C. Contextual Audio Brief Player (`components/AudioBriefPlayer.tsx`, `services/audioService.ts`)
- Natural TTS voice synthesis with humanized pacing, breathing pauses, and domain-specific pronunciation dictionaries.

### D. Citation Knowledge Graph (`components/ResearchGraphModal.tsx`, `services/researchGraphService.ts`)
- Visual interactive node-link network mapping predecessor papers, co-citations, methodological lineage, and influence scores.

### E. Multi-Agent Literature Review Studio (`services/literatureReviewStudioService.ts`)
- Collaborative multi-agent synthesis drafting publication-quality literature reviews with verified in-line citations and comparative matrix tables.

### F. Academic Ecosystem Export (`services/citationService.ts`, `components/BibtexExportModal.tsx`)
- Instant one-click exports in **BibTeX**, **APA**, **IEEE**, **MLA**, and **RIS (Zotero/Mendeley)** formats.
