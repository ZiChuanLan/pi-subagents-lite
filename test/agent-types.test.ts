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

  it("registers the five embedded defaults in lite order", () => {
    expect(getAvailableTypes()).toEqual([
      "general-purpose",
      "Explore",
      "Research",
      "Plan",
      "Review",
    ]);
    expect(getDefaultAgentNames()).toEqual([
      "general-purpose",
      "Explore",
      "Research",
      "Plan",
      "Review",
    ]);
    expect(getAgentConfig("general-purpose")?.displayName).toBe("Implement");
  });

  it("resolves agent names case-insensitively", () => {
    expect(isValidType("explore")).toBe(true);
    expect(resolveType("GENERAL-PURPOSE")).toBe("general-purpose");
    expect(resolveType("missing")).toBeUndefined();
  });

  it("keeps Explore, Plan, and Review truly read-only without shell", () => {
    for (const name of ["Explore", "Plan", "Review"]) {
      const tools = getToolNamesForType(name);
      expect(tools).toEqual(["read", "grep", "find", "ls"]);
      expect(tools).not.toContain("bash");
      expect(tools).not.toContain("edit");
      expect(tools).not.toContain("write");
      const config = getAgentConfig(name);
      expect(config?.toolsPolicy).toBe("explicit");
      expect(config?.isolated).toBe(true);
      expect(config?.inheritContext).toBe(false);
      expect(config?.extensions).toBe(false);
    }
  });

  it("Research is read-only local tools plus web-access selectors", () => {
    const config = getAgentConfig("Research");
    expect(getToolNamesForType("Research")).toEqual(["read", "grep", "find", "ls"]);
    expect(config?.toolsPolicy).toBe("explicit");
    expect(config?.isolated).toBe(false);
    expect(config?.extensions).toEqual(["pi-web-access"]);
    expect(config?.extSelectors).toEqual([
      "ext:pi-web-access/web_search",
      "ext:pi-web-access/fetch_content",
      "ext:pi-web-access/get_search_content",
    ]);
    expect(config?.maxTurns).toBe(10);
  });

  it("bounds default agents so they stay single-level workers", () => {
    const general = getAgentConfig("general-purpose");
    expect(general?.promptMode).toBe("replace");
    expect(general?.isolated).toBe(true);
    expect(general?.inheritContext).toBe(false);
    expect(general?.extensions).toBe(false);
    expect(general?.maxTurns).toBe(14);
    expect(getAgentConfig("Explore")?.maxTurns).toBe(8);
    expect(getAgentConfig("Plan")?.maxTurns).toBe(12);
    expect(getAgentConfig("Review")?.maxTurns).toBe(10);
  });

  it("returns the general-purpose fallback config for unknown names", () => {
    const config = getConfig("missing");
    expect(config.displayName).toBe("Implement");
    expect(config.description).toBe(DEFAULT_AGENTS.get("general-purpose")?.description);
    expect(config.builtinToolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(config.promptMode).toBe("replace");
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
