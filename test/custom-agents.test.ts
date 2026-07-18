import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOL_NAMES } from "../src/agent-types.js";
import { loadCustomAgents } from "../src/custom-agents.js";

describe("loadCustomAgents", () => {
  let cwd: string;
  let globalDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "subagents-project-"));
    globalDir = mkdtempSync(join(tmpdir(), "subagents-global-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = globalDir;
  });

  afterEach(() => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  function writePrompt(root: string, name: string, body: string): void {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, `${name}.md`), body);
  }

  const piPrompts = () => join(cwd, ".pi", "agents");
  const workspacePrompts = () => join(cwd, ".agents", "agents");
  const globalPrompts = () => join(globalDir, "agents");

  it("loads preferred body-only Markdown", () => {
    writePrompt(piPrompts(), "reviewer", "Review the implementation carefully.");
    const agent = loadCustomAgents(cwd).get("reviewer");
    expect(agent).toMatchObject({
      name: "reviewer",
      description: "reviewer",
      systemPrompt: "Review the implementation carefully.",
      promptMode: "replace",
      extensions: true,
      source: "project",
    });
    expect(agent?.builtinToolNames).toBeUndefined();
  });

  it("preserves prompt precedence: .pi > .agents > global", () => {
    writePrompt(globalPrompts(), "reviewer", "Global prompt");
    writePrompt(workspacePrompts(), "reviewer", "Workspace prompt");
    writePrompt(piPrompts(), "reviewer", "Project prompt");
    expect(loadCustomAgents(cwd).get("reviewer")?.systemPrompt).toBe("Project prompt");
  });

  it("uses workspace prompt when .pi prompt is absent", () => {
    writePrompt(globalPrompts(), "reviewer", "Global prompt");
    writePrompt(workspacePrompts(), "reviewer", "Workspace prompt");
    expect(loadCustomAgents(cwd).get("reviewer")?.systemPrompt).toBe("Workspace prompt");
  });

  it("supports legacy frontmatter as a compatibility fallback", () => {
    writePrompt(piPrompts(), "legacy", `---
display_name: Legacy Reviewer
description: Legacy description
tools: read, grep
model: provider/legacy
thinking: high
max_turns: 12
prompt_mode: append
extensions: false
disallowed_tools: bash
inherit_context: true
run_in_background: true
output_transcript: false
isolated: true
enabled: false
---

Legacy persona.`);
    expect(loadCustomAgents(cwd).get("legacy")).toMatchObject({
      displayName: "Legacy Reviewer",
      description: "Legacy description",
      builtinToolNames: ["read", "grep"],
      model: "provider/legacy",
      thinking: "high",
      maxTurns: 12,
      promptMode: "append",
      extensions: false,
      disallowedTools: ["bash"],
      inheritContext: true,
      runInBackground: true,
      outputTranscript: false,
      isolated: true,
      enabled: false,
      systemPrompt: "Legacy persona.",
    });
  });

  it("JSON profile fields override legacy frontmatter", () => {
    writePrompt(piPrompts(), "reviewer", `---
description: Legacy description
tools: read
model: provider/legacy
prompt_mode: replace
extensions: false
enabled: false
---

Keep this persona.`);
    const agent = loadCustomAgents(cwd, {
      reviewer: {
        displayName: "JSON Reviewer",
        description: "JSON description",
        tools: ["grep", "find"],
        model: "provider/json",
        promptMode: "append",
        extensions: ["mcp"],
        enabled: true,
      },
    }).get("reviewer");
    expect(agent).toMatchObject({
      displayName: "JSON Reviewer",
      description: "JSON description",
      builtinToolNames: ["grep", "find"],
      model: "provider/json",
      promptMode: "append",
      extensions: ["mcp"],
      enabled: true,
      systemPrompt: "Keep this persona.",
    });
  });

  it("JSON may override a built-in without an MD file", () => {
    const explore = loadCustomAgents(cwd, {
      Explore: { description: "Local scout", model: "provider/scout", enabled: false },
    }).get("Explore");
    expect(explore).toMatchObject({
      name: "Explore",
      description: "Local scout",
      model: "provider/scout",
      enabled: false,
      isDefault: true,
      source: "json",
    });
    expect(explore?.systemPrompt).toContain("READ-ONLY MODE");
  });

  it("JSON may define a custom agent with an empty prompt", () => {
    expect(loadCustomAgents(cwd, {
      oracle: { description: "Challenge assumptions", tools: "none", extensions: false },
    }).get("oracle")).toEqual({
      name: "oracle",
      description: "Challenge assumptions",
      extensions: false,
      systemPrompt: "",
      promptMode: "replace",
      enabled: true,
      source: "json",
      builtinToolNames: [],
    });
  });

  it("supports tools all/none and explicit arrays", () => {
    const agents = loadCustomAgents(cwd, {
      all: { tools: "all" },
      none: { tools: "none" },
      narrow: { tools: ["read", "grep"] },
    });
    expect(agents.get("all")?.builtinToolNames).toBeUndefined();
    expect(agents.get("none")?.builtinToolNames).toEqual([]);
    expect(agents.get("narrow")?.builtinToolNames).toEqual(["read", "grep"]);
  });

  it("legacy tools all maps to all built-ins and ext selectors are ignored", () => {
    writePrompt(piPrompts(), "legacy", `---
tools: all, ext:foo
---

Prompt.`);
    expect(loadCustomAgents(cwd).get("legacy")?.builtinToolNames).toEqual(BUILTIN_TOOL_NAMES);
  });
});
