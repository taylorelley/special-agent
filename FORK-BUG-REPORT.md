# Fork Bug Report: taylorelley/special-agent

Reviewed commits:
- `0918ea6` rebrand: rename OpenClaw/Clawdbot/Moltbot to Special Agent
- `f14bbd6` rebrand: fix CI issues from Special Agent rename
- `3ccecd2` rebrand: restore external URLs, repo refs, and npm package name
- `668f618` enterprise: strip non-enterprise channels, providers, extensions, and skills

---

## Critical Bugs

### Bug 1: Auth Choice UI Offers Stripped Providers With No Backend Handlers

**Severity: CRITICAL**

The onboarding wizard (`buildAuthChoiceOptions()`) still presents auth choices for
providers whose apply-handlers were deleted in the enterprise strip:

| Auth Choice | Label Shown in UI | Handler File |
|---|---|---|
| `synthetic-api-key` | Synthetic API key | `auth-choice.apply.*.ts` — **DELETED** |
| `venice-api-key` | Venice AI API key | **DELETED** |
| `together-api-key` | Together AI API key | **DELETED** |
| `cloudflare-ai-gateway-api-key` | Cloudflare AI Gateway | `auth-choice.apply.copilot-proxy.ts` — **DELETED** |
| `opencode-zen` | OpenCode Zen | **DELETED** |
| `github-copilot` | GitHub Copilot | **DELETED** |
| `copilot-proxy` | Copilot Proxy (local) | **DELETED** |
| `minimax-portal` | MiniMax OAuth | `auth-choice.apply.minimax.ts` — **DELETED** |
| `minimax-api` | MiniMax M2.1 | **DELETED** |
| `minimax-api-lightning` | MiniMax M2.1 Lightning | **DELETED** |
| `xai-api-key` | xAI (Grok) API key | `auth-choice.apply.xai.ts` — **DELETED** |
| `qwen-portal` | Qwen OAuth | `auth-choice.apply.qwen-portal.ts` — **DELETED** |

**What happens:** A user selects one of these providers in the wizard. `applyAuthChoice()`
iterates through `[applyAuthChoiceOAuth, applyAuthChoiceApiProviders]` — neither handler
matches, so both return `null`. The function falls through to `return { config: params.config }`
doing **nothing** — no credential is saved, no error is shown.

**Files:**
- `src/commands/auth-choice-options.ts:167-281` (options still listed)
- `src/commands/auth-choice.apply.ts:30-46` (no handler matches, silently succeeds)
- `src/commands/auth-choice.apply.api-providers.ts` (missing cases for stripped providers)

**Fix:** Remove the stripped provider entries from `buildAuthChoiceOptions()`,
`AUTH_CHOICE_GROUP_DEFS`, and `AuthChoiceGroupId` type.

---

### Bug 2: `DEFAULT_CHAT_CHANNEL = "msteams"` Falls Through to Error

**Severity: CRITICAL**

`DEFAULT_CHAT_CHANNEL` is hardcoded to `"msteams"` but the channel registry
(`CHAT_CHANNEL_ORDER`) is now empty. The `normalizeChannelId()` function in
`channels/plugins/index.ts` delegates to `normalizeAnyChannelId()` which queries
the plugin registry. If the msteams plugin is not loaded (or the plugin registry
is not yet initialized), this returns `null`.

Multiple code paths use `DEFAULT_CHAT_CHANNEL` as a fallback and will error:

- **`src/cli/channel-auth.ts:18-21`** — `runChannelLogin()` / `runChannelLogout()`
  defaults to `"msteams"`, then `normalizeChannelId()` returns `null`, then
  throws `"Unsupported channel: msteams"`.

- **`src/infra/outbound/agent-delivery.ts:62,72`** — `resolveAgentDeliveryPlan()`
  uses `DEFAULT_CHAT_CHANNEL` as fallback when no last channel exists and
  `wantsDelivery` is true. Downstream code may then fail when trying to
  route a message to an unresolved channel.

- **`src/cron/isolated-agent/delivery-target.ts`** — Triple fallback chain
  ends at `DEFAULT_CHAT_CHANNEL`, which may not resolve.

**Fix:** Either remove `DEFAULT_CHAT_CHANNEL` and require explicit channel
specification, or validate that the default channel plugin is loaded before
using it as a fallback.

---

## High-Severity Bugs

### Bug 3: `ModelApi` Type Still Includes Stripped API Backends

**Severity: HIGH**

`src/config/types.models.ts:1-7` defines:
```typescript
export type ModelApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "github-copilot"          // <-- stripped
  | "bedrock-converse-stream"; // <-- stripped
```

The Zod validation schema in `src/config/zod-schema.core.ts:4-11` also includes
`z.literal("github-copilot")` and `z.literal("bedrock-converse-stream")`.

This means the config schema will accept these API types, but the runtime
code that would handle `github-copilot` and `bedrock-converse-stream` API
calls has been removed.

**Fix:** Remove `"github-copilot"` and `"bedrock-converse-stream"` from
`ModelApi` type and `ModelApiSchema`.

---

### Bug 4: `BedrockDiscoveryConfig` Type and Config Still Present

**Severity: HIGH**

`src/config/types.models.ts:46-53` still defines `BedrockDiscoveryConfig` and
the `ModelsConfig` type at line 58 still includes `bedrockDiscovery?`.
The Bedrock discovery runtime was stripped but the config schema still
accepts it, meaning users can configure Bedrock discovery options that
silently do nothing.

**Fix:** Remove `BedrockDiscoveryConfig` type and `bedrockDiscovery` from
`ModelsConfig`.

---

### Bug 5: Dead Provider Auth Resolution Paths in `model-auth.ts`

**Severity: HIGH**

`src/agents/model-auth.ts` still contains active code paths for stripped providers:

- **Line 211, 360:** Special-case logic for `amazon-bedrock` provider that
  calls `resolveAwsSdkAuthInfo()`. The AWS SDK auth infrastructure is still
  present but Bedrock provider is stripped.

- **Line 250-251:** Special-case env var resolution for `github-copilot`
  checking `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`.

- **Lines 301-309:** `envMap` contains entries for stripped providers:
  `cloudflare-ai-gateway`, `synthetic`, `venice`, `together`, `opencode`.

These are dead code paths that will never be hit via the normal provider
discovery flow (since those providers are gone), but they add confusion and
could mask issues.

**Fix:** Remove the dead provider entries from `resolveEnvApiKey()` and
the Bedrock/Copilot special-case branches.

---

### Bug 6: Orphaned Credential-Setting Functions in `onboard-auth.credentials.ts`

**Severity: HIGH**

The following credential-writing functions still exist but are never called
(their callers in the auth-choice apply handlers were deleted):

- `setSyntheticApiKey()`
- `setVeniceApiKey()`
- `setTogetherApiKey()`
- `setCloudflareAiGatewayConfig()`
- `setOpencodeZenApiKey()`

These functions are unreachable dead code.

**Fix:** Remove the orphaned functions.

---

### Bug 7: `AuthChoice` and `OnboardOptions` Types Include Stripped Providers

**Severity: HIGH**

`src/commands/onboard-types.ts:5-43` — The `AuthChoice` type union still
includes choices for all stripped providers (`synthetic-api-key`,
`venice-api-key`, `together-api-key`, `cloudflare-ai-gateway-api-key`,
`opencode-zen`, `github-copilot`, `copilot-proxy`, etc.).

`src/commands/onboard-types.ts:72-129` — `OnboardOptions` still includes
fields for stripped providers:
- `syntheticApiKey`, `veniceApiKey`, `togetherApiKey`
- `cloudflareAiGatewayAccountId`, `cloudflareAiGatewayGatewayId`, `cloudflareAiGatewayApiKey`
- `opencodeZenApiKey`

This means `--syntheticApiKey` etc. are accepted as CLI flags but do nothing.

**Fix:** Remove stripped provider entries from both types.

---

## Medium-Severity Bugs

### Bug 8: `opencode-zen` Provider Normalization Still Active

**Severity: MEDIUM**

`src/agents/model-selection.ts:38-40` normalizes `"opencode-zen"` to `"opencode"`.
This normalization code is dead — the provider was stripped. It won't cause
errors, but adds confusion.

**Fix:** Remove the normalization case.

---

### Bug 9: Provider Usage Tracking Silently Returns Empty

**Severity: MEDIUM**

`src/infra/provider-usage.load.ts:14-20` — `loadProviderUsageSummary()` always
returns `{ updatedAt: now, providers: [] }`. Any UI or CLI command that displays
provider usage will show nothing, with no indication that tracking was disabled.

`src/infra/provider-usage.auth.ts` — `resolveProviderAuths()` similarly returns
an empty array.

`src/infra/provider-usage.shared.ts` — `PROVIDER_LABELS` is empty, `usageProviders` is empty.

While this is intentional for enterprise mode, there's no user-facing indication
that usage tracking is disabled.

---

### Bug 10: Test File References Stripped Providers

**Severity: MEDIUM**

- `src/commands/auth-choice.test.ts:406-407` — Still tests
  `resolvePreferredProviderForAuthChoice("github-copilot")` mapping to
  `"github-copilot"`, a provider that was stripped.

- `src/agents/model-auth.test.ts` — Contains Bedrock-specific tests
  (lines 317-456) that test `amazon-bedrock` provider auth resolution.
  These tests exercise code that should have been cleaned up.

- Multiple test files still reference channel names (telegram, slack,
  whatsapp, etc.) in mock data, though these are mostly benign.

---

### Bug 11: `litellm` in `AuthChoiceGroupId` Duplicate

**Severity: LOW**

`litellm` appears in the `AuthChoiceGroupId` type in `onboard-types.ts:44-62`
but NOT in `auth-choice-options.ts:10-30`. The two type definitions are
identical unions but are defined in two separate files, which creates a
maintenance burden and divergence risk (they already diverge — `litellm`
is in one but not the other, and `together` is in both despite being stripped).

**Fix:** Use a single source of truth for `AuthChoiceGroupId`.

---

## Summary

| # | Severity | Bug | Impact |
|---|----------|-----|--------|
| 1 | CRITICAL | Auth wizard shows 12 stripped providers, silently does nothing | Users can "configure" providers that don't work |
| 2 | CRITICAL | `DEFAULT_CHAT_CHANNEL = "msteams"` unreliable fallback | Channel login/logout/delivery fails when plugin not loaded |
| 3 | HIGH | `ModelApi` type includes stripped `github-copilot` and `bedrock` | Config accepts invalid API backends |
| 4 | HIGH | `BedrockDiscoveryConfig` still in config schema | Users can configure Bedrock discovery that does nothing |
| 5 | HIGH | Dead auth resolution branches for stripped providers | Confusion, dead code paths |
| 6 | HIGH | Orphaned credential-setting functions | Unreachable dead code |
| 7 | HIGH | `AuthChoice`/`OnboardOptions` types include stripped providers | CLI accepts flags that do nothing |
| 8 | MEDIUM | `opencode-zen` normalization still active | Dead code |
| 9 | MEDIUM | Provider usage tracking silently empty | No user indication tracking disabled |
| 10 | MEDIUM | Tests reference stripped providers | Tests may pass or fail incorrectly |
| 11 | LOW | `AuthChoiceGroupId` defined in two files, diverging | Maintenance risk |
