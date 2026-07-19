import { beforeEach, describe, expect, it } from "vitest";
import { getAgentConfig, registerAgents } from "../src/agent-types.js";
import { buildAgentPrompt } from "../src/prompts.js";
import type { AgentConfig, EnvInfo } from "../src/types.js";

const gitEnv: EnvInfo = { isGitRepo: true, branch: "main", platform: "darwin" };
const plainEnv: EnvInfo = { isGitRepo: false, branch: "", platform: "linux" };

beforeEach(() => registerAgents(new Map()));

function defaultConfig(name: string): AgentConfig {
  const config = getAgentConfig(name);
  if (!config) throw new Error(`Missing default config: ${name}`);
  return config;
}

describe("buildAgentPrompt", () => {
  it("includes cwd, platform, and git information", () => {
    const prompt = buildAgentPrompt(defaultConfig("general-purpose"), "/workspace", gitEnv);
    expect(prompt).toContain("/workspace");
    expect(prompt).toContain("Branch: main");
    expect(prompt).toContain("darwin");
  });

  it("describes non-git working directories", () => {
    const prompt = buildAgentPrompt(defaultConfig("Explore"), "/workspace", plainEnv);
    expect(prompt).toContain("Not a git repository");
    expect(prompt).not.toContain("Branch:");
  });

  it("keeps embedded Explore, Plan, and Review prompts read-only and single-level", () => {
    const explore = buildAgentPrompt(defaultConfig("Explore"), "/workspace", gitEnv);
    expect(explore).toMatch(/local codebase recon|LOCAL/i);
    expect(explore).toContain("<sub_agent_contract>");
    expect(explore).toMatch(/Never dispatch|never dispatch/i);
    expect(buildAgentPrompt(defaultConfig("Plan"), "/workspace", gitEnv)).toMatch(/read-only design|implementation plan/i);
    expect(buildAgentPrompt(defaultConfig("Review"), "/workspace", gitEnv)).toMatch(/read-only audit|Findings/i);
    expect(buildAgentPrompt(defaultConfig("Research"), "/workspace", gitEnv)).toMatch(/web_search|docs/i);
  });

  it("append mode preserves the parent prompt and adds the child bridge", () => {
    const config: AgentConfig = {
      name: "reviewer",
      description: "Reviewer",
      extensions: true,
      systemPrompt: "Review carefully.",
      promptMode: "append",
    };
    const prompt = buildAgentPrompt(config, "/workspace", gitEnv, "Parent prompt.");
    expect(prompt.startsWith("Parent prompt.")).toBe(true);
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).toContain("<agent_instructions>\nReview carefully.\n</agent_instructions>");
  });

  it("append mode with an empty body is a parent twin but still gets the child contract", () => {
    const config: AgentConfig = {
      name: "general-purpose",
      description: "Agent",
      extensions: true,
      systemPrompt: "",
      promptMode: "append",
    };
    const prompt = buildAgentPrompt(config, "/workspace", gitEnv, "Parent prompt.");
    expect(prompt.startsWith("Parent prompt.")).toBe(true);
    expect(prompt).not.toContain("<agent_instructions>");
    expect(prompt).toContain("<sub_agent_contract>");
  });

  it("default general-purpose is replace mode and does not inherit parent identity", () => {
    const prompt = buildAgentPrompt(
      defaultConfig("general-purpose"),
      "/workspace",
      gitEnv,
      "SECRET PARENT WORKFLOW",
    );
    expect(prompt).not.toContain("SECRET PARENT WORKFLOW");
    expect(prompt).toContain("<sub_agent_contract>");
    expect(prompt).toMatch(/single-level/i);
  });

  it("replace mode ignores parent identity and uses the prompt body", () => {
    const config: AgentConfig = {
      name: "auditor",
      description: "Auditor",
      extensions: false,
      systemPrompt: "Audit security boundaries.",
      promptMode: "replace",
    };
    const prompt = buildAgentPrompt(config, "/workspace", gitEnv, "SECRET PARENT");
    expect(prompt).toContain("Audit security boundaries.");
    expect(prompt).not.toContain("SECRET PARENT");
    expect(prompt).not.toContain("<sub_agent_context>");
  });

  it("escapes the active-agent identity as an XML attribute", () => {
    const prompt = buildAgentPrompt({
      name: `reviewer"'&<>`,
      description: "Reviewer",
      extensions: false,
      systemPrompt: "Review.",
      promptMode: "replace",
    }, "/workspace", gitEnv);
    expect(prompt).toMatch(/^<active_agent name="reviewer&quot;&apos;&amp;&lt;&gt;"\/>/);
    expect(prompt.match(/<active_agent /g)).toHaveLength(1);
  });

  it("always identifies the active agent for permission policies", () => {
    const replace = buildAgentPrompt({
      name: "Some Agent With Spaces",
      description: "Test",
      extensions: true,
      systemPrompt: "Test.",
      promptMode: "replace",
    }, "/workspace", gitEnv);
    expect(replace).toMatch(/^<active_agent name="Some Agent With Spaces"\/>/);

    const append = buildAgentPrompt({
      name: "reviewer",
      description: "Reviewer",
      extensions: true,
      systemPrompt: "Review.",
      promptMode: "append",
    }, "/workspace", gitEnv, "Parent.");
    expect(append.indexOf('<active_agent name="reviewer"/>')).toBeGreaterThan(append.indexOf("<sub_agent_context>"));
    expect(append.indexOf('<active_agent name="reviewer"/>')).toBeLessThan(append.indexOf("# Environment"));
  });

  it("does not inject removed memory or dedicated skill-preload sections", () => {
    const prompt = buildAgentPrompt(defaultConfig("Explore"), "/workspace", gitEnv);
    expect(prompt).not.toContain("Agent Memory");
    expect(prompt).not.toContain("Preloaded Skill:");
  });
});
