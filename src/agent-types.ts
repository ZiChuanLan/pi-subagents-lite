/** Unified runtime registry for embedded and configured agent types. */

import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { DEFAULT_AGENTS } from "./default-agents.js";
import type { AgentConfig } from "./types.js";

export const BUILTIN_TOOL_NAMES: string[] = [
  ...new Set([...createCodingTools("."), ...createReadOnlyTools(".")].map((tool) => tool.name)),
];

const agents = new Map<string, AgentConfig>();

export function registerAgents(userAgents: Map<string, AgentConfig>): void {
  agents.clear();
  for (const [name, config] of DEFAULT_AGENTS) agents.set(name, config);
  for (const [name, config] of userAgents) agents.set(name, config);
}

function resolveKey(name: string): string | undefined {
  if (agents.has(name)) return name;
  const lower = name.toLowerCase();
  for (const key of agents.keys()) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}

export function resolveType(name: string): string | undefined {
  const key = resolveKey(name);
  return key !== undefined && agents.get(key)?.enabled !== false ? key : undefined;
}

export function getAgentConfig(name: string): AgentConfig | undefined {
  const key = resolveKey(name);
  return key ? agents.get(key) : undefined;
}

export function getAvailableTypes(): string[] {
  return [...agents.entries()].filter(([, config]) => config.enabled !== false).map(([name]) => name);
}

export function getAllTypes(): string[] {
  return [...agents.keys()];
}

export function getDefaultAgentNames(): string[] {
  return [...agents.entries()].filter(([, config]) => config.isDefault === true).map(([name]) => name);
}

export function getUserAgentNames(): string[] {
  return [...agents.entries()].filter(([, config]) => config.isDefault !== true).map(([name]) => name);
}

export function isValidType(type: string): boolean {
  const key = resolveKey(type);
  return key !== undefined && agents.get(key)?.enabled !== false;
}

export function getToolNamesForType(type: string): string[] {
  const key = resolveKey(type);
  const config = key ? agents.get(key) : undefined;
  if (config?.enabled === false) return [];
  return config?.builtinToolNames ?? [...BUILTIN_TOOL_NAMES];
}

export function getConfig(type: string): {
  displayName: string;
  description: string;
  builtinToolNames: string[];
  extensions: true | string[] | false;
  excludeExtensions?: string[];
  promptMode: "replace" | "append";
} {
  const key = resolveKey(type);
  const config = key ? agents.get(key) : undefined;
  if (config && config.enabled !== false) {
    return {
      displayName: config.displayName ?? config.name,
      description: config.description,
      builtinToolNames: config.builtinToolNames ?? BUILTIN_TOOL_NAMES,
      extensions: config.extensions,
      excludeExtensions: config.excludeExtensions,
      promptMode: config.promptMode,
    };
  }

  const fallback = agents.get("general-purpose") ?? DEFAULT_AGENTS.get("general-purpose");
  return {
    displayName: fallback?.displayName ?? "Agent",
    description: fallback?.description ?? "General-purpose agent for complex, multi-step tasks",
    builtinToolNames: fallback?.builtinToolNames ?? BUILTIN_TOOL_NAMES,
    extensions: fallback?.extensions ?? true,
    excludeExtensions: fallback?.excludeExtensions,
    promptMode: fallback?.promptMode ?? "append",
  };
}
