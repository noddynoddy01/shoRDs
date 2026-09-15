# 🚀 shoRDs — The World's Premier Research Operating System

<div align="center">

![shoRDs Logo](assets/logo.png)

**Transforming 100-page academic papers into interactive, grounded, multimodal research intelligence.**

[![CI / Regression Tests](https://img.shields.io/badge/Tests-1074%2F1074%20Passed-brightgreen)](docs/testing/PHASE_42_ZERO_COST_FINAL_AUDIT.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25%20TypeSafe-blue)](tsconfig.json)
[![Docker](https://img.shields.io/badge/Docker-Multi--Container%20Ready-2496ED)](docker-compose.yml)
[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20Web%20PWA-3DDC84)](docs/android/ANDROID_BUILD_AND_RELEASE.md)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

## 📌 Table of Contents
1. [Overview & Problem Statement](#-overview--problem-statement)
2. [Key Capabilities & Features](#-key-capabilities--features)
3. [System Architecture](#-system-architecture)
4. [Technology Stack](#-technology-stack)
5. [Repository Structure](#-repository-structure)
6. [Quick Start & Local Setup](#-quick-start--local-setup)
7. [Docker Multi-Service Environment](#-docker-multi-service-environment)
8. [Automated Testing & Verification](#-automated-testing--verification)
9. [Android Native Build](#-android-native-build)
10. [Security & Privacy](#-security--privacy)
11. [Project Documentation & History](#-project-documentation--history)

---

## 🔬 Overview & Problem Statement
Academic researchers, scholars, and R&D teams lose up to 70% of their productive time manually navigating dense, 100-page PDFs, cross-referencing citations, extracting figures, and re-formatting bibliographies.

**shoRDs** is an open-access, AI-powered **Research Operating System** that converts complex scientific publications into:
- **Swipeable ReelCard Summaries**: 4-section structured digests (Objective, Methodology, Results, Takeaways).
- **Interactive Citation Knowledge Graphs**: Visual lineage and influence networks across scientific domains.
- **Natural Voice Audio Briefs**: Humanized TTS with breathing pauses for mobile audio learning.
- **Multi-Agent Literature Review Studio**: Automated drafting of literature reviews with verified in-line citations.
- **Universal Academic Exports**: One-click exports in BibTeX, APA, IEEE, MLA, and Zotero/Mendeley formats.

---

## 🌟 Key Capabilities & Features

### 1. 5-Stage Research Journey
```
[1. Discover]   -> Swipeable mobile reel magazine & federated arXiv/DOAJ search
[2. Understand] -> 4-Section Smart Digests, vector figure zoom, & audio briefs
[3. Discuss]    -> AI Scholarly Debates & Socratic research tutoring
[4. Create]     -> Multi-Agent Literature Review Studio & Citation Knowledge Graphs
[5. Publish]    -> Instant BibTeX, Zotero RIS, and LaTeX bibliography exports
```

### 2. Multi-Provider AI Gateway (`services/llm/`)
- **Supported Providers**: Anthropic Claude 3.5 Sonnet, OpenAI GPT-4o, Google Gemini 1.5 Pro, and Local Deterministic Engine.
- **Cost & Budget Protection**: Real-time token accounting, strict spending limits, and zero-cost local fallback.
- **Resilience & Circuit Breaking**: Exponential backoff, jitter, and automatic provider failover.
- **Grounding Verification**: Rejects ungrounded claims or hallucinated citations before presenting them to users.

---

## 🏛️ System Architecture

```
+-------------------------------------------------------------------------------+
|                            CLIENT PLATFORMS                                   |
|  - Mobile App (React Native / Expo SDK 52)  - Desktop Web OS (PWA Platform)   |
+---------------------------------------+---------------------------------------+
                                        | (REST / WebSocket API / Port 4000)
                                        v
+-------------------------------------------------------------------------------+
|                  NODE.JS / EXPRESS HTTP GATEWAY (backend/server.ts)           |
|  - JWT Bearer Session Context               - Request Deduplication & Coalesce|
|  - Multi-Tenant Rate Limiting (300 RPM)     - Multi-Provider LLM Router       |
+-------------------+-----------------------------------+-----------------------+
                    |                                   |
                    v                                   v
+-----------------------------------+   +---------------------------------------+
|  DATA PERSISTENCE LAYER           |   |  REDIS CACHING LAYER (Port 6379)      |
|  - PostgresDatabaseAdapter        |   |  - RedisCacheAdapter                  |
|  - 5-Stage Schema Migrations      |   |  - Key Partition: shords:v1:{t}:{p}   |
|  - ACID Transaction Boundaries    |   |  - Versioned Invalidation on Mutation |
+-----------------------------------+   +---------------------------------------+
                    |
                    v
+-------------------------------------------------------------------------------+
|                PYTHON RESEARCH & EVIDENCE PIPELINE (Port 8000)                |
|  - FastAPI & Celery Task Worker             - PDF Parsing & Figure Extraction |
|  - Federated arXiv / CrossRef Search        - Adversarial Claim Verification  |
+-------------------------------------------------------------------------------+
```

---

## 💻 Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Mobile Frontend** | React Native 0.79, Expo SDK 52, Expo Router, TypeScript |
| **Desktop / Web** | PWA, HTML5/CSS3 Grid, Service Workers, Canvas |
| **Backend Gateway** | Node.js v20, Express, TypeScript |
| **AI & Search Engines** | Python 3.11/3.13, FastAPI, Celery, PyTorch, PyMuPDF |
| **Persistence & Cache**| PostgreSQL 16, Redis 7.2 (with SQLite / In-Memory Parity) |
| **Containerization** | Docker, Docker Compose Multi-Stage Build |
| **Mobile Native** | Android SDK 34, Kotlin, Gradle 8.13 |

---

## 📂 Repository Structure

```
shoRDs/
├── app/                  # Expo Router mobile & desktop screens
├── android/              # Native Android project (Kotlin, Gradle)
├── assets/               # Branding, logos, and UI assets
├── backend/              # Node.js gateway & Python research services
│   ├── providers/        # LLM provider implementations
│   └── tests/            # 1,070 automated regression test suites
├── components/           # Reusable UI cards, graphs, modals, players
├── config/               # Production runtime configuration
├── constants/            # Design themes and domain definitions
├── context/              # Global React contexts (Theme, Auth, Session)
├── data/                 # Sample papers & scholarly benchmarks
├── docs/                 # Organized project documentation
│   ├── architecture/     # System architecture & scorecards
│   ├── ai/               # LLM provider setup, security, & cost control
│   ├── backend/          # Backend API & pipeline specifications
│   ├── deployment/       # Production readiness & release gates
│   ├── security/         # Tenant isolation & security specifications
│   ├── testing/          # Test execution reports & audits
│   ├── android/          # Native Android build and signing guide
│   ├── product/          # Product overview & 5-stage research journey
│   ├── presentations/    # Master pitch decks & defense guides
│   ├── phases/           # Production milestone validation reports
│   └── releases/         # Release candidate logs & checklists
├── hooks/                # Custom React hooks (useFeedMetrics, etc.)
├── services/             # Core business logic, LLM gateway, and adapters
├── types/                # TypeScript models & interface definitions
├── website/              # Official shoRDs landing page & PWA assets
├── .env.example          # Safe environment template with placeholders
├── .gitignore            # Hardened version control exclusions
├── .dockerignore         # Lean Docker build context exclusions
├── docker-compose.yml    # Multi-service stack (App, Postgres, Redis)
├── Dockerfile            # Multi-stage production container build
├── CHANGELOG.md          # Full project evolution changelog
├── package.json          # Project dependencies & scripts
└── tsconfig.json         # TypeScript compiler configuration
```

---

## 🚀 Quick Start & Local Setup

### 1. Prerequisites
- **Node.js**: `v20.x` or higher
- **Python**: `3.11` or higher
- **Docker**: (Optional, for full stack orchestration)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/noddynoddy01/shoRDs.git
cd shoRDs

# Install frontend & gateway dependencies
npm install --legacy-peer-deps

# Create local environment config from template
cp .env.example .env
```

### 3. Running the Development Server
```bash
# Start the Expo application
npx expo start

# Start the local backend gateway
node backend/start_local_server.js
```

---

## 🐳 Docker Multi-Service Environment

Launch the entire stack (Node Gateway, PostgreSQL 16, Redis 7.2) with one command:

```bash
# Validate Docker compose configuration
docker compose config

# Build and start services in background
docker compose up -d

# Check running status & health
docker compose ps
```

---

## 🧪 Automated Testing & Verification

Run the full **1,070-test regression suite** locally for free (zero external API credits consumed):

```bash
# Run full Python research engine test suite (Phases 1-44)
python backend/tests/run_all_tests.py

# Run static TypeScript type check
npx tsc --noEmit
```

---

## 📱 Android Native Build

```bash
cd android

# Dry-run task validation
./gradlew tasks --dry-run

# Build debug APK
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🛡️ Security & Privacy

- **Zero Secrets Policy**: API keys are resolved exclusively on the server and are never committed.
- **Tenant Isolation**: Cache keys and database queries enforce `shords:v1:{tenantId}:{projectId}` boundaries.
- **Privacy Guard**: Automatically sanitizes PII and credentials from outgoing prompts.
- **Prompt Injection Defense**: Untrusted PDF text is enclosed in strict XML boundary markers.

---

## 📚 Project Documentation & History

- [Complete Development Timeline](docs/DEVELOPMENT_TIMELINE.md)
- [System Architecture](docs/architecture/LLM_PROVIDER_ARCHITECTURE.md)
- [Backend Architecture](docs/backend/BACKEND_ARCHITECTURE.md)
- [Security & Isolation](docs/security/SECURITY_AND_TENANT_ISOLATION.md)
- [Master Technical Presentation Deck](docs/presentations/master_presentation_deck.md)
- [Technical Defense Guide](docs/presentations/technical_defense_guide.md)
- [Changelog](CHANGELOG.md)
