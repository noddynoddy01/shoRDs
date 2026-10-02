/**
 * TypeScript server skeleton for shoRDs Research Intelligence OS (Phase 41).
 *
 * NOT THE PRODUCTION ENTRYPOINT. Docker and railway.json run `node backend/start_local_server.js`
 * (assembled in backend/runtime.js, HTTP in backend/app.js), which has real Firebase ID-token verification,
 * project authorization, Redis rate limiting, an honest /ready and persistent jobs. This class has none of that:
 * its adapters are stubs, so it must not serve traffic. Its copilot handler therefore fails closed instead of
 * trusting any Authorization header (it used to hand every caller OWNER rights in "tenant_primary").
 */

import { ProductionConfigManager } from "../config/productionConfig";
import { PostgresDatabaseAdapter } from "../services/postgresDatabaseAdapter";
import { RedisCacheAdapter } from "../services/redisCacheAdapter";
import { CopilotExecutionPipelineService } from "../services/copilotExecutionPipelineService";
import { AIGateway } from "../services/llm/aiGateway";

export class ProductionServer {
  private configManager = ProductionConfigManager.getInstance();
  private dbAdapter = PostgresDatabaseAdapter.getInstance();
  private cacheAdapter = RedisCacheAdapter.getInstance();
  private aiGateway = AIGateway.getInstance();
  private isRunning: boolean = false;

  async start(): Promise<void> {
    const validation = this.configManager.validateProductionReadiness();
    if (!validation.isValid && process.env.NODE_ENV === "production") {
      throw new Error(`FAIL_FAST_STARTUP: Missing required production environment variables: ${validation.missingVariables.join(", ")}`);
    }

    await this.dbAdapter.connect();
    await this.cacheAdapter.connect();
    this.isRunning = true;
  }

  async handleHealth(): Promise<{ status: "UP"; timestamp: string }> {
    return {
      status: "UP",
      timestamp: new Date().toISOString()
    };
  }

  async handleReady(): Promise<{ ready: boolean; database: boolean; redis: boolean; aiGateway: boolean }> {
    const dbHealth = await this.dbAdapter.checkHealth();
    const redisHealth = await this.cacheAdapter.checkHealth();
    const isReady = dbHealth.isReady && redisHealth.isReady;

    return {
      ready: isReady,
      database: dbHealth.isReady,
      redis: redisHealth.isReady,
      aiGateway: true
    };
  }

  async handleCopilotQuery(body: any, authHeader?: string): Promise<any> {
    // Authentication lives in backend/security/auth.js (Firebase ID-token verification) and is wired in backend/app.js.
    // This skeleton has no verifier, so it refuses every request rather than inventing an identity.
    void body;
    void authHeader;
    void CopilotExecutionPipelineService;
    throw new Error("NOT_SUPPORTED: backend/server.ts is not the production server; use backend/start_local_server.js");
  }

  async handleLLMHealth(): Promise<any> {
    return this.aiGateway.healthCheckAll();
  }

  async handleLLMMetrics(tenantId: string = "tenant_primary"): Promise<any> {
    return this.aiGateway.getCostManager().getTenantMetrics(tenantId);
  }

  async shutdown(): Promise<void> {
    await this.dbAdapter.close();
    await this.cacheAdapter.close();
    this.isRunning = false;
  }
}
