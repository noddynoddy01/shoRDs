"use strict";
/**
 * Boot-time validation that must not depend on any dependency being up. A value that is present but invalid stops the process
 * with a clear message (and exit code 1) instead of letting it listen on a wrong port or half-work.
 * Missing dependency configuration (DATABASE_URL, REDIS_URL, FIREBASE_PROJECT_ID) is deliberately NOT a crash: the process stays
 * up so /health answers and /ready reports exactly what is missing (NOT_CONFIGURED), and the deployment health check
 * (railway.json -> /ready) keeps a replica that is not ready from receiving traffic.
 */

class BootConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "BootConfigError";
  }
}

/** PORT must be an integer 1..65535. Unset means the default; anything else is an error (never silently NaN or 0). */
function parsePort(raw, fallback = 4000) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const text = String(raw).trim();
  if (!/^\d{1,5}$/.test(text)) throw new BootConfigError("PORT must be an integer between 1 and 65535");
  const n = Number(text);
  if (n < 1 || n > 65535) throw new BootConfigError("PORT must be an integer between 1 and 65535");
  return n;
}

/** HOST must be a non-empty host or address string (no scheme, no path, no spaces). */
function parseHost(raw, fallback = "0.0.0.0") {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const text = String(raw).trim();
  if (!/^[A-Za-z0-9._:\-\[\]]+$/.test(text)) throw new BootConfigError("HOST must be a host name or IP address");
  return text;
}

module.exports = { BootConfigError, parsePort, parseHost };
