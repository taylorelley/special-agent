import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardFlow } from "../wizard/onboarding.types.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export async function setupWebTools(
  cfg: SpecialAgentConfig,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
  flow: WizardFlow,
): Promise<SpecialAgentConfig> {
  await prompter.note(
    [
      "web_search uses Brave Search to let your agent look things up online.",
      "web_fetch lets your agent fetch and read web pages (no API key required).",
      "",
      "Docs: https://docs.openclaw.ai/tools/web",
    ].join("\n"),
    "Web tools",
  );

  let enableSearch = false;
  let searchApiKey: string | undefined;
  let enableFetch = true;

  if (flow === "quickstart") {
    enableFetch = true;
    const keyInput = await prompter.text({
      message: "Brave Search API key (leave blank to skip web_search for now)",
      placeholder: "BSA...",
    });
    const key = keyInput.trim();
    if (key) {
      enableSearch = true;
      searchApiKey = key;
    }
  } else {
    enableSearch = await prompter.confirm({
      message: "Enable web_search (Brave Search)?",
      initialValue: Boolean(cfg.tools?.web?.search?.enabled ?? cfg.tools?.web?.search?.apiKey),
    });

    if (enableSearch) {
      const hasExistingKey = Boolean(cfg.tools?.web?.search?.apiKey);
      const keyInput = await prompter.text({
        message: hasExistingKey
          ? "Brave Search API key (leave blank to keep current or use BRAVE_API_KEY)"
          : "Brave Search API key (leave blank to use BRAVE_API_KEY env var)",
        placeholder: hasExistingKey ? "Leave blank to keep current" : "BSA...",
      });
      const key = keyInput.trim();
      if (key) {
        searchApiKey = key;
      } else if (!hasExistingKey) {
        await prompter.note(
          "No key stored. Set BRAVE_API_KEY in the Gateway environment or run configure later.",
          "Web search",
        );
      }
    }

    enableFetch = await prompter.confirm({
      message: "Enable web_fetch (keyless HTTP fetch)?",
      initialValue: cfg.tools?.web?.fetch?.enabled ?? true,
    });
  }

  const nextSearch = {
    ...cfg.tools?.web?.search,
    enabled: enableSearch,
    ...(searchApiKey ? { apiKey: searchApiKey } : {}),
  };

  const nextFetch = {
    ...cfg.tools?.web?.fetch,
    enabled: enableFetch,
  };

  return {
    ...cfg,
    tools: {
      ...cfg.tools,
      web: {
        ...cfg.tools?.web,
        search: nextSearch,
        fetch: nextFetch,
      },
    },
  };
}
