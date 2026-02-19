import type { Command } from "commander";

export function hasExplicitOptions(command: Command, names: readonly string[]): boolean {
  if (typeof command.getOptionValueSource !== "function") {
    return false;
  }
  return names.some((name) => command.getOptionValueSource(name) === "cli");
}

const MAX_INHERIT_DEPTH = 2;

function getOptionSource(command: Command, name: string): string | undefined {
  if (typeof command.getOptionValueSource !== "function") {
    return undefined;
  }
  return command.getOptionValueSource(name);
}

/**
 * Walk up the Commander command hierarchy (up to MAX_INHERIT_DEPTH ancestors)
 * to find a non-default option value set on a parent/grandparent command.
 * Returns undefined if the child already has an explicit (non-default) source
 * for the option or if no ancestor set it.
 */
export function inheritOptionFromParent<T>(command: Command, name: string): T | undefined {
  const childSource = getOptionSource(command, name);
  if (childSource && childSource !== "default") {
    return undefined;
  }

  let current: Command | null = command.parent ?? null;
  for (let depth = 0; current && depth < MAX_INHERIT_DEPTH; depth++) {
    const source = getOptionSource(current, name);
    if (source && source !== "default") {
      const opts = current.opts();
      return (opts as Record<string, unknown>)[name] as T;
    }
    current = current.parent ?? null;
  }
  return undefined;
}
