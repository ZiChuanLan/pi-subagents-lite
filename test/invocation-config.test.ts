import { describe, expect, it } from "vitest";
import { resolveAgentInvocationConfig, resolveJoinMode } from "../src/invocation-config.js";
import type { AgentConfig } from "../src/types.js";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "Explore",
    description: "Explore",
    builtinToolNames: ["read"],
    extensions: false,
    systemPrompt: "Test agent",
    promptMode: "replace",
    ...overrides,
  };
}

describe("resolveAgentInvocationConfig", () => {
  it("prefers profile values over tool-call parameters", () => {
    const resolved = resolveAgentInvocationConfig(
      makeConfig({
        model: "provider/config-model",
        thinking: "high",
        maxTurns: 42,
        inheritContext: false,
        runInBackground: false,
        isolated: false,
      }),
      {
        model: "provider/param-model",
        thinking: "minimal",
        max_turns: 1,
        inherit_context: true,
        run_in_background: true,
        isolated: true,
      },
    );

    expect(resolved).toEqual({
      modelInput: "provider/config-model",
      modelFromParams: false,
      thinking: "high",
      maxTurns: 42,
      inheritContext: false,
      runInBackground: false,
      isolated: false,
    });
  });

  it("uses tool-call parameters when no profile is available", () => {
    expect(resolveAgentInvocationConfig(undefined, {
      model: "provider/param-model",
      thinking: "minimal",
      max_turns: 3,
      inherit_context: true,
      run_in_background: true,
      isolated: true,
    })).toEqual({
      modelInput: "provider/param-model",
      modelFromParams: true,
      thinking: "minimal",
      maxTurns: 3,
      inheritContext: true,
      runInBackground: true,
      isolated: true,
    });
  });

  it("lets params fill profile gaps", () => {
    const resolved = resolveAgentInvocationConfig(
      makeConfig({ inheritContext: undefined, runInBackground: undefined, isolated: undefined }),
      { inherit_context: true, run_in_background: true, isolated: true },
    );
    expect(resolved.inheritContext).toBe(true);
    expect(resolved.runInBackground).toBe(true);
    expect(resolved.isolated).toBe(true);
  });

  it("defaults strategy booleans to false", () => {
    const resolved = resolveAgentInvocationConfig(makeConfig(), {});
    expect(resolved.inheritContext).toBe(false);
    expect(resolved.runInBackground).toBe(false);
    expect(resolved.isolated).toBe(false);
  });
});

describe("resolveJoinMode", () => {
  it("uses the configured mode only for background agents", () => {
    expect(resolveJoinMode("smart", true)).toBe("smart");
    expect(resolveJoinMode("group", false)).toBeUndefined();
  });
});
