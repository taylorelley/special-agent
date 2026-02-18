---
title: "Model Providers"
description: "Configure AI model providers — Custom Provider, Ollama, and supported APIs"
---

# Model Providers

Special Agent connects to AI model providers for conversation, reasoning, and tool use. The onboarding wizard offers two options: **Custom Provider** (any OpenAI or Anthropic-compatible endpoint) and **Ollama** (local inference).

## Quick rules

- Model references use the format `provider:model-name` (e.g., `openai:gpt-4o`)
- The default provider is set during onboarding
- Multiple providers can be configured simultaneously
- Model failover is supported for resilience

## Custom Provider

Connect to any API that implements the OpenAI or Anthropic protocol. This covers corporate API gateways, Azure OpenAI, AWS Bedrock proxies, and self-hosted inference servers.

### OpenAI-compatible

```json5
{
  models: {
    providers: {
      "corp-openai": {
        type: "openai",
        baseUrl: "https://api-gateway.example.com/v1",
        apiKey: "sk-corp-key-here",
      },
    },
    default: "corp-openai:gpt-4o",
  },
}
```

### Anthropic-compatible

```json5
{
  models: {
    providers: {
      "corp-anthropic": {
        type: "anthropic",
        baseUrl: "https://api-gateway.example.com",
        apiKey: "sk-ant-key-here",
      },
    },
    default: "corp-anthropic:claude-sonnet-4-5-20250929",
  },
}
```

## Ollama (local models)

For local inference without sending data to external APIs:

```json5
{
  models: {
    providers: {
      ollama: {
        type: "openai",
        baseUrl: "http://localhost:11434/v1",
      },
    },
    default: "ollama:llama3.1",
  },
}
```

When running the Gateway in Docker, use `host.docker.internal` to reach Ollama on the host:

```json5
{
  models: {
    providers: {
      ollama: {
        type: "openai",
        baseUrl: "http://host.docker.internal:11434/v1",
      },
    },
  },
}
```

## Runtime API protocols

Under the hood, Special Agent supports four model API protocols:

| Protocol               | Used for                                             |
| ---------------------- | ---------------------------------------------------- |
| `openai-completions`   | OpenAI Chat Completions API (`/v1/chat/completions`) |
| `openai-responses`     | OpenAI Responses API (`/v1/responses`)               |
| `anthropic-messages`   | Anthropic Messages API                               |
| `google-generative-ai` | Google Generative AI (Gemini)                        |

The provider `type` determines which protocol is used. Most OpenAI-compatible proxies work with the `openai` type.

## Multiple providers

Configure multiple providers and select per agent or per request:

```json5
{
  models: {
    providers: {
      fast: {
        type: "openai",
        baseUrl: "https://api.example.com/v1",
        apiKey: "key-fast",
      },
      smart: {
        type: "anthropic",
        baseUrl: "https://api.example.com",
        apiKey: "key-smart",
      },
    },
    default: "fast:gpt-4o-mini",
  },
}
```

### Per-agent model selection

```json5
{
  agents: {
    list: [
      { id: "quick-help", model: { default: "fast:gpt-4o-mini" } },
      { id: "deep-analysis", model: { default: "smart:claude-sonnet-4-5-20250929" } },
    ],
  },
}
```

## Model failover

Configure fallback providers for resilience:

```json5
{
  models: {
    failover: {
      enabled: true,
      providers: ["primary", "backup"],
    },
  },
}
```

If the primary provider fails (timeout, rate limit, error), the Gateway automatically retries with the next provider in the list.

## Embedding providers

For the memory/RAG system (used by the `memory-lancedb` extension), embedding providers generate vector representations:

| Provider      | Configuration                                             |
| ------------- | --------------------------------------------------------- |
| OpenAI        | `embedding.provider: "openai"` with API key               |
| Google Gemini | `embedding.provider: "gemini"` with API key               |
| Voyage AI     | `embedding.provider: "voyage"` with API key               |
| Local GGUF    | `embedding.provider: "local"` with model path (llama.cpp) |

Configure in `memory.embedding` or per the `memory-lancedb` extension config.

## Context window

Override the default context window size for custom providers:

```json5
{
  models: {
    providers: {
      "my-provider": {
        type: "openai",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-...",
        contextWindow: 128000,
      },
    },
  },
}
```

## CLI commands

```bash
# Check model auth status
special-agent models auth-status

# List configured models
special-agent models list

# Set default model
special-agent configure set models.default "provider:model-name"
```

## Troubleshooting

**"No credentials found"** — No API key configured. Set `apiKey` in the provider config or use the corresponding environment variable.

**Slow responses** — Check if the model endpoint is reachable and responsive. Use `special-agent doctor` for diagnostics.

**Context window errors** — The default context window may not match your provider. Set `contextWindow` explicitly in the provider config.

## Related pages

- [Authentication](/security/authentication) — credential management
- [Configuration](/deployment/configuration) — JSON5 config file
- [Multi-Agent Routing](/reference/multi-agent) — per-agent model selection
