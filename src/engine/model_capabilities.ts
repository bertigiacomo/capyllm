import { providers } from '@opencode-ai/models/snapshot';

export interface ModelCapabilities {
  id: string;
  provider: string;
  reasoning: boolean;
  reasoningOptions?: any[];
  reasoningEffortValues?: string[];
  budgetTokensLimits?: { min?: number; max?: number };
  temperature: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  contextLimit?: number;
  outputLimit?: number;
}

/**
 * Normalizes provider name for snapshot lookup
 */
function normalizeProviderKey(provider: string): string {
  const p = (provider || '').toLowerCase().trim();
  if (p === 'google') return 'google';
  if (p === 'gemini') return 'google';
  if (p === 'together') return 'togetherai';
  if (p === 'together_ai') return 'togetherai';
  if (p === 'fireworks') return 'fireworks-ai';
  return p;
}

/**
 * Returns typed capabilities for any provider & model, utilizing @opencode-ai/models
 * snapshot with intelligent heuristic fallback for custom or uncataloged models.
 */
export function getModelCapabilities(provider: string, modelId: string): ModelCapabilities {
  const normProvider = normalizeProviderKey(provider);
  const providerModels = (providers as any)[normProvider]?.models || (providers as any)[provider]?.models || {};

  // 1. Direct key match
  let spec = providerModels[modelId];

  // 2. Sub-id match (e.g. 'openai/gpt-4o' -> 'gpt-4o' or vice-versa)
  if (!spec && modelId.includes('/')) {
    const cleanId = modelId.split('/')[1];
    spec = providerModels[cleanId];
  }

  // 3. Search case-insensitively across provider models
  if (!spec) {
    const lowerId = modelId.toLowerCase();
    spec = Object.values(providerModels).find((m: any) => m.id?.toLowerCase() === lowerId);
  }

  // 4. Fallback search across openrouter models if not found in native provider
  if (!spec && normProvider !== 'openrouter') {
    const orModels = (providers as any)['openrouter']?.models || {};
    spec = orModels[modelId] || Object.values(orModels).find((m: any) => m.id?.toLowerCase() === modelId.toLowerCase());
  }

  // 5. Global search across all snapshot providers
  if (!spec) {
    const lowerId = modelId.toLowerCase();
    for (const [pId, p] of Object.entries(providers)) {
      if ((p as any).models?.[modelId]) {
        spec = (p as any).models[modelId];
        break;
      }
      if (modelId.includes('/')) {
        const clean = modelId.split('/')[1];
        if ((p as any).models?.[clean]) {
          spec = (p as any).models[clean];
          break;
        }
      }
      const found = Object.values((p as any).models || {}).find(
        (m: any) => m.id?.toLowerCase() === lowerId || m.id?.toLowerCase().endsWith(`/${lowerId}`)
      );
      if (found) {
        spec = found;
        break;
      }
    }
  }

  if (spec) {
    const reasoningOptions = Array.isArray(spec.reasoning_options) ? spec.reasoning_options : [];
    const effortOpt = reasoningOptions.find((o: any) => o.type === 'effort');
    const budgetOpt = reasoningOptions.find((o: any) => o.type === 'budget_tokens');
    const toggleOpt = reasoningOptions.find((o: any) => o.type === 'toggle');
    const hasReasoning = Boolean(spec.reasoning) || Boolean(effortOpt) || Boolean(budgetOpt) || Boolean(toggleOpt);

    return {
      id: spec.id || modelId,
      provider: normProvider,
      reasoning: hasReasoning,
      reasoningOptions,
      reasoningEffortValues: effortOpt?.values,
      budgetTokensLimits: budgetOpt ? { min: budgetOpt.min, max: budgetOpt.max } : undefined,
      temperature: spec.temperature !== false,
      toolCall: Boolean(spec.tool_call),
      structuredOutput: Boolean(spec.structured_output),
      contextLimit: spec.limit?.context,
      outputLimit: spec.limit?.output,
    };
  }

  // 6. Dynamic frontier fallback for uncataloged or brand-new models
  // Modern frontier models are reasoning-first and reject legacy sampling parameters (temperature, top_p)
  return {
    id: modelId,
    provider: normProvider,
    reasoning: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
    reasoningEffortValues: ['low', 'medium', 'high'],
    budgetTokensLimits: undefined,
    temperature: false,
    toolCall: true,
    structuredOutput: true,
  };
}

export interface AdaptationTrace {
  requested_model: string;
  target_model: string;
  target_provider: string;
  effective_policy: string;
  reasoning_supported: boolean;
  reasoning_type?: 'effort' | 'budget_tokens' | 'none';
  client_reasoning_effort?: string;
  client_budget_tokens?: number;
  adapted_reasoning_effort?: string;
  adapted_budget_tokens?: number;
  reasoning_tokens?: number;
  output_preview?: string;
  temperature_supported: boolean;
  stripped_parameters: string[];
  transformations: string[];
  original_params: Record<string, any>;
  adapted_params: Record<string, any>;
  failover_history?: any[];
}

/**
 * Deep-clones and adapts a request payload for a target model and reasoning policy.
 * - Enforces reasoning policy: 'inherit' | 'low' | 'medium' | 'high' | 'max' | 'none' | 'fast'
 * - Automatically translates between reasoning dialects:
 *     * OpenAI dialect (reasoning_effort): clamps effort to model-approved values
 *     * Anthropic dialect (thinking: { type: 'enabled', budget_tokens }): computes tokens respecting min/max
 *     * Open Reasoning dialect (budget_tokens): injects tokens into payload
 * - Strips reasoning from non-reasoning models (zero 400 Bad Request errors)
 * - Strips temperature & top_p from models with temperature: false (e.g. o1, o3, modern frontier models)
 * - Optionally records detailed human-readable explanation trace for auditing & UI inspection
 */
export function adaptPayloadForTargetModel(
  parsedBody: any,
  targetModel: string,
  targetProvider: string = 'openai',
  reasoningPolicy: string = 'inherit',
  traceCollector?: { trace?: AdaptationTrace }
): any {
  if (!parsedBody || typeof parsedBody !== 'object') {
    return parsedBody;
  }

  // Deep clone to avoid mutating original request across failover retries
  const adapted = JSON.parse(JSON.stringify(parsedBody));
  adapted.model = targetModel;

  const caps = getModelCapabilities(targetProvider, targetModel);
  const policy = (reasoningPolicy || 'inherit').toLowerCase().trim();
  const isNonePolicy = policy === 'none' || policy === 'fast';

  const strippedParams: string[] = [];
  const transformations: string[] = [];

  const originalParams: Record<string, any> = {};
  for (const k of [
    'model', 'reasoning_effort', 'thinking', 'budget_tokens',
    'temperature', 'top_p', 'presence_penalty', 'frequency_penalty',
    'max_tokens', 'max_completion_tokens',
    'logprobs', 'top_logprobs', 'logit_bias', 'service_tier',
    'previous_response_id', 'store', 'stream'
  ]) {
    if (parsedBody[k] !== undefined) {
      originalParams[k] = parsedBody[k];
    }
  }

  if (parsedBody.model && parsedBody.model !== targetModel) {
    transformations.push(`Modello normalizzato da '${parsedBody.model}' a '${targetModel}' per il fornitore ${targetProvider}`);
  }

  // 1. If target model genuinely does NOT support reasoning
  if (!caps.reasoning) {
    let hadReasoning = false;
    if (adapted.reasoning_effort !== undefined || adapted.thinking !== undefined || adapted.reasoning !== undefined || adapted.budget_tokens !== undefined) {
      hadReasoning = true;
    }
    delete adapted.reasoning_effort;
    delete adapted.thinking;
    delete adapted.reasoning;
    delete adapted.budget_tokens;

    if (hadReasoning) {
      transformations.push(`Rimosso parametro reasoning: il modello ${targetModel} non supporta il ragionamento (reasoning=false)`);
      strippedParams.push('reasoning_effort / thinking');
    }

    if (!caps.temperature) {
      for (const p of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias']) {
        if (adapted[p] !== undefined) {
          strippedParams.push(`${p}: ${JSON.stringify(adapted[p])}`);
          transformations.push(`Rimosso parametro '${p}' (${JSON.stringify(adapted[p])}): ${targetModel} rifiuta parametri di sampling legacy (temperature=false)`);
          delete adapted[p];
        }
      }
    }

    if (traceCollector) {
      const adaptedParams: Record<string, any> = {};
      for (const k of Object.keys(originalParams)) {
        if (adapted[k] !== undefined) adaptedParams[k] = adapted[k];
      }
      traceCollector.trace = {
        requested_model: parsedBody.model || targetModel,
        target_model: targetModel,
        target_provider: targetProvider,
        effective_policy: policy,
        reasoning_supported: false,
        reasoning_type: 'none',
        temperature_supported: caps.temperature,
        stripped_parameters: strippedParams,
        transformations,
        original_params: originalParams,
        adapted_params: adaptedParams,
      };
    }
    return adapted;
  }

  // 2. Target model supports reasoning: determine requested client intent
  let clientEffort: string | undefined = adapted.reasoning_effort;
  let clientBudgetTokens: number | undefined;

  if (adapted.thinking && typeof adapted.thinking === 'object') {
    if (adapted.thinking.type === 'disabled') {
      if (policy === 'inherit') clientEffort = 'none';
    } else if (adapted.thinking.budget_tokens) {
      clientBudgetTokens = Number(adapted.thinking.budget_tokens);
    }
  }

  if (adapted.budget_tokens !== undefined) {
    const bTokens = Number(adapted.budget_tokens);
    if (bTokens === 0 && policy === 'inherit') {
      clientEffort = 'none';
    } else if (bTokens > 0) {
      clientBudgetTokens = bTokens;
    }
  }

  // Determine target dialect requirements purely from models.dev reasoning_options
  const budgetOpt = caps.reasoningOptions?.find((o: any) => o.type === 'budget_tokens') || caps.budgetTokensLimits;
  const effortOpt = caps.reasoningOptions?.find((o: any) => o.type === 'effort');
  const validValues = caps.reasoningEffortValues && caps.reasoningEffortValues.length > 0
    ? caps.reasoningEffortValues
    : ['low', 'medium', 'high'];

  const isBudgetTarget = Boolean(budgetOpt) && (!effortOpt || (clientBudgetTokens !== undefined && !clientEffort));

  if (isBudgetTarget) {
    // Anthropic / Thinking Mode / Open Reasoning dialect
    delete adapted.reasoning_effort;

    const min = budgetOpt?.min !== undefined && budgetOpt.min >= 0 ? budgetOpt.min : 1024;
    const max = budgetOpt?.max !== undefined && budgetOpt.max > min ? budgetOpt.max : 64000;

    let targetTokens: number;
    if (isNonePolicy || clientEffort === 'none') {
      targetTokens = min;
      transformations.push(`Richiesto ragionamento disattivato: impostato al budget minimo consentito (${min} token) per ${targetModel}`);
    } else if (policy !== 'inherit') {
      if (policy === 'low') {
        targetTokens = Math.max(min, Math.min(2048, max));
      } else if (policy === 'medium') {
        targetTokens = Math.max(min, Math.min(8192, max));
      } else {
        targetTokens = Math.max(min, Math.min(32000, max));
      }
      transformations.push(`Applicata policy di pool/route '${policy}': calcolato budget di ${targetTokens} token`);
    } else if (clientBudgetTokens !== undefined) {
      targetTokens = Math.max(min, Math.min(clientBudgetTokens, max));
      transformations.push(`Budget token client (${clientBudgetTokens}) normalizzato entro i limiti del modello: ${targetTokens} token`);
    } else if (clientEffort) {
      const eff = clientEffort.toLowerCase();
      if (eff === 'low') targetTokens = Math.max(min, Math.min(2048, max));
      else if (eff === 'medium') targetTokens = Math.max(min, Math.min(8192, max));
      else targetTokens = Math.max(min, Math.min(32000, max));
      transformations.push(`Tradotto client reasoning_effort '${clientEffort}' in budget_tokens: ${targetTokens} (dialetto thinking per ${targetModel})`);
    } else {
      // Client did not request reasoning and policy is inherit: passthrough without injecting thinking
      targetTokens = undefined as any;
    }

    if (targetTokens !== undefined) {
      adapted.thinking = { type: 'enabled', budget_tokens: targetTokens };
      adapted.budget_tokens = targetTokens;
    }
  } else {
    // Effort dialect
    delete adapted.thinking;
    delete adapted.budget_tokens;

    let chosenEffort: string | undefined;
    if (isNonePolicy) {
      if (validValues.includes('none')) {
        chosenEffort = 'none';
        transformations.push(`Policy '${policy}': impostato reasoning_effort su 'none'`);
      } else if (validValues.includes('minimal')) {
        chosenEffort = 'minimal';
        transformations.push(`Policy '${policy}': modello richiede reasoning attivo obbligatorio, impostato al minimo ('minimal')`);
      } else {
        chosenEffort = validValues[0];
        transformations.push(`Policy '${policy}': modello richiede reasoning attivo, impostato al livello base ('${chosenEffort}')`);
      }
    } else if (policy !== 'inherit') {
      chosenEffort = policy;
      transformations.push(`Applicata policy di pool/route: '${policy}'`);
    } else if (clientEffort) {
      chosenEffort = clientEffort.toLowerCase();
      if (chosenEffort === 'none') {
        if (validValues.includes('none')) chosenEffort = 'none';
        else if (validValues.includes('minimal')) {
          chosenEffort = 'minimal';
          transformations.push(`Client ha richiesto 'none', ma ${targetModel} richiede reasoning attivo: adattato a 'minimal'`);
        } else {
          chosenEffort = validValues[0];
          transformations.push(`Client ha richiesto 'none', ma ${targetModel} richiede reasoning attivo: adattato al valore consentito '${chosenEffort}'`);
        }
      }
    } else if (clientBudgetTokens !== undefined) {
      if (clientBudgetTokens <= 2048) chosenEffort = 'low';
      else if (clientBudgetTokens <= 12000) chosenEffort = 'medium';
      else chosenEffort = 'high';
      transformations.push(`Tradotto budget_tokens client (${clientBudgetTokens}) in reasoning_effort: '${chosenEffort}'`);
    } else {
      // Pure passthrough: client did not ask for reasoning and policy is inherit
      chosenEffort = undefined;
    }

    // Clamp effort to model-supported values dynamically from models.dev if requested
    if (chosenEffort !== undefined) {
      if (validValues.includes(chosenEffort)) {
        adapted.reasoning_effort = chosenEffort;
      } else if (chosenEffort === 'max') {
        adapted.reasoning_effort = validValues.includes('max')
          ? 'max'
          : validValues.includes('xhigh')
          ? 'xhigh'
          : validValues.includes('high')
          ? 'high'
          : validValues[validValues.length - 1];
        transformations.push(`reasoning_effort 'max' adattato a '${adapted.reasoning_effort}' per conformità con ${targetModel}`);
      } else if (chosenEffort === 'high') {
        adapted.reasoning_effort = validValues.includes('high')
          ? 'high'
          : validValues.includes('max')
          ? 'max'
          : validValues[validValues.length - 1];
        transformations.push(`reasoning_effort 'high' adattato a '${adapted.reasoning_effort}' per conformità con ${targetModel}`);
      } else if (chosenEffort === 'low') {
        adapted.reasoning_effort = validValues.includes('low')
          ? 'low'
          : validValues.includes('minimal')
          ? 'minimal'
          : validValues[0];
        transformations.push(`reasoning_effort 'low' adattato a '${adapted.reasoning_effort}' per conformità con ${targetModel}`);
      } else if (chosenEffort === 'medium') {
        adapted.reasoning_effort = validValues.includes('medium')
          ? 'medium'
          : validValues.includes('high')
          ? 'high'
          : validValues[0];
        transformations.push(`reasoning_effort 'medium' adattato a '${adapted.reasoning_effort}' per conformità con ${targetModel}`);
      } else {
        adapted.reasoning_effort = validValues[validValues.length - 1];
        transformations.push(`reasoning_effort '${chosenEffort}' non riconosciuto: impostato sul livello supportato '${adapted.reasoning_effort}'`);
      }
    }
  }

  // Strip temperature & all legacy sampling parameters if target model rejects temperature
  if (!caps.temperature) {
    for (const p of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'logprobs', 'top_logprobs', 'logit_bias']) {
      if (adapted[p] !== undefined) {
        strippedParams.push(`${p}: ${JSON.stringify(adapted[p])}`);
        transformations.push(`Rimosso parametro legacy '${p}' (${JSON.stringify(adapted[p])}): ${targetModel} rifiuta sampling legacy (temperature=false)`);
        delete adapted[p];
      }
    }
  }

  if (traceCollector) {
    const adaptedParams: Record<string, any> = {};
    for (const k of [
      'model', 'reasoning_effort', 'thinking', 'budget_tokens',
      'temperature', 'top_p', 'presence_penalty', 'frequency_penalty',
      'max_tokens', 'max_completion_tokens',
      'service_tier', 'previous_response_id', 'store', 'stream'
    ]) {
      if (adapted[k] !== undefined) adaptedParams[k] = adapted[k];
    }
    traceCollector.trace = {
      requested_model: parsedBody.model || targetModel,
      target_model: targetModel,
      target_provider: targetProvider,
      effective_policy: policy,
      reasoning_supported: true,
      reasoning_type: isBudgetTarget ? 'budget_tokens' : 'effort',
      client_reasoning_effort: clientEffort,
      client_budget_tokens: clientBudgetTokens,
      adapted_reasoning_effort: adapted.reasoning_effort,
      adapted_budget_tokens: adapted.budget_tokens ?? (adapted.thinking?.budget_tokens),
      temperature_supported: caps.temperature,
      stripped_parameters: strippedParams,
      transformations,
      original_params: originalParams,
      adapted_params: adaptedParams,
    };
  }

  return adapted;
}
