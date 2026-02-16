import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { AuthChoice } from "./onboard-types.js";
import { buildAuthChoiceOptions } from "./auth-choice-options.js";

export async function promptAuthChoiceGrouped(params: {
  prompter: WizardPrompter;
  store: AuthProfileStore;
  includeSkip: boolean;
}): Promise<AuthChoice> {
  const options = buildAuthChoiceOptions(params);

  const selection = (await params.prompter.select({
    message: "Model/auth provider",
    options: options.map((opt) => ({
      value: opt.value,
      label: opt.label,
      hint: opt.hint,
    })),
  })) as AuthChoice;

  return selection;
}
