/**
 * Real TCP Loopback Server Runner for shoRDs (Phase 36)
 * Starts an actual HTTP listener on port 4000 to test real TCP socket requests.
 */

import http from "http";
import { ProductionServer } from "./server";

const serverInstance = new ProductionServer();
const PORT = parseInt(process.env.PORT || "4000", 10);

const httpServer = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if ((url === "/" || url === "") && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "shoRDs API Gateway",
      version: "1.0.0",
      status: "ONLINE",
      frontend: "https://shords.vercel.app",
      endpoints: [
        "/health",
        "/ready",
        "/api/v1/llm/health",
        "/api/v1/llm/metrics",
        "/api/v1/copilot/query"
      ]
    }, null, 2));
    return;
  }

  if (url === "/health" && method === "GET") {
    const health = await serverInstance.handleHealth();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }

  if (url === "/ready" && method === "GET") {
    const ready = await serverInstance.handleReady();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ready));
    return;
  }

  if (url === "/api/v1/copilot/query" && method === "POST") {
    let bodyData = "";
    req.on("data", chunk => {
      bodyData += chunk;
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(bodyData || "{}");
        const authHeader = req.headers.authorization;
        const result = await serverInstance.handleCopilotQuery(body, authHeader);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        const status = err.message.includes("UNAUTHORIZED") ? 401 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND" }));
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[shoRDs Server] Listening on http://127.0.0.1:${PORT}`);
});
