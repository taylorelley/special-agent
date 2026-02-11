import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "special-agent", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "special-agent", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "special-agent", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "special-agent", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "special-agent", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "special-agent", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "special-agent", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "special-agent"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "special-agent", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "special-agent", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "special-agent", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "special-agent", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "special-agent", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "special-agent", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "special-agent", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "special-agent", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "special-agent", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "special-agent", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "special-agent", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "special-agent", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "special-agent", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "special-agent", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["node", "special-agent", "status"],
    });
    expect(nodeArgv).toEqual(["node", "special-agent", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["node-22", "special-agent", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "special-agent", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["node-22.2.0.exe", "special-agent", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "special-agent", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["node-22.2", "special-agent", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "special-agent", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["node-22.2.exe", "special-agent", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "special-agent", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["/usr/bin/node-22.2.0", "special-agent", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "special-agent", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["nodejs", "special-agent", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "special-agent", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["node-dev", "special-agent", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "special-agent", "node-dev", "special-agent", "status"]);

    const directArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["special-agent", "status"],
    });
    expect(directArgv).toEqual(["node", "special-agent", "status"]);

    const bunArgv = buildParseArgv({
      programName: "special-agent",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "special-agent",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "special-agent", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "special-agent", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "special-agent", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "special-agent", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "special-agent", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "special-agent", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "special-agent", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "special-agent", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
