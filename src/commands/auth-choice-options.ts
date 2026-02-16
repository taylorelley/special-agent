import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { AuthChoice } from "./onboard-types.js";

export type AuthChoiceOption = {
  value: AuthChoice;
  label: string;
  hint?: string;
};

export function buildAuthChoiceOptions(params: {
  store: AuthProfileStore;
  includeSkip: boolean;
}): AuthChoiceOption[] {
  void params.store;
  const options: AuthChoiceOption[] = [];

  options.push({
    value: "custom-api-key",
    label: "Custom Provider",
    hint: "Any OpenAI or Anthropic compatible endpoint",
  });
  options.push({
    value: "ollama",
    label: "Ollama",
    hint: "Local Ollama instance",
  });

  if (params.includeSkip) {
    options.push({ value: "skip", label: "Skip for now" });
  }

  return options;
}
