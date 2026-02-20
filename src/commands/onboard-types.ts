import type { ChannelId } from "../channels/plugins/types.js";
import type { GatewayDaemonRuntime } from "./daemon-runtime.js";

export type OnboardMode = "local" | "remote";
export type AuthChoice = "custom-api-key" | "ollama" | "skip";
export type GatewayAuthChoice = "token" | "password";
export type ResetScope = "config" | "config+creds+sessions" | "full";
export type GatewayBind = "loopback" | "lan" | "auto" | "custom" | "tailnet";
export type TailscaleMode = "off" | "serve" | "funnel";
export type NodeManagerChoice = "npm" | "pnpm" | "bun";
export type ChannelChoice = ChannelId;
// Legacy alias (pre-rename).
export type ProviderChoice = ChannelChoice;

export type OnboardOptions = {
  mode?: OnboardMode;
  /** "manual" is an alias for "advanced". */
  flow?: "quickstart" | "advanced" | "manual";
  workspace?: string;
  nonInteractive?: boolean;
  /** Required for non-interactive onboarding; skips the interactive risk prompt when true. */
  acceptRisk?: boolean;
  reset?: boolean;
  authChoice?: AuthChoice;
  /** Used when `authChoice=token` in non-interactive mode. */
  tokenProvider?: string;
  /** Used when `authChoice=token` in non-interactive mode. */
  token?: string;
  /** Used when `authChoice=token` in non-interactive mode. */
  tokenProfileId?: string;
  /** Used when `authChoice=token` in non-interactive mode. */
  tokenExpiresIn?: string;
  /** Generic API key for the configured endpoint. */
  apiKey?: string;
  /** Base URL for the configured endpoint. */
  baseUrl?: string;
  /** API type: openai-compatible, anthropic-compatible, or ollama. */
  apiType?: string;
  gatewayPort?: number;
  gatewayBind?: GatewayBind;
  gatewayAuth?: GatewayAuthChoice;
  gatewayToken?: string;
  gatewayPassword?: string;
  tailscale?: TailscaleMode;
  tailscaleResetOnExit?: boolean;
  installDaemon?: boolean;
  daemonRuntime?: GatewayDaemonRuntime;
  skipChannels?: boolean;
  /** @deprecated Legacy alias for `skipChannels`. */
  skipProviders?: boolean;
  skipSkills?: boolean;
  skipMemory?: boolean;
  skipBeads?: boolean;
  skipHealth?: boolean;
  skipUi?: boolean;
  nodeManager?: NodeManagerChoice;
  remoteUrl?: string;
  remoteToken?: string;
  json?: boolean;
};
