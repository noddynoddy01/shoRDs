# shoRDs LLM Security & Secret Protection Standards

## 1. Secret Isolation Invariants

1. **Server-Side Exclusivity**: LLM API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LLM_API_KEY`) reside exclusively in backend environment variables.
2. **Zero Bundle Inclusion**: Frontend, React Native, Expo, and Android APK assets are strictly isolated from provider credentials.
3. **Zero Layer Persistence**: Docker images do not bake `.env` or credentials into any image layers.
4. **Zero Log/Error Leakage**: Error handlers sanitize provider error bodies, stripping API key substrings, authorization headers, and raw session tokens.

---

## 2. Institutional Privacy & Data Residency Controls

1. **Tenant Approved Providers**: Tenants can restrict approved AI vendors (e.g. only Anthropic, or on-premise local models).
2. **Prompt Sanitization**: PII (SSNs, credit card formats, credentials) is automatically redacted before dispatch.
3. **Cache Key Isolation**: Redis keys use `shords:v1:llm:{tenantId}:{projectId}:{hash}` to enforce strict multi-tenant isolation.
