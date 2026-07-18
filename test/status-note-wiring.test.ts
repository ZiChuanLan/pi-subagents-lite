import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js");
  return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";

const MANAGER_KEY = Symbol.for("pi-subagents:manager");

type ManagerHandle = {
  abort(id: string): boolean;
};

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

function ctx() {
  return {
    hasUI: false,
    ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: { getSessionId: vi.fn(() => "s1"), getBranch: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent"),
  } as any;
}

const textOf = (result: any): string => result.content[0].text;

async function shutdown(lifecycle: Map<string, any>): Promise<void> {
  await lifecycle.get("session_shutdown")?.({}, ctx());
}

describe("status note reaches the parent through the real handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<symbol, unknown>)[MANAGER_KEY];
  });

  it("foreground turn-limit abort is reported as incomplete", async () => {
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "partial work so far",
      session: { dispose: vi.fn() } as any,
      aborted: true,
      steered: false,
    });
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);

    const result = await tools.get("subagent").execute(
      "tc1",
      { prompt: "go", description: "d", subagent_type: "general-purpose" },
      undefined,
      undefined,
      ctx(),
    );

    const output = textOf(result);
    expect(output).toContain("hit the turn limit");
    expect(output).toContain("partial work so far");
    expect(output).not.toContain("STOPPED BY THE USER");
    await shutdown(lifecycle);
  });

  it("background user stop is reported as stopped, not completed", async () => {
    vi.mocked(runAgent).mockReturnValue(new Promise(() => {}) as any);
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);

    const spawn = await tools.get("subagent").execute(
      "tc2",
      { prompt: "go", description: "d", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
      ctx(),
    );
    const id = textOf(spawn).match(/Agent ID: (\S+)/)?.[1];
    expect(id).toBeTruthy();

    const manager = (globalThis as Record<symbol, unknown>)[MANAGER_KEY] as ManagerHandle;
    expect(manager.abort(id!)).toBe(true);

    const result = await tools.get("get_subagent_result").execute(
      "tc3",
      { agent_id: id },
      undefined,
      undefined,
      ctx(),
    );

    const output = textOf(result);
    expect(output).toContain("STOPPED BY THE USER");
    expect(output).toContain("the task was NOT finished");
    expect(output).not.toContain("Done");
    await shutdown(lifecycle);
  });
});
