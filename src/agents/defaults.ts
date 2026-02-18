// Defaults for agent metadata when upstream does not supply them.
// These are empty sentinels; the actual provider/model are set during onboarding.
export const DEFAULT_PROVIDER = "";
export const DEFAULT_MODEL = "";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 128_000;
