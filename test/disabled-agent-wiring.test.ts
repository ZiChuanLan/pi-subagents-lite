import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js");
  return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";

function makePi() {
  const tools = new Map<string, any>();
  const lifecycle = new Map<string, any>();
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn((tool: any) => tools.set(tool.name, tool)),
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: any) => lifecycle.set(event, handler)),
    events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
    sendMessage: vi.fn(),
  } as any;
  return { pi, tools, lifecycle };
}

function ctx(cwd: string) {
  return {
    hasUI: false,
    ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
    cwd,
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: { getSessionId: vi.fn(() => "s1"), getBranch: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent"),
  } as any;
}

const textOf = (result: any): string => result.content[0].text;

const MANAGER_KEY = Symbol.for("pi-subagents:manager");

describe("disabled agent execution boundary", () => {
  let cwd: string;
  let agentDir: string;
  let previousCwd: string;
  let previousAgentDir: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "subagents-disabled-"));
    agentDir = mkdtempSync(join(tmpdir(), "subagents-disabled-global-"));
    previousCwd = process.cwd();
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.chdir(cwd);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "subagents.json"), JSON.stringify({
      agents: {
        blocked: { enabled: false, tools: "all" },
        observer: { description: "No-tool observer", tools: "none", extensions: false },
      },
    }));
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    delete (globalThis as Record<symbol, unknown>)[MANAGER_KEY];
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects a disabled type without falling back or invoking runAgent", async () => {
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);
    const tool = tools.get("subagent");
    expect(tool.description).toContain("observer: No-tool observer (Tools: none)");
    expect(tool.description).not.toContain("blocked:");

    const result = await tool.execute(
      "tc",
      { prompt: "go", description: "blocked", subagent_type: "BLOCKED" },
      undefined,
      undefined,
      ctx(cwd),
    );

    expect(textOf(result)).toBe('Agent type "blocked" is disabled.');
    expect(runAgent).not.toHaveBeenCalled();
    await lifecycle.get("session_shutdown")?.({}, ctx(cwd));
  });

  it("does not route an unknown type through a disabled general-purpose fallback", async () => {
    writeFileSync(join(cwd, ".pi", "subagents.json"), JSON.stringify({
      agents: { "general-purpose": { enabled: false } },
    }));
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);

    const result = await tools.get("subagent").execute(
      "tc",
      { prompt: "go", description: "unknown", subagent_type: "does-not-exist" },
      undefined,
      undefined,
      ctx(cwd),
    );

    expect(textOf(result)).toBe(
      'Unknown agent type "does-not-exist" cannot fall back because "general-purpose" is disabled.',
    );
    expect(runAgent).not.toHaveBeenCalled();
    await lifecycle.get("session_shutdown")?.({}, ctx(cwd));
  });
});
