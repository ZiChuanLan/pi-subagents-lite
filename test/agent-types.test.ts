import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_TOOL_NAMES,
  getAgentConfig,
  getAvailableTypes,
  getConfig,
  getDefaultAgentNames,
  getToolNamesForType,
  getUserAgentNames,
  isValidType,
  registerAgents,
  resolveType,
} from "../src/agent-types.js";
import { DEFAULT_AGENTS } from "../src/default-agents.js";
import type { AgentConfig } from "../src/types.js";

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "Test agent",
    builtinToolNames: ["read", "grep"],
    extensions: false,
    systemPrompt: "You are a test agent.",
    promptMode: "replace",
    ...overrides,
  };
}

describe("agent type registry", () => {
  beforeEach(() => registerAgents(new Map()));

  it("registers the three embedded defaults", () => {
    expect(getAvailableTypes()).toEqual(["general-purpose", "Explore", "Plan"]);
    expect(getDefaultAgentNames()).toEqual(["general-purpose", "Explore", "Plan"]);
  });

  it("resolves agent names case-insensitively", () => {
    expect(isValidType("explore")).toBe(true);
    expect(resolveType("GENERAL-PURPOSE")).toBe("general-purpose");
    expect(resolveType("missing")).toBeUndefined();
  });

  it("keeps Explore and Plan read-only", () => {
    for (const name of ["Explore", "Plan"]) {
      const tools = getToolNamesForType(name);
      expect(tools).toEqual(["read", "bash", "grep", "find", "ls"]);
      expect(tools).not.toContain("edit");
      expect(tools).not.toContain("write");
    }
  });

  it("does not lock call-site strategy fields on defaults", () => {
    for (const name of ["general-purpose", "Explore", "Plan"]) {
      const config = getAgentConfig(name);
      expect(config?.runInBackground).toBeUndefined();
      expect(config?.inheritContext).toBeUndefined();
      expect(config?.isolated).toBeUndefined();
    }
  });

  it("returns the general-purpose fallback config for unknown names", () => {
    const config = getConfig("missing");
    expect(config.displayName).toBe("Agent");
    expect(config.description).toBe(DEFAULT_AGENTS.get("general-purpose")?.description);
    expect(config.builtinToolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(config.promptMode).toBe("append");
  });

  it("registers user agents alongside defaults", () => {
    registerAgents(new Map([
      ["reviewer", makeAgentConfig({ name: "reviewer", description: "Reviews code" })],
    ]));

    expect(getAvailableTypes()).toContain("reviewer");
    expect(getUserAgentNames()).toEqual(["reviewer"]);
    expect(getAgentConfig("reviewer")?.description).toBe("Reviews code");
  });

  it("lets a user profile override a default", () => {
    registerAgents(new Map([
      ["Explore", makeAgentConfig({ name: "Explore", description: "Custom Explore", builtinToolNames: ["read"] })],
    ]));

    expect(getConfig("Explore").description).toBe("Custom Explore");
    expect(getToolNamesForType("Explore")).toEqual(["read"]);
  });

  it("excludes individually disabled agents", () => {
    registerAgents(new Map([
      ["Plan", makeAgentConfig({ name: "Plan", enabled: false })],
    ]));

    expect(isValidType("Plan")).toBe(false);
    expect(resolveType("plan")).toBeUndefined();
    expect(getToolNamesForType("Plan")).toEqual([]);
    expect(getAvailableTypes()).not.toContain("Plan");
  });

  it("honors an explicit zero-tool profile", () => {
    registerAgents(new Map([
      ["observer", makeAgentConfig({ name: "observer", builtinToolNames: [] })],
    ]));
    expect(getToolNamesForType("observer")).toEqual([]);
  });

  it("derives a duplicate-free built-in tool set from Pi", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      expect(BUILTIN_TOOL_NAMES).toContain(name);
    }
    expect(new Set(BUILTIN_TOOL_NAMES).size).toBe(BUILTIN_TOOL_NAMES.length);
  });
});
