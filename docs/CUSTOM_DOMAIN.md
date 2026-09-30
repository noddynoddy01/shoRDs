# shoRDs Custom Domain & DNS Architecture Guide

This document outlines the step-by-step process for connecting a custom domain (e.g., `shords.ai`, `shords.com`, or `shords.org`) to both the **Vercel Frontend (Single Page Application)** and the **Railway Backend (API Gateway)**.

---

## 1. Architecture Topology

```
                  ┌────────────────────────────────────────┐
                  │          Custom Domain DNS             │
                  │        (Cloudflare / Namecheap)        │
                  └──────┬─────────────────────────┬───────┘
                         │                         │
         Apex / WWW CNAME│                         │ api. CNAME
                         ▼                         ▼
         ┌────────────────────────┐       ┌────────────────────────┐
         │     Vercel Edge CDN    │       │   Railway API Gateway  │
         │  (shords.com / www)    │       │   (api.shords.com)     │
         │                        │       │                        │
         │  React Native Web SPA  │       │  Docker Microservice   │
         │   Static Assets        │       │  PostgreSQL & Redis    │
         └───────────┬────────────┘       └───────────▲────────────┘
                     │                                │
                     └─────── EXPO_PUBLIC_API_URL ────┘
```

---

## 2. Step 1: Purchasing / Owning the Domain
1. Purchase a domain from any reputable ICANN-accredited registrar (Cloudflare Registrar, Namecheap, Google Domains / Squarespace, Porkbun).
2. Recommended TLDs for scientific intelligence tools: `.ai`, `.org`, `.com`, `.io`.

---

## 3. Step 2: Configure the Vercel Frontend
1. Open the [Vercel Dashboard](https://vercel.com/dashboard).
2. Select the **`shords`** project.
3. Navigate to **Settings** → **Domains**.
4. Add your apex domain (`shords.com`) and www subdomain (`www.shords.com`).
5. Select "Redirect `shords.com` to `www.shords.com`" (or vice versa according to preference).
6. Note the DNS records provided by Vercel:
   - **A Record**: `@` → `76.76.21.21`
   - **CNAME Record**: `www` → `cname.vercel-dns.com`

---

## 4. Step 3: Configure the Railway Backend
1. Open the [Railway Dashboard](https://railway.app).
2. Select project **`disciplined-dream`** and service **`shords-backend`**.
3. Go to **Settings** → **Networking** → **Public Networking**.
4. Click **Custom Domain** and enter:
   - `api.yourdomain.com` (e.g. `api.shords.com`)
5. Railway will provide a CNAME target:
   - **CNAME Record**: `api` → `<your-service>.up.railway.app`

---

## 5. Step 4: Configure DNS Records at your Registrar
In your DNS provider (e.g. Cloudflare DNS or Namecheap):

| Type | Name | Content / Target | TTL | Proxy Status |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `@` | `76.76.21.21` | Auto | DNS Only / Proxied |
| **CNAME** | `www` | `cname.vercel-dns.com` | Auto | DNS Only / Proxied |
| **CNAME** | `api` | `shords-backend-production.up.railway.app` | Auto | DNS Only (Recommended for WebSocket/TCP) |

---

## 6. Step 5: Update Production Environment Variables

### A. On Railway (`shords-backend`):
Update the allowed CORS origins to trust your new custom domains:
```bash
CORS_ORIGINS=https://www.yourdomain.com,https://yourdomain.com,https://shords.vercel.app,http://localhost:3000
```

### B. On Vercel (`shords`):
Update the API URL pointing to the custom API subdomain:
```bash
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

---

## 7. Step 6: SSL / TLS Verification & Final Smoke Test
1. Vercel and Railway will automatically provision free, auto-renewing **Let's Encrypt SSL/TLS certificates** once DNS propagation completes (usually 2–15 minutes).
2. Verify HTTPS certificate in browser:
   - Visit `https://www.yourdomain.com` (should load the shoRDs UI).
   - Visit `https://api.yourdomain.com/health` (should return `{"status":"UP"}`).
   - Visit `https://api.yourdomain.com/ready` (should return `{"ready":true}`).
