"use strict";
/**
 * The single place the production runtime runs a copilot/analysis query. Both the synchronous route
 * (POST /api/v1/copilot/query) and the background worker (analysis jobs) call this, so cache, de-duplication, model
 * selection, telemetry and the Sonnet 5.5 request rules are applied identically on both paths.
 */

const { handleCopilotQuery, validateRequest, PROMPT_VERSION } = require("./copilotService");
const { resolveApiKey, resolveModelConfig } = require("./anthropicClient");
const { cachedCopilotQuery } = require("./resultCache");

/**
 * @param {object} rawBody
 * @param {{tenantId:string, projectId:string}} scope  audience for cache isolation
 * @param {object} deps { env, telemetry, replicaId, cache, client?, logger?, now? }
 */
function runCopilot(rawBody, scope, deps) {
  const { env = process.env, telemetry, replicaId, cache = null, client, logger = console, now = Date.now } = deps;
  const modelCfg = resolveModelConfig(env);
  return cachedCopilotQuery({
    cache,
    copilot: (body) => handleCopilotQuery(body, { env, telemetry, replicaId, client, logger, now }),
    validate: validateRequest,
    rawBody,
    scope,
    model: modelCfg.model,
    promptVersion: PROMPT_VERSION,
    hasProviderKey: Boolean(resolveApiKey(env)),
    replicaId,
    now,
    telemetry
  });
}

module.exports = { runCopilot };
