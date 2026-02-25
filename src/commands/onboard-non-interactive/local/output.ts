import type { RuntimeEnv } from "../../../runtime.js";
import type { OnboardOptions } from "../../onboard-types.js";

export function logNonInteractiveOnboardingJson(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  mode: "local" | "remote";
  workspaceDir?: string;
  authChoice?: string;
  gateway?: {
    port: number;
    bind: string;
    authMode: string;
    tailscaleMode: string;
  };
  installDaemon?: boolean;
  daemonRuntime?: string;
  skipChannels?: boolean;
  skipSkills?: boolean;
  skipMemory?: boolean;
  skipBeads?: boolean;
  skipWebTools?: boolean;
  skipHealth?: boolean;
}) {
  if (!params.opts.json) {
    return;
  }
  params.runtime.log(
    JSON.stringify(
      {
        mode: params.mode,
        workspace: params.workspaceDir,
        authChoice: params.authChoice,
        gateway: params.gateway,
        installDaemon: Boolean(params.installDaemon),
        daemonRuntime: params.daemonRuntime,
        skipChannels: Boolean(params.skipChannels),
        skipSkills: Boolean(params.skipSkills),
        skipMemory: Boolean(params.skipMemory),
        skipBeads: Boolean(params.skipBeads),
        skipWebTools: Boolean(params.skipWebTools),
        skipHealth: Boolean(params.skipHealth),
      },
      null,
      2,
    ),
  );
}
