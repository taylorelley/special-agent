import type { AuthChoice } from "./onboard-types.js";

const PREFERRED_PROVIDER_BY_AUTH_CHOICE: Partial<Record<AuthChoice, string>> = {
  oauth: "anthropic",
  "setup-token": "anthropic",
  "claude-cli": "anthropic",
  token: "anthropic",
  apiKey: "anthropic",
  "openai-codex": "openai-codex",
  "codex-cli": "openai-codex",
  chutes: "chutes",
  "openai-api-key": "openai",
  "openrouter-api-key": "openrouter",
  "ai-gateway-api-key": "vercel-ai-gateway",
  "moonshot-api-key": "moonshot",
  "moonshot-api-key-cn": "moonshot",
  "kimi-code-api-key": "kimi-coding",
  "gemini-api-key": "google",
  "google-antigravity": "google-antigravity",
  "google-gemini-cli": "google-gemini-cli",
  "zai-api-key": "zai",
  "xiaomi-api-key": "xiaomi",
  "litellm-api-key": "litellm",
  "qianfan-api-key": "qianfan",
  "custom-api-key": "custom",
};

export function resolvePreferredProviderForAuthChoice(choice: AuthChoice): string | undefined {
  return PREFERRED_PROVIDER_BY_AUTH_CHOICE[choice];
}
