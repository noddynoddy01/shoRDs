# shoRDs LLM Provider Configuration & Setup Guide

## 1. Environment Configuration

All provider credentials must be supplied via server-side environment variables in `D:\shords\.env`.

```env
# AI Gateway Active Provider (anthropic | openai | gemini | local_deterministic)
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-5-sonnet-20241022

# Provider Credentials
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIzaSy...

# Resilience & Timeouts
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=3
LLM_FALLBACK_ENABLED=true
LLM_CACHE_ENABLED=true
LLM_COST_CONTROL_ENABLED=true
```

---

## 2. Switching Active Providers

To switch the primary provider across the entire stack, update `LLM_PROVIDER` and `LLM_MODEL` in `.env` and recreate the container:

### Anthropic Claude
```powershell
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-5-sonnet-20241022
docker compose up -d --force-recreate app
```

### OpenAI GPT-4o
```powershell
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
docker compose up -d --force-recreate app
```

### Google Gemini
```powershell
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-pro
docker compose up -d --force-recreate app
```
