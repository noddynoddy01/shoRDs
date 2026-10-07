/**
 * shoRDs production entrypoint (Docker CMD and railway.json both run `node backend/start_local_server.js`).
 *
 * All behaviour lives in backend/runtime.js (assembly) and backend/app.js (HTTP). This file only listens on a port and
 * handles shutdown. Routes:
 *   GET  /health                       liveness only (no dependencies touched)
 *   GET  /ready                        real DB / Redis / auth / AI-provider state
 *   GET  /api/v1/replica               replica identity (public, minimal)
 *   POST /api/v1/projects, GET /api/v1/projects[/:id], PUT /api/v1/projects/:id/members/:uid
 *   POST /api/v1/copilot/query         Claude Sonnet 5.5 over supplied paper text (or a labelled local fallback)
 *   POST /api/v1/analysis, GET /api/v1/analysis/:jobId, POST /api/v1/analysis/:jobId/cancel   persistent jobs
 *   GET  /api/v1/llm/health|metrics    administrators only (ADMIN_UIDS)
 * See docs/AI_RUNTIME_AUDIT.md for the security model and configuration.
 */

const http = require("http");
const { createRuntime } = require("./runtime");
const { parsePort, parseHost } = require("./bootConfig");

// Invalid (not merely missing) configuration stops the process before it listens: a wrong port or a malformed limit must not
// produce a replica that looks alive. Missing dependency configuration is reported by /ready instead (see bootConfig.js).
let PORT;
let HOST;
let runtime;
try {
  PORT = parsePort(process.env.PORT);
  HOST = parseHost(process.env.HOST);
  runtime = createRuntime(process.env);
} catch (e) {
  console.error(`[Boot] invalid configuration: ${e.message}`);
  process.exit(1);
}

const server = http.createServer(runtime.handler);
server.headersTimeout = 15000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 65000;

server.on("error", (e) => {
  // e.g. EADDRINUSE / EACCES: say so plainly and exit non-zero so the platform marks the deployment failed
  console.error(`[Boot] cannot listen on ${HOST}:${PORT} (${e.code || "ERROR"})`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[shoRDs Server] Replica ${runtime.replicaId} listening on http://${HOST}:${PORT}`);
  runtime.startBackground({
    // a migration the database rejected cannot succeed on retry: exit non-zero so the platform marks this deployment failed
    onFatal: () => process.exit(1)
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shoRDs Server] ${signal} received; draining`);
  runtime.beginDrain(); // /ready now answers 503 DRAINING so no new traffic is sent here; /health stays up until exit
  const hard = setTimeout(() => process.exit(1), 20000);
  hard.unref();
  server.close();
  try {
    await runtime.shutdown(10000);
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
