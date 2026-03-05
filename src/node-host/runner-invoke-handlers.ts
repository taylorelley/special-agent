import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { GatewayClient } from "../gateway/client.js";
import type { SkillBinsCache } from "./runner.js";
import { resolveAgentConfig } from "../agents/agent-scope.js";
import { resolveBrowserConfig } from "../browser/config.js";
import {
  createBrowserControlContext,
  startBrowserControlServiceFromConfig,
} from "../browser/control-service.js";
import { createBrowserRouteDispatcher } from "../browser/routes/dispatcher.js";
import { loadConfig } from "../config/config.js";
import {
  addAllowlistEntry,
  analyzeArgvCommand,
  evaluateExecAllowlist,
  evaluateShellAllowlist,
  requiresExecApproval,
  normalizeExecApprovals,
  recordAllowlistUse,
  resolveExecApprovals,
  resolveSafeBins,
  ensureExecApprovals,
  readExecApprovalsSnapshot,
  resolveExecApprovalsSocketPath,
  saveExecApprovals,
  type ExecAsk,
  type ExecSecurity,
  type ExecApprovalsFile,
  type ExecAllowlistEntry,
  type ExecCommandSegment,
} from "../infra/exec-approvals.js";
import {
  requestExecHostViaSocket,
  type ExecHostRequest,
  type ExecHostResponse,
  type ExecHostRunResult,
} from "../infra/exec-host.js";
import { detectMime } from "../media/mime.js";
import { withTimeout } from "./with-timeout.js";

type SystemRunParams = {
  command: string[];
  rawCommand?: string | null;
  cwd?: string | null;
  env?: Record<string, string>;
  timeoutMs?: number | null;
  needsScreenRecording?: boolean | null;
  agentId?: string | null;
  sessionKey?: string | null;
  approved?: boolean | null;
  approvalDecision?: string | null;
  runId?: string | null;
};

type SystemWhichParams = {
  bins: string[];
};

type BrowserProxyParams = {
  method?: string;
  path?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
};

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

type SystemExecApprovalsSetParams = {
  file: ExecApprovalsFile;
  baseHash?: string | null;
};

type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  hash: string;
  file: ExecApprovalsFile;
};

export type NodeInvokeRequestPayload = {
  id: string;
  nodeId: string;
  command: string;
  paramsJSON?: string | null;
  timeoutMs?: number | null;
  idempotencyKey?: string | null;
};

type ExecEventPayload = {
  sessionKey: string;
  runId: string;
  host: string;
  command?: string;
  exitCode?: number;
  timedOut?: boolean;
  success?: boolean;
  output?: string;
  reason?: string;
};

const OUTPUT_EVENT_TAIL = 20_000;
const BROWSER_PROXY_MAX_FILE_BYTES = 10 * 1024 * 1024;

const execHostEnforced = process.env.SPECIAL_AGENT_NODE_EXEC_HOST?.trim().toLowerCase() === "app";
const execHostFallbackAllowed =
  process.env.SPECIAL_AGENT_NODE_EXEC_FALLBACK?.trim().toLowerCase() !== "0";

function decodeParams<T>(raw?: string | null): T {
  if (!raw) {
    throw new Error("INVALID_REQUEST: paramsJSON required");
  }
  return JSON.parse(raw) as T;
}

function resolveExecSecurity(value?: string): ExecSecurity {
  return value === "deny" || value === "allowlist" || value === "full" ? value : "allowlist";
}

function resolveExecAsk(value?: string): ExecAsk {
  return value === "off" || value === "on-miss" || value === "always" ? value : "on-miss";
}

function isCmdExeInvocation(argv: string[]): boolean {
  const token = argv[0]?.trim();
  if (!token) {
    return false;
  }
  const base = path.win32.basename(token).toLowerCase();
  return base === "cmd.exe" || base === "cmd";
}

function redactExecApprovals(file: ExecApprovalsFile): ExecApprovalsFile {
  const socketPath = file.socket?.path?.trim();
  return {
    ...file,
    socket: socketPath ? { path: socketPath } : undefined,
  };
}

function requireExecApprovalsBaseHash(
  params: SystemExecApprovalsSetParams,
  snapshot: ExecApprovalsSnapshot,
) {
  if (!snapshot.exists) {
    return;
  }
  if (!snapshot.hash) {
    throw new Error("INVALID_REQUEST: exec approvals base hash unavailable; reload and retry");
  }
  const baseHash = typeof params.baseHash === "string" ? params.baseHash.trim() : "";
  if (!baseHash) {
    throw new Error("INVALID_REQUEST: exec approvals base hash required; reload and retry");
  }
  if (baseHash !== snapshot.hash) {
    throw new Error("INVALID_REQUEST: exec approvals changed; reload and retry");
  }
}

function formatCommand(argv: string[]): string {
  return argv
    .map((arg) => {
      const trimmed = arg.trim();
      if (!trimmed) {
        return '""';
      }
      const needsQuotes = /\s|"/.test(trimmed);
      if (!needsQuotes) {
        return trimmed;
      }
      return `"${trimmed.replace(/"/g, '\\"')}"`;
    })
    .join(" ");
}

function truncateOutput(raw: string, maxChars: number): { text: string; truncated: boolean } {
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false };
  }
  return { text: `... (truncated) ${raw.slice(raw.length - maxChars)}`, truncated: true };
}

function buildExecEventPayload(payload: ExecEventPayload): ExecEventPayload {
  if (!payload.output) {
    return payload;
  }
  const trimmed = payload.output.trim();
  if (!trimmed) {
    return payload;
  }
  const { text } = truncateOutput(trimmed, OUTPUT_EVENT_TAIL);
  return { ...payload, output: text };
}

async function runViaMacAppExecHost(params: {
  approvals: ReturnType<typeof resolveExecApprovals>;
  request: ExecHostRequest;
}): Promise<ExecHostResponse | null> {
  const { approvals, request } = params;
  return await requestExecHostViaSocket({
    socketPath: approvals.socketPath,
    token: approvals.token,
    request,
  });
}

export function normalizeProfileAllowlist(raw?: string[]): string[] {
  return Array.isArray(raw) ? raw.map((entry) => entry.trim()).filter(Boolean) : [];
}

export function resolveBrowserProxyConfig() {
  const cfg = loadConfig();
  const proxy = cfg.nodeHost?.browserProxy;
  const allowProfiles = normalizeProfileAllowlist(proxy?.allowProfiles);
  const enabled = proxy?.enabled !== false;
  return { enabled, allowProfiles };
}

let browserControlReady: Promise<void> | null = null;

async function ensureBrowserControlService(): Promise<void> {
  if (browserControlReady) {
    return browserControlReady;
  }
  browserControlReady = (async () => {
    try {
      const cfg = loadConfig();
      const resolved = resolveBrowserConfig(cfg.browser, cfg);
      if (!resolved.enabled) {
        throw new Error("browser control disabled");
      }
      const started = await startBrowserControlServiceFromConfig();
      if (!started) {
        throw new Error("browser control disabled");
      }
    } catch (err) {
      browserControlReady = null;
      throw err;
    }
  })();
  return browserControlReady;
}

function isProfileAllowed(params: { allowProfiles: string[]; profile?: string | null }) {
  const { allowProfiles, profile } = params;
  if (!allowProfiles.length) {
    return true;
  }
  if (!profile) {
    return false;
  }
  return allowProfiles.includes(profile.trim());
}

function collectBrowserProxyPaths(payload: unknown): string[] {
  const paths = new Set<string>();
  const obj =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  if (!obj) {
    return [];
  }
  if (typeof obj.path === "string" && obj.path.trim()) {
    paths.add(obj.path.trim());
  }
  if (typeof obj.imagePath === "string" && obj.imagePath.trim()) {
    paths.add(obj.imagePath.trim());
  }
  const download = obj.download;
  if (download && typeof download === "object") {
    const dlPath = (download as Record<string, unknown>).path;
    if (typeof dlPath === "string" && dlPath.trim()) {
      paths.add(dlPath.trim());
    }
  }
  return [...paths];
}

async function readBrowserProxyFile(filePath: string): Promise<BrowserProxyFile | null> {
  const stat = await fsPromises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return null;
  }
  if (stat.size > BROWSER_PROXY_MAX_FILE_BYTES) {
    throw new Error(
      `browser proxy file exceeds ${Math.round(BROWSER_PROXY_MAX_FILE_BYTES / (1024 * 1024))}MB`,
    );
  }
  const buffer = await fsPromises.readFile(filePath);
  const mimeType = await detectMime({ buffer, filePath });
  return { path: filePath, base64: buffer.toString("base64"), mimeType };
}

async function sendInvokeResult(
  client: GatewayClient,
  frame: NodeInvokeRequestPayload,
  result: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
) {
  try {
    await client.request("node.invoke.result", buildNodeInvokeResultParams(frame, result));
  } catch {
    // ignore: node invoke responses are best-effort
  }
}

export function buildNodeInvokeResultParams(
  frame: NodeInvokeRequestPayload,
  result: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
): {
  id: string;
  nodeId: string;
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string;
  error?: { code?: string; message?: string };
} {
  const params: {
    id: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string;
    error?: { code?: string; message?: string };
  } = {
    id: frame.id,
    nodeId: frame.nodeId,
    ok: result.ok,
  };
  if (result.payload !== undefined) {
    params.payload = result.payload;
  }
  if (typeof result.payloadJSON === "string") {
    params.payloadJSON = result.payloadJSON;
  }
  if (result.error) {
    params.error = result.error;
  }
  return params;
}

async function sendNodeEvent(client: GatewayClient, event: string, payload: unknown) {
  try {
    await client.request("node.event", {
      event,
      payloadJSON: payload ? JSON.stringify(payload) : null,
    });
  } catch {
    // ignore: node events are best-effort
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export async function handleExecApprovalsGet(
  frame: NodeInvokeRequestPayload,
  client: GatewayClient,
) {
  try {
    ensureExecApprovals();
    const snapshot = readExecApprovalsSnapshot();
    const payload: ExecApprovalsSnapshot = {
      path: snapshot.path,
      exists: snapshot.exists,
      hash: snapshot.hash,
      file: redactExecApprovals(snapshot.file),
    };
    await sendInvokeResult(client, frame, {
      ok: true,
      payloadJSON: JSON.stringify(payload),
    });
  } catch (err) {
    const message = String(err);
    const code = message.toLowerCase().includes("timed out") ? "TIMEOUT" : "INVALID_REQUEST";
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code, message },
    });
  }
}

export async function handleExecApprovalsSet(
  frame: NodeInvokeRequestPayload,
  client: GatewayClient,
) {
  try {
    const params = decodeParams<SystemExecApprovalsSetParams>(frame.paramsJSON);
    if (!params.file || typeof params.file !== "object") {
      throw new Error("INVALID_REQUEST: exec approvals file required");
    }
    ensureExecApprovals();
    const snapshot = readExecApprovalsSnapshot();
    requireExecApprovalsBaseHash(params, snapshot);
    const normalized = normalizeExecApprovals(params.file);
    const currentSocketPath = snapshot.file.socket?.path?.trim();
    const currentToken = snapshot.file.socket?.token?.trim();
    const socketPath =
      normalized.socket?.path?.trim() ?? currentSocketPath ?? resolveExecApprovalsSocketPath();
    const token = normalized.socket?.token?.trim() ?? currentToken ?? "";
    const next: ExecApprovalsFile = {
      ...normalized,
      socket: {
        path: socketPath,
        token,
      },
    };
    saveExecApprovals(next);
    const nextSnapshot = readExecApprovalsSnapshot();
    const payload: ExecApprovalsSnapshot = {
      path: nextSnapshot.path,
      exists: nextSnapshot.exists,
      hash: nextSnapshot.hash,
      file: redactExecApprovals(nextSnapshot.file),
    };
    await sendInvokeResult(client, frame, {
      ok: true,
      payloadJSON: JSON.stringify(payload),
    });
  } catch (err) {
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: String(err) },
    });
  }
}

export async function handleSystemWhichCommand(
  frame: NodeInvokeRequestPayload,
  client: GatewayClient,
  resolveExecutable: (bin: string, env?: Record<string, string>) => string | null,
  sanitizeEnv: (overrides?: Record<string, string> | null) => Record<string, string> | undefined,
) {
  try {
    const params = decodeParams<SystemWhichParams>(frame.paramsJSON);
    if (!Array.isArray(params.bins)) {
      throw new Error("INVALID_REQUEST: bins required");
    }
    const env = sanitizeEnv(undefined);
    const bins = params.bins.map((bin) => bin.trim()).filter(Boolean);
    const found: Record<string, string> = {};
    for (const bin of bins) {
      const resolved = resolveExecutable(bin, env);
      if (resolved) {
        found[bin] = resolved;
      }
    }
    await sendInvokeResult(client, frame, {
      ok: true,
      payloadJSON: JSON.stringify({ bins: found }),
    });
  } catch (err) {
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: String(err) },
    });
  }
}

export async function handleBrowserProxy(frame: NodeInvokeRequestPayload, client: GatewayClient) {
  try {
    const params = decodeParams<BrowserProxyParams>(frame.paramsJSON);
    const pathValue = typeof params.path === "string" ? params.path.trim() : "";
    if (!pathValue) {
      throw new Error("INVALID_REQUEST: path required");
    }
    const proxyConfig = resolveBrowserProxyConfig();
    if (!proxyConfig.enabled) {
      throw new Error("UNAVAILABLE: node browser proxy disabled");
    }
    await ensureBrowserControlService();
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const requestedProfile = typeof params.profile === "string" ? params.profile.trim() : "";
    const allowedProfiles = proxyConfig.allowProfiles;
    if (allowedProfiles.length > 0) {
      if (pathValue !== "/profiles") {
        const profileToCheck = requestedProfile || resolved.defaultProfile;
        if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: profileToCheck })) {
          throw new Error("INVALID_REQUEST: browser profile not allowed");
        }
      } else if (requestedProfile) {
        if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: requestedProfile })) {
          throw new Error("INVALID_REQUEST: browser profile not allowed");
        }
      }
    }

    const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
    const routePath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
    const body = params.body;
    const query: Record<string, unknown> = {};
    if (requestedProfile) {
      query.profile = requestedProfile;
    }
    const rawQuery = params.query ?? {};
    for (const [key, value] of Object.entries(rawQuery)) {
      if (value === undefined || value === null) {
        continue;
      }
      query[key] = typeof value === "string" ? value : String(value);
    }
    const dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
    const response = await withTimeout(
      (signal) =>
        dispatcher.dispatch({
          method: method === "DELETE" ? "DELETE" : method === "POST" ? "POST" : "GET",
          path: routePath,
          query,
          body,
          signal,
        }),
      params.timeoutMs,
      "browser proxy request",
    );
    if (response.status >= 400) {
      const message =
        response.body && typeof response.body === "object" && "error" in response.body
          ? String((response.body as { error?: unknown }).error)
          : `HTTP ${response.status}`;
      throw new Error(message);
    }
    const result = response.body;
    if (allowedProfiles.length > 0 && routePath === "/profiles") {
      const obj =
        typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
      const profiles = Array.isArray(obj.profiles) ? obj.profiles : [];
      obj.profiles = profiles.filter((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        const name = (entry as Record<string, unknown>).name;
        return typeof name === "string" && allowedProfiles.includes(name);
      });
    }
    let files: BrowserProxyFile[] | undefined;
    const rawPaths = collectBrowserProxyPaths(result);
    const paths: string[] = [];
    for (const p of rawPaths) {
      if (!path.isAbsolute(p)) {
        continue;
      }
      try {
        const real = await fsPromises.realpath(p);
        paths.push(real);
      } catch {
        // skip paths that cannot be resolved
      }
    }
    if (paths.length > 0) {
      const loaded = await Promise.all(
        paths.map(async (p) => {
          try {
            const file = await readBrowserProxyFile(p);
            if (!file) {
              throw new Error("file not found");
            }
            return file;
          } catch (err) {
            throw new Error(`browser proxy file read failed for ${p}: ${String(err)}`, {
              cause: err,
            });
          }
        }),
      );
      if (loaded.length > 0) {
        files = loaded;
      }
    }
    const payload: BrowserProxyResult = files ? { result, files } : { result };
    await sendInvokeResult(client, frame, {
      ok: true,
      payloadJSON: JSON.stringify(payload),
    });
  } catch (err) {
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: String(err) },
    });
  }
}

export async function handleSystemRun(
  frame: NodeInvokeRequestPayload,
  client: GatewayClient,
  skillBins: SkillBinsCache,
  sanitizeEnv: (overrides?: Record<string, string> | null) => Record<string, string> | undefined,
  runCommand: (
    argv: string[],
    cwd: string | undefined,
    env: Record<string, string> | undefined,
    timeoutMs: number | undefined,
  ) => Promise<{
    exitCode?: number;
    timedOut: boolean;
    success: boolean;
    stdout: string;
    stderr: string;
    error?: string | null;
    truncated: boolean;
  }>,
) {
  let params: SystemRunParams;
  try {
    params = decodeParams<SystemRunParams>(frame.paramsJSON);
  } catch (err) {
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: String(err) },
    });
    return;
  }

  try {
    if (!Array.isArray(params.command) || params.command.length === 0) {
      await sendInvokeResult(client, frame, {
        ok: false,
        error: { code: "INVALID_REQUEST", message: "command required" },
      });
      return;
    }

    const argv = params.command.map((item) => String(item));
    const rawCommand = typeof params.rawCommand === "string" ? params.rawCommand.trim() : "";
    const cmdText = rawCommand || formatCommand(argv);
    const agentId = params.agentId?.trim() || undefined;
    const cfg = loadConfig();
    const agentExec = agentId ? resolveAgentConfig(cfg, agentId)?.tools?.exec : undefined;
    const configuredSecurity = resolveExecSecurity(
      agentExec?.security ?? cfg.tools?.exec?.security,
    );
    const configuredAsk = resolveExecAsk(agentExec?.ask ?? cfg.tools?.exec?.ask);
    const approvals = resolveExecApprovals(agentId, {
      security: configuredSecurity,
      ask: configuredAsk,
    });
    const security = approvals.agent.security;
    const ask = approvals.agent.ask;
    const autoAllowSkills = approvals.agent.autoAllowSkills;
    const sessionKey = params.sessionKey?.trim() || "node";
    const runId = params.runId?.trim() || crypto.randomUUID();
    const env = sanitizeEnv(params.env ?? undefined);
    const safeBins = resolveSafeBins(agentExec?.safeBins ?? cfg.tools?.exec?.safeBins);
    const rawBins = autoAllowSkills ? await skillBins.current() : new Set<string>();
    const bins = [...rawBins].map((p) => ({ name: path.basename(p), resolvedPath: p }));
    let analysisOk = false;
    let allowlistMatches: ExecAllowlistEntry[] = [];
    let allowlistSatisfied = false;
    let segments: ExecCommandSegment[] = [];
    if (rawCommand) {
      const allowlistEval = evaluateShellAllowlist({
        command: rawCommand,
        allowlist: approvals.allowlist,
        safeBins,
        cwd: params.cwd ?? undefined,
        env,
        skillBins: bins,
        autoAllowSkills,
        platform: process.platform,
      });
      analysisOk = allowlistEval.analysisOk;
      allowlistMatches = allowlistEval.allowlistMatches;
      allowlistSatisfied =
        security === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
      segments = allowlistEval.segments;
    } else {
      const analysis = analyzeArgvCommand({ argv, cwd: params.cwd ?? undefined, env });
      const allowlistEval = evaluateExecAllowlist({
        analysis,
        allowlist: approvals.allowlist,
        safeBins,
        cwd: params.cwd ?? undefined,
        skillBins: bins,
        autoAllowSkills,
      });
      analysisOk = analysis.ok;
      allowlistMatches = allowlistEval.allowlistMatches;
      allowlistSatisfied =
        security === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
      segments = analysis.segments;
    }
    const isWindows = process.platform === "win32";
    const cmdInvocation = rawCommand
      ? isCmdExeInvocation(segments[0]?.argv ?? [])
      : isCmdExeInvocation(argv);
    if (security === "allowlist" && isWindows && cmdInvocation) {
      analysisOk = false;
      allowlistSatisfied = false;
    }

    const useMacAppExec = process.platform === "darwin";
    if (useMacAppExec) {
      const approvalDecision =
        params.approvalDecision === "allow-once" || params.approvalDecision === "allow-always"
          ? params.approvalDecision
          : null;
      const execRequest: ExecHostRequest = {
        command: argv,
        rawCommand: rawCommand || null,
        cwd: params.cwd ?? null,
        env: env ?? null,
        timeoutMs: params.timeoutMs ?? null,
        needsScreenRecording: params.needsScreenRecording ?? null,
        agentId: agentId ?? null,
        sessionKey: sessionKey ?? null,
        approvalDecision,
      };
      const response = await runViaMacAppExecHost({ approvals, request: execRequest });
      if (!response) {
        if (execHostEnforced || !execHostFallbackAllowed) {
          await sendNodeEvent(
            client,
            "exec.denied",
            buildExecEventPayload({
              sessionKey,
              runId,
              host: "node",
              command: cmdText,
              reason: "companion-unavailable",
            }),
          );
          await sendInvokeResult(client, frame, {
            ok: false,
            error: {
              code: "UNAVAILABLE",
              message: "COMPANION_APP_UNAVAILABLE: macOS app exec host unreachable",
            },
          });
          return;
        }
      } else if (!response.ok) {
        const reason = response.error.reason ?? "approval-required";
        await sendNodeEvent(
          client,
          "exec.denied",
          buildExecEventPayload({
            sessionKey,
            runId,
            host: "node",
            command: cmdText,
            reason,
          }),
        );
        await sendInvokeResult(client, frame, {
          ok: false,
          error: { code: "UNAVAILABLE", message: response.error.message },
        });
        return;
      } else {
        const result: ExecHostRunResult = response.payload;
        const combined = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n");
        await sendNodeEvent(
          client,
          "exec.finished",
          buildExecEventPayload({
            sessionKey,
            runId,
            host: "node",
            command: cmdText,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            success: result.success,
            output: combined,
          }),
        );
        await sendInvokeResult(client, frame, {
          ok: true,
          payloadJSON: JSON.stringify(result),
        });
        return;
      }
    }

    if (security === "deny") {
      await sendNodeEvent(
        client,
        "exec.denied",
        buildExecEventPayload({
          sessionKey,
          runId,
          host: "node",
          command: cmdText,
          reason: "security=deny",
        }),
      );
      await sendInvokeResult(client, frame, {
        ok: false,
        error: { code: "UNAVAILABLE", message: "SYSTEM_RUN_DISABLED: security=deny" },
      });
      return;
    }

    const requiresAsk = requiresExecApproval({
      ask,
      security,
      analysisOk,
      allowlistSatisfied,
    });

    const approvalDecision =
      params.approvalDecision === "allow-once" || params.approvalDecision === "allow-always"
        ? params.approvalDecision
        : null;
    const approvedByAsk = requiresAsk && (approvalDecision !== null || params.approved === true);
    if (requiresAsk && !approvedByAsk) {
      await sendNodeEvent(
        client,
        "exec.denied",
        buildExecEventPayload({
          sessionKey,
          runId,
          host: "node",
          command: cmdText,
          reason: "approval-required",
        }),
      );
      await sendInvokeResult(client, frame, {
        ok: false,
        error: { code: "UNAVAILABLE", message: "SYSTEM_RUN_DENIED: approval required" },
      });
      return;
    }
    if (approvalDecision === "allow-always" && security === "allowlist") {
      if (analysisOk) {
        for (const segment of segments) {
          const pattern = segment.resolution?.resolvedPath ?? "";
          if (pattern) {
            addAllowlistEntry(approvals.file, agentId, pattern);
          }
        }
      }
    }

    if (security === "allowlist" && (!analysisOk || !allowlistSatisfied) && !approvedByAsk) {
      await sendNodeEvent(
        client,
        "exec.denied",
        buildExecEventPayload({
          sessionKey,
          runId,
          host: "node",
          command: cmdText,
          reason: "allowlist-miss",
        }),
      );
      await sendInvokeResult(client, frame, {
        ok: false,
        error: { code: "UNAVAILABLE", message: "SYSTEM_RUN_DENIED: allowlist miss" },
      });
      return;
    }

    if (allowlistMatches.length > 0) {
      const seen = new Set<string>();
      for (const match of allowlistMatches) {
        if (!match?.pattern || seen.has(match.pattern)) {
          continue;
        }
        seen.add(match.pattern);
        recordAllowlistUse(
          approvals.file,
          agentId,
          match,
          cmdText,
          segments[0]?.resolution?.resolvedPath,
        );
      }
    }

    if (params.needsScreenRecording === true) {
      await sendNodeEvent(
        client,
        "exec.denied",
        buildExecEventPayload({
          sessionKey,
          runId,
          host: "node",
          command: cmdText,
          reason: "permission:screenRecording",
        }),
      );
      await sendInvokeResult(client, frame, {
        ok: false,
        error: { code: "UNAVAILABLE", message: "PERMISSION_MISSING: screenRecording" },
      });
      return;
    }

    let execArgv = argv;
    if (
      security === "allowlist" &&
      isWindows &&
      !approvedByAsk &&
      rawCommand &&
      analysisOk &&
      allowlistSatisfied &&
      segments.length === 1 &&
      segments[0]?.argv.length > 0
    ) {
      execArgv = segments[0].argv;
    }

    const result = await runCommand(
      execArgv,
      params.cwd?.trim() || undefined,
      env,
      params.timeoutMs ?? undefined,
    );
    if (result.truncated) {
      const suffix = "... (truncated)";
      if (result.stderr.trim().length > 0) {
        result.stderr = `${result.stderr}\n${suffix}`;
      } else {
        result.stdout = `${result.stdout}\n${suffix}`;
      }
    }
    const combined = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n");
    await sendNodeEvent(
      client,
      "exec.finished",
      buildExecEventPayload({
        sessionKey,
        runId,
        host: "node",
        command: cmdText,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        success: result.success,
        output: combined,
      }),
    );

    await sendInvokeResult(client, frame, {
      ok: true,
      payloadJSON: JSON.stringify({
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error ?? null,
      }),
    });
  } catch (err) {
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: String(err) },
    });
  }
}
