import type {
  GatewayAuthChoice,
  OnboardMode,
  OnboardOptions,
  ResetScope,
} from "../commands/onboard-types.js";
import type { SpecialAgentConfig } from "../config/config.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { RuntimeEnv } from "../runtime.js";
import type { QuickstartGatewayDefaults, WizardFlow } from "./onboarding.types.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
} from "../agents/context-window-guard.js";
import { listChannelPlugins } from "../channels/plugins/index.js";
import { formatCliCommand } from "../cli/command-format.js";
import { warnIfModelConfigLooksOff } from "../commands/auth-choice.js";
import { applyPrimaryModel, promptDefaultModel } from "../commands/model-picker.js";
import { formatTokenK } from "../commands/models/shared.js";
import { setupChannels } from "../commands/onboard-channels.js";
import { buildEndpointIdFromUrl } from "../commands/onboard-custom.js";
import {
  applyWizardMetadata,
  DEFAULT_WORKSPACE,
  ensureWorkspaceAndSessions,
  handleReset,
  printWizardHeader,
  probeGatewayReachable,
  summarizeExistingConfig,
} from "../commands/onboard-helpers.js";
import { setupInternalHooks } from "../commands/onboard-hooks.js";
import {
  applyOllamaProviderConfig,
  buildOllamaModelDefinition,
  fetchOllamaContextWindow,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_PROVIDER_ID,
  probeOllamaRunning,
} from "../commands/onboard-ollama.js";
import { promptRemoteGatewayConfig } from "../commands/onboard-remote.js";
import { setupSkills } from "../commands/onboard-skills.js";
import {
  DEFAULT_GATEWAY_PORT,
  readConfigFileSnapshot,
  resolveGatewayPort,
  writeConfigFile,
} from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import { finalizeOnboardingWizard } from "./onboarding.finalize.js";
import { configureGatewayForOnboarding } from "./onboarding.gateway-config.js";
import { WizardCancelledError, type WizardPrompter } from "./prompts.js";

async function promptContextWindow(
  prompter: WizardPrompter,
  defaultValue: number,
  detectedLabel?: string,
): Promise<number> {
  const message = detectedLabel
    ? `Max context length (tokens) — detected: ${detectedLabel}`
    : "Max context length (tokens)";
  const raw = await prompter.text({
    message,
    initialValue: String(defaultValue),
    validate: (val) => {
      const n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) {
        return "Please enter a positive integer";
      }
      if (n < CONTEXT_WINDOW_HARD_MIN_TOKENS) {
        return `Context window must be at least ${formatTokenK(CONTEXT_WINDOW_HARD_MIN_TOKENS)} tokens (${CONTEXT_WINDOW_HARD_MIN_TOKENS})`;
      }
      if (n < CONTEXT_WINDOW_WARN_BELOW_TOKENS) {
        return `Warning: ${formatTokenK(n)} tokens is below the recommended ${formatTokenK(CONTEXT_WINDOW_WARN_BELOW_TOKENS)} minimum — performance may suffer`;
      }
      return undefined;
    },
  });
  return parseInt(raw, 10);
}

async function requireRiskAcknowledgement(params: {
  opts: OnboardOptions;
  prompter: WizardPrompter;
}) {
  if (params.opts.acceptRisk === true) {
    return;
  }

  await params.prompter.note(
    [
      "Security warning.",
      "",
      "This agent can read files and run actions on your system.",
      "A bad prompt can trick it into doing unsafe things.",
      "Use allowlists, sandboxing, and least-privilege tools.",
    ].join("\n"),
    "Security",
  );

  const ok = await params.prompter.confirm({
    message: "I understand this is powerful and inherently risky. Continue?",
    initialValue: false,
  });
  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

export async function runOnboardingWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  printWizardHeader(runtime);
  await prompter.intro("SpecialAgent onboarding");
  await requireRiskAcknowledgement({ opts, prompter });

  const snapshot = await readConfigFileSnapshot();
  let baseConfig: SpecialAgentConfig = snapshot.valid ? snapshot.config : {};

  if (snapshot.exists && !snapshot.valid) {
    await prompter.note(summarizeExistingConfig(baseConfig), "Invalid config");
    if (snapshot.issues.length > 0) {
      await prompter.note(
        [
          ...snapshot.issues.map((iss) => `- ${iss.path}: ${iss.message}`),
          "",
          "Docs: https://docs.openclaw.ai/gateway/configuration",
        ].join("\n"),
        "Config issues",
      );
    }
    await prompter.outro(
      `Config invalid. Run \`${formatCliCommand("special-agent doctor")}\` to repair it, then re-run onboarding.`,
    );
    runtime.exit(1);
    return;
  }

  const quickstartHint = `Configure details later via ${formatCliCommand("special-agent configure")}.`;
  const manualHint = "Configure port, network, Tailscale, and auth options.";
  const explicitFlowRaw = opts.flow?.trim();
  const normalizedExplicitFlow = explicitFlowRaw === "manual" ? "advanced" : explicitFlowRaw;
  if (
    normalizedExplicitFlow &&
    normalizedExplicitFlow !== "quickstart" &&
    normalizedExplicitFlow !== "advanced"
  ) {
    runtime.error("Invalid --flow (use quickstart, manual, or advanced).");
    runtime.exit(1);
    return;
  }
  const explicitFlow: WizardFlow | undefined =
    normalizedExplicitFlow === "quickstart" || normalizedExplicitFlow === "advanced"
      ? normalizedExplicitFlow
      : undefined;
  let flow: WizardFlow =
    explicitFlow ??
    (await prompter.select({
      message: "Onboarding mode",
      options: [
        { value: "quickstart", label: "QuickStart", hint: quickstartHint },
        { value: "advanced", label: "Manual", hint: manualHint },
      ],
      initialValue: "quickstart",
    }));

  if (opts.mode === "remote" && flow === "quickstart") {
    await prompter.note(
      "QuickStart only supports local gateways. Switching to Manual mode.",
      "QuickStart",
    );
    flow = "advanced";
  }

  if (snapshot.exists) {
    await prompter.note(summarizeExistingConfig(baseConfig), "Existing config detected");

    const action = await prompter.select({
      message: "Config handling",
      options: [
        { value: "keep", label: "Use existing values" },
        { value: "modify", label: "Update values" },
        { value: "reset", label: "Reset" },
      ],
    });

    if (action === "reset") {
      const workspaceDefault = baseConfig.agents?.defaults?.workspace ?? DEFAULT_WORKSPACE;
      const resetScope = (await prompter.select({
        message: "Reset scope",
        options: [
          { value: "config", label: "Config only" },
          {
            value: "config+creds+sessions",
            label: "Config + creds + sessions",
          },
          {
            value: "full",
            label: "Full reset (config + creds + sessions + workspace)",
          },
        ],
      })) as ResetScope;
      await handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
      baseConfig = {};
    }
  }

  const quickstartGateway: QuickstartGatewayDefaults = (() => {
    const hasExisting =
      typeof baseConfig.gateway?.port === "number" ||
      baseConfig.gateway?.bind !== undefined ||
      baseConfig.gateway?.auth?.mode !== undefined ||
      baseConfig.gateway?.auth?.token !== undefined ||
      baseConfig.gateway?.auth?.password !== undefined ||
      baseConfig.gateway?.customBindHost !== undefined ||
      baseConfig.gateway?.tailscale?.mode !== undefined;

    const bindRaw = baseConfig.gateway?.bind;
    const bind =
      bindRaw === "loopback" ||
      bindRaw === "lan" ||
      bindRaw === "auto" ||
      bindRaw === "custom" ||
      bindRaw === "tailnet"
        ? bindRaw
        : "loopback";

    let authMode: GatewayAuthChoice = "token";
    if (
      baseConfig.gateway?.auth?.mode === "token" ||
      baseConfig.gateway?.auth?.mode === "password"
    ) {
      authMode = baseConfig.gateway.auth.mode;
    } else if (baseConfig.gateway?.auth?.token) {
      authMode = "token";
    } else if (baseConfig.gateway?.auth?.password) {
      authMode = "password";
    }

    const tailscaleRaw = baseConfig.gateway?.tailscale?.mode;
    const tailscaleMode =
      tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
        ? tailscaleRaw
        : "off";

    return {
      hasExisting,
      port: resolveGatewayPort(baseConfig),
      bind,
      authMode,
      tailscaleMode,
      token: baseConfig.gateway?.auth?.token,
      password: baseConfig.gateway?.auth?.password,
      customBindHost: baseConfig.gateway?.customBindHost,
      tailscaleResetOnExit: baseConfig.gateway?.tailscale?.resetOnExit ?? false,
    };
  })();

  if (flow === "quickstart") {
    const formatBind = (value: "loopback" | "lan" | "auto" | "custom" | "tailnet") => {
      if (value === "loopback") {
        return "Loopback (127.0.0.1)";
      }
      if (value === "lan") {
        return "LAN";
      }
      if (value === "custom") {
        return "Custom IP";
      }
      if (value === "tailnet") {
        return "Tailnet (Tailscale IP)";
      }
      return "Auto";
    };
    const formatAuth = (value: GatewayAuthChoice) => {
      if (value === "token") {
        return "Token (default)";
      }
      return "Password";
    };
    const formatTailscale = (value: "off" | "serve" | "funnel") => {
      if (value === "off") {
        return "Off";
      }
      if (value === "serve") {
        return "Serve";
      }
      return "Funnel";
    };
    const quickstartLines = quickstartGateway.hasExisting
      ? [
          "Keeping your current gateway settings:",
          `Gateway port: ${quickstartGateway.port}`,
          `Gateway bind: ${formatBind(quickstartGateway.bind)}`,
          ...(quickstartGateway.bind === "custom" && quickstartGateway.customBindHost
            ? [`Gateway custom IP: ${quickstartGateway.customBindHost}`]
            : []),
          `Gateway auth: ${formatAuth(quickstartGateway.authMode)}`,
          `Tailscale exposure: ${formatTailscale(quickstartGateway.tailscaleMode)}`,
          "Direct to chat channels.",
        ]
      : [
          `Gateway port: ${DEFAULT_GATEWAY_PORT}`,
          "Gateway bind: Loopback (127.0.0.1)",
          "Gateway auth: Token (default)",
          "Tailscale exposure: Off",
          "Direct to chat channels.",
        ];
    await prompter.note(quickstartLines.join("\n"), "QuickStart");
  }

  const localPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${localPort}`;
  const localProbe = await probeGatewayReachable({
    url: localUrl,
    token: baseConfig.gateway?.auth?.token ?? process.env.SPECIAL_AGENT_GATEWAY_TOKEN,
    password: baseConfig.gateway?.auth?.password ?? process.env.SPECIAL_AGENT_GATEWAY_PASSWORD,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  const remoteProbe = remoteUrl
    ? await probeGatewayReachable({
        url: remoteUrl,
        token: baseConfig.gateway?.remote?.token,
      })
    : null;

  const mode =
    opts.mode ??
    (flow === "quickstart"
      ? "local"
      : ((await prompter.select({
          message: "What do you want to set up?",
          options: [
            {
              value: "local",
              label: "Local gateway (this machine)",
              hint: localProbe.ok
                ? `Gateway reachable (${localUrl})`
                : `No gateway detected (${localUrl})`,
            },
            {
              value: "remote",
              label: "Remote gateway (info-only)",
              hint: !remoteUrl
                ? "No remote URL configured yet"
                : remoteProbe?.ok
                  ? `Gateway reachable (${remoteUrl})`
                  : `Configured but unreachable (${remoteUrl})`,
            },
          ],
        })) as OnboardMode));

  if (mode === "remote") {
    let nextConfig = await promptRemoteGatewayConfig(baseConfig, prompter);
    nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await prompter.outro("Remote gateway configured.");
    return;
  }

  const workspaceInput =
    opts.workspace ??
    (flow === "quickstart"
      ? (baseConfig.agents?.defaults?.workspace ?? DEFAULT_WORKSPACE)
      : await prompter.text({
          message: "Workspace directory",
          initialValue: baseConfig.agents?.defaults?.workspace ?? DEFAULT_WORKSPACE,
        }));

  const workspaceDir = resolveUserPath(workspaceInput.trim() || DEFAULT_WORKSPACE);

  let nextConfig: SpecialAgentConfig = {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };

  // Endpoint configuration: provider type selection, then branch
  const providerType = await prompter.select({
    message: "Endpoint type",
    options: [
      {
        value: "openai",
        label: "OpenAI Compatible API",
        hint: "Uses /chat/completions",
      },
      {
        value: "anthropic",
        label: "Anthropic Compatible API",
        hint: "Uses /messages",
      },
      {
        value: "ollama",
        label: "Ollama Compatible API",
        hint: "Local models, no API key needed",
      },
    ],
  });

  if (providerType === "openai" || providerType === "anthropic") {
    const endpointBaseUrl = await prompter.text({
      message: "Endpoint base URL",
      placeholder:
        providerType === "openai" ? "https://api.example.com/v1" : "https://api.example.com/v1",
      validate: (val) => {
        try {
          new URL(val);
          return undefined;
        } catch {
          return "Please enter a valid URL (e.g. http://...)";
        }
      },
    });
    const endpointApiKey = await prompter.text({
      message: "API Key",
      placeholder: providerType === "openai" ? "sk-..." : "sk-ant-...",
    });

    const endpointCompat: "openai-completions" | "anthropic-messages" =
      providerType === "openai" ? "openai-completions" : "anthropic-messages";
    const endpointId = buildEndpointIdFromUrl(endpointBaseUrl.trim());
    const normalizedApiKey = endpointApiKey.trim() || undefined;
    nextConfig = {
      ...nextConfig,
      models: {
        ...nextConfig.models,
        mode: nextConfig.models?.mode ?? "merge",
        providers: {
          ...nextConfig.models?.providers,
          [endpointId]: {
            baseUrl: endpointBaseUrl.trim(),
            api: endpointCompat,
            ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
            models: [],
          },
        },
      },
    };

    const modelSelection = await promptDefaultModel({
      config: nextConfig,
      prompter,
      allowKeep: true,
      ignoreAllowlist: true,
      endpointBaseUrl: endpointBaseUrl.trim(),
      endpointApiKey: endpointApiKey.trim(),
    });
    if (modelSelection.model) {
      const modelId = modelSelection.model;
      const defaultCtx = providerType === "openai" ? 128_000 : 200_000;
      const ctxValue = await promptContextWindow(prompter, defaultCtx);

      const modelDef: ModelDefinitionConfig = {
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: ctxValue,
        maxTokens: 4096,
      };

      // Re-apply provider config with model definition
      nextConfig = {
        ...nextConfig,
        models: {
          ...nextConfig.models,
          mode: nextConfig.models?.mode ?? "merge",
          providers: {
            ...nextConfig.models?.providers,
            [endpointId]: {
              ...nextConfig.models?.providers?.[endpointId],
              baseUrl: endpointBaseUrl.trim(),
              models: [modelDef],
            },
          },
        },
      };

      const qualifiedModel = modelId.startsWith(`${endpointId}/`)
        ? modelId
        : `${endpointId}/${modelId}`;
      nextConfig = applyPrimaryModel(nextConfig, qualifiedModel);
    }
  } else {
    // Ollama branch
    const ollamaBaseUrl = await prompter.text({
      message: "Ollama base URL",
      initialValue: OLLAMA_DEFAULT_BASE_URL,
      placeholder: OLLAMA_DEFAULT_BASE_URL,
      validate: (val) => {
        try {
          new URL(val);
          return undefined;
        } catch {
          return "Please enter a valid URL (e.g. http://...)";
        }
      },
    });
    const trimmedBaseUrl = ollamaBaseUrl.trim();

    // Probe for running Ollama instance
    let probeOk = false;
    while (!probeOk) {
      const probeSpinner = prompter.progress("Checking for Ollama...");
      const probe = await probeOllamaRunning(trimmedBaseUrl);
      if (probe.ok) {
        probeSpinner.stop("Ollama detected.");
        probeOk = true;
      } else {
        probeSpinner.stop("Ollama not detected.");
        await prompter.note(
          [
            `Could not reach Ollama at ${trimmedBaseUrl}`,
            probe.error ? `Error: ${probe.error}` : "",
            "",
            "Make sure Ollama is running: ollama serve",
          ]
            .filter(Boolean)
            .join("\n"),
          "Ollama",
        );
        const action = await prompter.select({
          message: "What would you like to do?",
          options: [
            { value: "retry", label: "Retry" },
            { value: "continue", label: "Continue anyway" },
          ],
        });
        if (action === "continue") {
          break;
        }
      }
    }

    const ollamaApiKey = await prompter.text({
      message: "API Key (leave blank if not required)",
      initialValue: "",
      placeholder: "leave blank if not required",
    });
    const normalizedOllamaApiKey = ollamaApiKey.trim() || undefined;

    nextConfig = applyOllamaProviderConfig(nextConfig, {
      baseUrl: trimmedBaseUrl,
      apiKey: normalizedOllamaApiKey,
      models: [],
    });

    const modelSelection = await promptDefaultModel({
      config: nextConfig,
      prompter,
      allowKeep: true,
      ignoreAllowlist: true,
      endpointBaseUrl: trimmedBaseUrl,
      endpointApiKey: ollamaApiKey.trim(),
    });
    if (modelSelection.model) {
      const modelId = modelSelection.model;

      // Auto-detect context window from Ollama
      const detectSpinner = prompter.progress("Detecting context window...");
      const detectedCtx = await fetchOllamaContextWindow(trimmedBaseUrl, modelId);
      if (detectedCtx) {
        detectSpinner.stop(`Detected context window: ${formatTokenK(detectedCtx)} tokens.`);
      } else {
        detectSpinner.stop("Could not detect context window.");
      }

      const ollamaDefaultCtx = 32_768;
      const ctxDefault = detectedCtx ?? ollamaDefaultCtx;
      const ctxLabel = detectedCtx ? String(detectedCtx) : undefined;
      const contextWindow = await promptContextWindow(prompter, ctxDefault, ctxLabel);
      const modelDef = buildOllamaModelDefinition(modelId, contextWindow);

      // Re-apply provider config with model definition
      nextConfig = applyOllamaProviderConfig(nextConfig, {
        baseUrl: trimmedBaseUrl,
        apiKey: normalizedOllamaApiKey,
        models: [modelDef],
      });

      const qualifiedModel = `${OLLAMA_PROVIDER_ID}/${modelId}`;
      nextConfig = applyPrimaryModel(nextConfig, qualifiedModel);

      // Disable streaming for Ollama models (SDK issue #1205)
      nextConfig = {
        ...nextConfig,
        agents: {
          ...nextConfig.agents,
          defaults: {
            ...nextConfig.agents?.defaults,
            models: {
              ...nextConfig.agents?.defaults?.models,
              [qualifiedModel]: {
                ...nextConfig.agents?.defaults?.models?.[qualifiedModel],
                streaming: false,
              },
            },
          },
        },
      };
    }
  }

  await warnIfModelConfigLooksOff(nextConfig, prompter);

  const gateway = await configureGatewayForOnboarding({
    flow,
    baseConfig,
    nextConfig,
    localPort,
    quickstartGateway,
    prompter,
    runtime,
  });
  nextConfig = gateway.nextConfig;
  const settings = gateway.settings;

  if (opts.skipChannels ?? opts.skipProviders) {
    await prompter.note("Skipping channel setup.", "Channels");
  } else {
    const quickstartAllowFromChannels =
      flow === "quickstart"
        ? listChannelPlugins()
            .filter((plugin) => plugin.meta.quickstartAllowFrom)
            .map((plugin) => plugin.id)
        : [];
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      forceAllowFromChannels: quickstartAllowFromChannels,
      skipDmPolicyPrompt: flow === "quickstart",
      skipConfirm: flow === "quickstart",
      quickstartDefaults: flow === "quickstart",
    });
  }

  await writeConfigFile(nextConfig);
  logConfigUpdated(runtime);
  await ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  if (opts.skipSkills) {
    await prompter.note("Skipping skills setup.", "Skills");
  } else {
    nextConfig = await setupSkills(nextConfig, workspaceDir, runtime, prompter);
  }

  // Setup hooks (session memory on /new)
  nextConfig = await setupInternalHooks(nextConfig, runtime, prompter);

  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);

  const { launchedTui } = await finalizeOnboardingWizard({
    flow,
    opts,
    baseConfig,
    nextConfig,
    workspaceDir,
    settings,
    prompter,
    runtime,
  });
  if (launchedTui) {
    return;
  }
}
