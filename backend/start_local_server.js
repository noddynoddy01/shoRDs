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

const PORT = parseInt(process.env.PORT || "4000", 10);
const HOST = process.env.HOST || "0.0.0.0";

let runtime;
try {
  runtime = createRuntime(process.env);
} catch (e) {
  console.error(`[Boot] invalid configuration: ${e.message}`);
  process.exit(1);
}

const server = http.createServer(runtime.handler);
server.headersTimeout = 15000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 65000;

server.listen(PORT, HOST, () => {
  console.log(`[shoRDs Server] Replica ${runtime.replicaId} listening on http://${HOST}:${PORT}`);
  runtime.startBackground();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shoRDs Server] ${signal} received; draining`);
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
