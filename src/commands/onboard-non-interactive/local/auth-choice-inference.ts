import type { AuthChoice, OnboardOptions } from "../../onboard-types.js";

type AuthChoiceFlag = {
  flag: keyof AuthChoiceFlagOptions;
  authChoice: AuthChoice;
  label: string;
};

type AuthChoiceFlagOptions = Pick<OnboardOptions, "apiKey">;

const AUTH_CHOICE_FLAG_MAP = [
  { flag: "apiKey", authChoice: "custom-api-key", label: "--api-key" },
] satisfies ReadonlyArray<AuthChoiceFlag>;

export type AuthChoiceInference = {
  choice?: AuthChoice;
  matches: AuthChoiceFlag[];
};

// Infer auth choice from explicit provider API key flags.
export function inferAuthChoiceFromFlags(opts: OnboardOptions): AuthChoiceInference {
  const matches = AUTH_CHOICE_FLAG_MAP.filter(({ flag }) => {
    const value = opts[flag];
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return Boolean(value);
  });

  return {
    choice: matches[0]?.authChoice,
    matches,
  };
}
