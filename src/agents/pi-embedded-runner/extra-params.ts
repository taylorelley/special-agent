import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream, streamSimple } from "@mariozechner/pi-ai";
import type { SpecialAgentConfig } from "../../config/config.js";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import { log } from "./logger.js";

/**
 * Resolve provider-specific extra params from model config.
 * Used to pass through stream params like temperature/maxTokens.
 *
 * @internal Exported for testing only
 */
export function resolveExtraParams(params: {
  cfg: SpecialAgentConfig | undefined;
  provider: string;
  modelId: string;
}): Record<string, unknown> | undefined {
  const modelKey = `${params.provider}/${params.modelId}`;
  const modelConfig = params.cfg?.agents?.defaults?.models?.[modelKey];
  return modelConfig?.params ? { ...modelConfig.params } : undefined;
}

type CacheRetention = "none" | "short" | "long";
type CacheRetentionStreamOptions = Partial<SimpleStreamOptions> & {
  cacheRetention?: CacheRetention;
};

/**
 * Resolve cacheRetention from extraParams, supporting both new `cacheRetention`
 * and legacy `cacheControlTtl` values for backwards compatibility.
 *
 * Mapping: "5m" → "short", "1h" → "long"
 *
 * Only applies to Anthropic provider (OpenRouter uses openai-completions API
 * with hardcoded cache_control, not the cacheRetention stream option).
 */
function resolveCacheRetention(
  extraParams: Record<string, unknown> | undefined,
  _provider: string,
): CacheRetention | undefined {
  // Prefer new cacheRetention if present
  const newVal = extraParams?.cacheRetention;
  if (newVal === "none" || newVal === "short" || newVal === "long") {
    return newVal;
  }

  // Fall back to legacy cacheControlTtl with mapping
  const legacy = extraParams?.cacheControlTtl;
  if (legacy === "5m") {
    return "short";
  }
  if (legacy === "1h") {
    return "long";
  }
  return undefined;
}

function createStreamFnWithExtraParams(
  baseStreamFn: StreamFn | undefined,
  extraParams: Record<string, unknown> | undefined,
  provider: string,
): StreamFn | undefined {
  if (!extraParams || Object.keys(extraParams).length === 0) {
    return undefined;
  }

  const streamParams: CacheRetentionStreamOptions = {};
  if (typeof extraParams.temperature === "number") {
    streamParams.temperature = extraParams.temperature;
  }
  if (typeof extraParams.maxTokens === "number") {
    streamParams.maxTokens = extraParams.maxTokens;
  }
  const cacheRetention = resolveCacheRetention(extraParams, provider);
  if (cacheRetention) {
    streamParams.cacheRetention = cacheRetention;
  }

  if (Object.keys(streamParams).length === 0) {
    return undefined;
  }

  log.debug(`creating streamFn wrapper with params: ${JSON.stringify(streamParams)}`);

  const underlying = baseStreamFn ?? streamSimple;
  const wrappedStreamFn: StreamFn = (model, context, options) =>
    underlying(model, context, {
      ...streamParams,
      ...options,
    });

  return wrappedStreamFn;
}

const NON_STREAMING_TIMEOUT_MS = 120_000;

/**
 * Check if streaming is disabled for a model in the config.
 */
function isStreamingDisabled(
  cfg: SpecialAgentConfig | undefined,
  provider: string,
  modelId: string,
): boolean {
  const modelKey = `${provider}/${modelId}`;
  const modelConfig = cfg?.agents?.defaults?.models?.[modelKey];
  return modelConfig?.streaming === false;
}

/**
 * Build a simplified OpenAI-compatible message array from the pi-ai Context.
 * Handles user, assistant, and toolResult messages.
 */
function convertContextToOpenAIMessages(context: Context): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (context.systemPrompt) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const msg of context.messages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((c) => c.type === "text")
              .map((c) => (c as { text: string }).text)
              .join("\n");
      messages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const parts: string[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push(block.text);
        } else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.arguments) },
          });
        }
      }
      const entry: Record<string, unknown> = { role: "assistant" };
      if (parts.length > 0) {
        entry.content = parts.join("");
      }
      if (toolCalls.length > 0) {
        entry.tool_calls = toolCalls;
      }
      messages.push(entry);
    } else if (msg.role === "toolResult") {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("\n");
      messages.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: text,
      });
    }
  }
  return messages;
}

/**
 * Build an OpenAI-compatible tools array from pi-ai Tool definitions.
 */
function convertToolsToOpenAI(tools: Context["tools"]): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Create a non-streaming streamFn that makes a POST with `stream: false`
 * and converts the response into an AssistantMessageEventStream.
 *
 * Works around SDK issue #1205 where streaming is hardcoded for
 * openai-completions, causing hangs with some providers (e.g. Ollama).
 */
function createNonStreamingStreamFn(): StreamFn {
  return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    (async () => {
      try {
        const baseUrl = model.baseUrl.endsWith("/") ? model.baseUrl : `${model.baseUrl}/`;
        const url = new URL("chat/completions", baseUrl).href;
        const apiKey = options?.apiKey ?? "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...model.headers,
          ...options?.headers,
        };

        const messages = convertContextToOpenAIMessages(context);
        const body: Record<string, unknown> = {
          model: model.id,
          messages,
          stream: false,
        };
        if (options?.maxTokens) {
          body.max_tokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
          body.temperature = options.temperature;
        }
        const tools = convertToolsToOpenAI(context.tools);
        if (tools) {
          body.tools = tools;
        }

        const res = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: options?.signal,
          },
          NON_STREAMING_TIMEOUT_MS,
        );

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(`Non-streaming request failed: ${errText}`);
        }

        const json = (await res.json()) as {
          choices?: Array<{
            message?: {
              role?: string;
              content?: string;
              tool_calls?: Array<Record<string, unknown>>;
            };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const choice = json.choices?.[0];
        const responseText = choice?.message?.content ?? "";
        const toolCalls = choice?.message?.tool_calls;
        const finishReason = choice?.finish_reason ?? "stop";

        // Usage
        if (json.usage) {
          output.usage.input = json.usage.prompt_tokens ?? 0;
          output.usage.output = json.usage.completion_tokens ?? 0;
          output.usage.totalTokens = json.usage.total_tokens ?? 0;
        }

        stream.push({ type: "start", partial: output });

        // Text content
        if (responseText) {
          output.content.push({ type: "text", text: responseText });
          const contentIndex = output.content.length - 1;
          stream.push({ type: "text_start", contentIndex, partial: output });
          stream.push({ type: "text_delta", contentIndex, delta: responseText, partial: output });
          stream.push({ type: "text_end", contentIndex, content: responseText, partial: output });
        }

        // Tool calls
        if (toolCalls) {
          for (const tc of toolCalls) {
            const fn = tc.function as { name?: string; arguments?: string } | undefined;
            const argsStr = fn?.arguments ?? "{}";
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(argsStr);
            } catch {
              /* use empty */
            }
            const toolCall = {
              type: "toolCall" as const,
              id: String(tc.id ?? ""),
              name: fn?.name ?? "",
              arguments: parsedArgs,
            };
            output.content.push(toolCall);
            const contentIndex = output.content.length - 1;
            stream.push({ type: "toolcall_start", contentIndex, partial: output });
            stream.push({
              type: "toolcall_end",
              contentIndex,
              toolCall,
              partial: output,
            });
          }
        }

        output.stopReason =
          finishReason === "length"
            ? "length"
            : toolCalls && toolCalls.length > 0
              ? "toolUse"
              : "stop";

        stream.push({
          type: "done",
          reason: output.stopReason as "stop" | "length" | "toolUse",
          message: output,
        });
      } catch (err) {
        output.stopReason = "error";
        output.errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({ type: "error", reason: "error", error: output });
      }
    })();

    return stream;
  };
}

/**
 * Apply extra params (like temperature) to an agent's streamFn.
 * Also adds OpenRouter app attribution headers when using the OpenRouter provider.
 * When `streaming: false` is configured for the model, replaces the streamFn with
 * a non-streaming implementation (works around SDK issue #1205 for Ollama).
 *
 * @internal Exported for testing
 */
export function applyExtraParamsToAgent(
  agent: { streamFn?: StreamFn },
  cfg: SpecialAgentConfig | undefined,
  provider: string,
  modelId: string,
  extraParamsOverride?: Record<string, unknown>,
): void {
  // If streaming is disabled for this model, replace the streamFn entirely
  // with a non-streaming implementation that uses `stream: false`.
  if (isStreamingDisabled(cfg, provider, modelId)) {
    log.debug(`streaming disabled for ${provider}/${modelId}; using non-streaming streamFn`);
    agent.streamFn = createNonStreamingStreamFn();
    return;
  }

  const extraParams = resolveExtraParams({
    cfg,
    provider,
    modelId,
  });
  const override =
    extraParamsOverride && Object.keys(extraParamsOverride).length > 0
      ? Object.fromEntries(
          Object.entries(extraParamsOverride).filter(([, value]) => value !== undefined),
        )
      : undefined;
  const merged = Object.assign({}, extraParams, override);
  const wrappedStreamFn = createStreamFnWithExtraParams(agent.streamFn, merged, provider);

  if (wrappedStreamFn) {
    log.debug(`applying extraParams to agent streamFn for ${provider}/${modelId}`);
    agent.streamFn = wrappedStreamFn;
  }
}
