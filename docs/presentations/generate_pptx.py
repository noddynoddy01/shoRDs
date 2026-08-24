import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def create_presentation():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Elegant Color Palette
    NAVY = RGBColor(6, 9, 19)          # #060913
    SURFACE = RGBColor(17, 24, 39)      # #111827
    CYAN = RGBColor(6, 182, 212)        # #06B6D4
    PURPLE = RGBColor(139, 92, 246)     # #8B5CF6
    GREEN = RGBColor(16, 185, 129)      # #10B981
    TEXT = RGBColor(248, 250, 252)      # #F8FAFC
    MUTED = RGBColor(203, 213, 225)     # #CBD5E1
    SUBDUED = RGBColor(100, 116, 139)   # #64748B

    slides_data = [
        {
            "num": "SLIDE 01",
            "title": "shoRDs — The World's Premier Research OS",
            "subtitle": "Transforming 100-page academic PDFs into swipeable briefs, 3-column desktop workspaces, & 100% independent AI synthesis.",
            "card_title": "PROJECT SPECS & EXECUTIVES",
            "points": [
                "Abhinav Prakash · Lead Architect & Founder (IIIT Surat)",
                "Dual-Platform Architecture: React Native Mobile APK + Next.js Desktop Web OS PWA",
                "Supported by ₹2.5 Lakhs Seed Grant for Open-Access Academic Infrastructure"
            ]
        },
        {
            "num": "SLIDE 02",
            "title": "The Academic Bottleneck & PDF Friction",
            "subtitle": "Why 5 Million Annual Manuscripts Remain Trapped & Hard to Digest",
            "card_title": "THE INDUSTRY PAIN POINTS",
            "points": [
                "Cognitive Overload: Researchers waste 70% of reading time skimming dense introductions for 1 key equation.",
                "Fragmented Workflows: Constant bouncing between PDF readers, Zotero citation managers, ChatGPT tabs, & Excel matrices.",
                "Third-Party Cloud AI Risks: Reliance on external API keys leads to privacy breaches, hallucinations, & rate limits."
            ]
        },
        {
            "num": "SLIDE 03",
            "title": "The Solution — Dual-Platform shoRDs OS",
            "subtitle": "A Re-imagined 5-Stage Research Journey Built for Speed & Precision",
            "card_title": "THE UNIFIED PLATFORM SOLUTION",
            "points": [
                "Mobile APK Experience: Swipeable magazine cards, audio speech summaries, 1-tap card briefs.",
                "Desktop Web OS: 3-Column Reader, resizable split view, Spotlight search (Ctrl+K), & SVG knowledge graph.",
                "Privacy-First Local Intelligence: Deterministic extraction tying insights directly to exact line numbers and verified DOIs."
            ]
        },
        {
            "num": "SLIDE 04",
            "title": "Unique Selling Propositions (USPs)",
            "subtitle": "Breakthrough Differentiators Setting shoRDs Apart From Traditional Readers",
            "card_title": "CORE DIFFERENTIATORS",
            "points": [
                "100% Independent Local AI: Zero external API key dependencies (Gemini/Claude/Perplexity). 100% private.",
                "AI Scholarly Paper Debates: Simulates thesis debates between conflicting methodologies & matrix performance trade-offs.",
                "4-Phase Implementation Roadmaps: Converts theoretical paper sections into actionable 4-step execution guides.",
                "Instant Academic Citation Exports: One-tap BibTeX, RIS, APA, IEEE, & MLA code generator for Zotero/LaTeX."
            ]
        },
        {
            "num": "SLIDE 05",
            "title": "Deep Full-Stack Technical Architecture",
            "subtitle": "Decoupled Mobile Native & Desktop PWA Shell with Shared Local Core",
            "card_title": "TECHNICAL SYSTEM ARCHITECTURE",
            "points": [
                "Mobile App Stack: React Native, Expo Router v3, Reanimated 3, Native Android Speech Engine.",
                "Desktop Web OS PWA: Service Workers, PWA Manifest.json, Vanilla TS, Flexbox/Grid canvas.",
                "Unified Storage & Sync: Shared LocalStorage + IndexedDB real-time state synchronization engine."
            ]
        },
        {
            "num": "SLIDE 06",
            "title": "100% Independent Local AI Engine",
            "subtitle": "Deterministic Text Processing & High-Trust Citation Integrity",
            "card_title": "LOCAL INTELLIGENCE & CITATION INTEGRITY",
            "points": [
                "Zero Cloud Lock-In: Runs completely self-contained without requiring external API tokens.",
                "Structured Extraction: Automatically parses Context, Technical Approach, Results, & Future Scope.",
                "Hallucination Shield: Ties generated insights directly to validated Crossref/arXiv DOI metadata."
            ]
        },
        {
            "num": "SLIDE 07",
            "title": "The 5-Stage Research Journey",
            "subtitle": "End-to-End Workflow Optimization for Students, Researchers, & Faculty",
            "card_title": "THE 5 WORKFLOW STAGES",
            "points": [
                "1. DISCOVER: Swipeable magazine feed, voice triggers, & semantic topic search.",
                "2. UNDERSTAND: 3-column workspace reader, zoomable figure inspector, & 4-5 section tabs.",
                "3. DISCUSS: Scholar faculty profiles, H-index counters, & consultation slot booking.",
                "4. CREATE: Research identity contribution score (94.2), 14-day streak tracker, & library archives.",
                "5. PUBLISH: Publishing Studio with PDF drag-and-drop, arXiv link fetcher, & custom domain selector."
            ]
        },
        {
            "num": "SLIDE 08",
            "title": "Desktop Flagship Tools & Power Features",
            "subtitle": "High-Density Productivity Suite Designed for 8-Hour Desktop Sessions",
            "card_title": "DESKTOP PRODUCTIVITY SUITE",
            "points": [
                "Spotlight Search (Ctrl + K): Command palette modal searching paper titles, DOIs, authors, & slash commands.",
                "Interactive SVG Knowledge Graph: Visual node mapping linking authors, papers, institutions, & methods.",
                "Multi-Column Comparison Matrix: Side-by-side table comparing Method, Dataset, Accuracy, & Weaknesses.",
                "Floating Waveform Mini Player: Synced audio playback with speed controls (1.0x, 1.5x, 2.0x)."
            ]
        },
        {
            "num": "SLIDE 09",
            "title": "Academic Ecosystem Integration",
            "subtitle": "Native Compatibility with Leading Citation Managers & Publishing Archives",
            "card_title": "ECOSYSTEM COMPATIBILITY",
            "points": [
                "Zotero & Mendeley Sync: Auto-generates clean RIS files for 1-click import into reference managers.",
                "LaTeX & Overleaf Ready: Formats copyable @article BibTeX blocks for instant paper authoring.",
                "arXiv & DOI Metadata Extractor: Automatically parses paper title, author, and abstract from URLs."
            ]
        },
        {
            "num": "SLIDE 10",
            "title": "Real-Time Cross-Device Sync Engine",
            "subtitle": "Seamless Transition Between Smartphone & Desktop Workstations",
            "card_title": "CROSS-DEVICE STATE SYNCHRONIZATION",
            "points": [
                "Reading Progress Sync: Resumes reading from the exact sentence when switching devices.",
                "Universal State Sync: Bookmarks, margin notes, audio playback timestamp, & collections stay 100% in sync.",
                "Offline-First Capability: PWA ServiceWorker caches paper briefs for offline reading."
            ]
        },
        {
            "num": "SLIDE 11",
            "title": "Live Demonstration Walkthrough Script",
            "subtitle": "3-Minute Live Workflow Demonstration",
            "card_title": "LIVE DEMO TIMELINE",
            "points": [
                "Step 1 (0:00-0:45): Mobile swipeable cards, audio speech narration, & stack opening.",
                "Step 2 (0:45-1:45): Desktop Web OS (http://localhost:8080), Ctrl+K Spotlight search, & 3-column reader.",
                "Step 3 (1:45-2:30): 1-click BibTeX citation copying & AI Thesis Debate simulation.",
                "Step 4 (2:30-3:00): Desktop Publishing Studio PDF drag-and-drop & instant brief publication."
            ]
        },
        {
            "num": "SLIDE 12",
            "title": "Business Vision & ₹2.5 Lakhs Fund Allocation",
            "subtitle": "Scaling Open-Access Infrastructure Across Universities & Global Institutes",
            "card_title": "FUNDING DEPLOYMENT BREAKDOWN",
            "points": [
                "40% Infrastructure & Local AI Storage: Deploying vector indexing nodes for zero-latency retrieval.",
                "35% Open-Access Outreach: Onboarding university faculty and research scholars across IIITs/IITs.",
                "25% Mobile & PWA Performance Engineering: Low-bandwidth optimization for regional research access.",
                "Contact: Abhinav Prakash · IIIT Surat · abhinavprakash0401@gmail.com"
            ]
        }
    ]

    for data in slides_data:
        slide = prs.slides.add_slide(blank_layout)

        # Background shape
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = NAVY
        bg.line.fill.background()

        # Accent Cyan Line
        line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(0.4), Inches(11.733), Inches(0.05))
        line.fill.solid()
        line.fill.fore_color.rgb = CYAN
        line.line.fill.background()

        # Top Slide Num Badge
        badge = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.6), Inches(1.5), Inches(0.35))
        badge.fill.solid()
        badge.fill.fore_color.rgb = RGBColor(15, 23, 42)
        badge.line.color.rgb = CYAN
        btf = badge.text_frame
        bp = btf.paragraphs[0]
        bp.text = data["num"]
        bp.font.name = "Inter"
        bp.font.size = Pt(10)
        bp.font.bold = True
        bp.font.color.rgb = CYAN
        bp.alignment = PP_ALIGN.CENTER

        # Header Box
        header_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.0), Inches(11.733), Inches(1.2))
        tf = header_box.text_frame
        tf.word_wrap = True

        p0 = tf.paragraphs[0]
        p0.text = data["title"]
        p0.font.name = "Inter"
        p0.font.size = Pt(24)
        p0.font.bold = True
        p0.font.color.rgb = TEXT

        p1 = tf.add_paragraph()
        p1.text = data["subtitle"]
        p1.font.name = "Inter"
        p1.font.size = Pt(13)
        p1.font.color.rgb = CYAN
        p1.space_before = Pt(4)

        # Main Card Box
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(2.3), Inches(11.733), Inches(4.4))
        card.fill.solid()
        card.fill.fore_color.rgb = SURFACE
        card.line.color.rgb = RGBColor(31, 41, 55)

        # Points Text Box
        points_box = slide.shapes.add_textbox(Inches(1.1), Inches(2.5), Inches(11.133), Inches(4.0))
        ptf = points_box.text_frame
        ptf.word_wrap = True

        cp0 = ptf.paragraphs[0]
        cp0.text = f"❖   {data['card_title']}"
        cp0.font.name = "Inter"
        cp0.font.size = Pt(12)
        cp0.font.bold = True
        cp0.font.color.rgb = PURPLE

        for pt in data["points"]:
            p = ptf.add_paragraph()
            p.text = f"✦   {pt}"
            p.font.name = "Inter"
            p.font.size = Pt(14)
            p.font.color.rgb = MUTED
            p.space_before = Pt(10)
            p.line_spacing = Pt(20)

        # Footer
        footer_box = slide.shapes.add_textbox(Inches(0.8), Inches(6.85), Inches(11.733), Inches(0.4))
        ftf = footer_box.text_frame
        fp = ftf.paragraphs[0]
        fp.text = "shoRDs Research Operating System — IIIT Surat · Lead Architect: Abhinav Prakash"
        fp.font.name = "Inter"
        fp.font.size = Pt(10)
        fp.font.color.rgb = SUBDUED

    prs.save("D:/shords/shoRDs_Master_Presentation.pptx")
    prs.save("D:/shords/website/shoRDs_Master_Presentation.pptx")
    prs.save("C:/Users/abhin/.gemini/antigravity/brain/73e750c0-27f8-4e19-a690-c88aa04fdfa0/shoRDs_Master_Presentation.pptx")
    print("Successfully generated updated shoRDs_Master_Presentation.pptx!")

if __name__ == "__main__":
    create_presentation()
