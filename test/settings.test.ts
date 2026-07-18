import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAndEmitLoaded,
  applySettings,
  loadSettings,
  mergeSettings,
  persistToastFor,
  type SettingsAppliers,
  sanitizeAgentProfile,
  sanitizeSettings,
  saveAndEmitChanged,
  saveAndEmitProjectPatch,
  saveSettings,
} from "../src/settings.js";

describe("subagents settings", () => {
  let globalDir: string;
  let projectDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), "subagents-global-"));
    projectDir = mkdtempSync(join(tmpdir(), "subagents-project-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = globalDir;
  });

  afterEach(() => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  const globalFile = () => join(globalDir, "subagents.json");
  const projectFile = () => join(projectDir, ".pi", "subagents.json");
  const writeGlobal = (value: unknown) => writeFileSync(globalFile(), JSON.stringify(value));
  const writeProject = (value: unknown) => {
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(projectFile(), JSON.stringify(value));
  };
  const readJson = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch (error) {
      throw new Error(`Expected valid JSON at ${path}: ${String(error)}`);
    }
  };

  it("loads operational settings with project overrides", () => {
    writeGlobal({ maxConcurrent: 8, graceTurns: 5, defaultJoinMode: "async" });
    writeProject({ maxConcurrent: 3, fleetView: false });
    expect(loadSettings(projectDir)).toEqual({
      maxConcurrent: 3,
      graceTurns: 5,
      defaultJoinMode: "async",
      fleetView: false,
    });
  });

  it("merges global/project profiles field-by-field", () => {
    const merged = mergeSettings(
      { agents: { reviewer: { model: "global/model", tools: ["read"], enabled: true } } },
      { agents: { reviewer: { thinking: "high", enabled: false }, scout: { tools: "none" } } },
    );
    expect(merged.agents).toEqual({
      reviewer: { model: "global/model", tools: ["read"], thinking: "high", enabled: false },
      scout: { tools: "none" },
    });
  });

  it("sanitizes every supported profile field", () => {
    expect(sanitizeAgentProfile({
      displayName: "Reviewer",
      description: "Reviews code",
      model: "provider/model",
      thinking: "high",
      maxTurns: 0,
      tools: ["read", "grep"],
      enabled: false,
      promptMode: "append",
      inheritContext: true,
      runInBackground: true,
      isolated: true,
      extensions: ["mcp", "notify"],
      excludeExtensions: ["notify"],
      disallowedTools: ["bash"],
      outputTranscript: false,
    })).toEqual({
      displayName: "Reviewer",
      description: "Reviews code",
      model: "provider/model",
      thinking: "high",
      maxTurns: 0,
      tools: ["read", "grep"],
      enabled: false,
      promptMode: "append",
      inheritContext: true,
      runInBackground: true,
      isolated: true,
      extensions: ["mcp", "notify"],
      excludeExtensions: ["notify"],
      disallowedTools: ["bash"],
      outputTranscript: false,
    });
  });

  it("supports tools all/none and boolean extension semantics", () => {
    expect(sanitizeAgentProfile({ tools: "all", extensions: true })).toEqual({ tools: "all", extensions: true });
    expect(sanitizeAgentProfile({ tools: "none", extensions: false })).toEqual({ tools: "none", extensions: false });
  });

  it("rejects malformed profile fields while preserving valid siblings", () => {
    expect(sanitizeAgentProfile({
      description: "valid",
      model: 42,
      thinking: "turbo",
      maxTurns: -1,
      tools: ["read", 9],
      enabled: "yes",
      promptMode: "merge",
      extensions: { bad: true },
      excludeExtensions: ["ok", 1],
      outputTranscript: false,
    })).toEqual({ description: "valid", outputTranscript: false });
  });

  it("drops malformed agent entries without dropping valid profiles", () => {
    expect(sanitizeSettings({
      agents: {
        good: { description: "Good", maxTurns: 10 },
        bad: "not an object",
        mixed: { tools: "invalid", enabled: true },
      },
    })).toEqual({
      agents: {
        good: { description: "Good", maxTurns: 10 },
        mixed: { enabled: true },
      },
    });
  });

  it("round-trips profiles and operational settings", () => {
    const settings = {
      maxConcurrent: 4,
      defaultMaxTurns: 0,
      graceTurns: 3,
      defaultJoinMode: "smart" as const,
      fleetView: true,
      widgetMode: "background" as const,
      outputTranscript: false,
      agents: { Explore: { enabled: false }, custom: { model: "provider/model" } },
    };
    expect(saveSettings(settings, projectDir)).toBe(true);
    expect(loadSettings(projectDir)).toEqual(settings);
    expect(readJson(projectFile())).toEqual(settings);
  });

  it("warns and ignores malformed JSON", () => {
    writeProject({ maxConcurrent: 2 });
    writeFileSync(projectFile(), "not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadSettings(projectDir)).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pi-subagents-lite"));
    warn.mockRestore();
  });

  function appliers(): SettingsAppliers {
    return {
      setMaxConcurrent: vi.fn(),
      setDefaultMaxTurns: vi.fn(),
      setGraceTurns: vi.fn(),
      setDefaultJoinMode: vi.fn(),
      setFleetView: vi.fn(),
      setWidgetMode: vi.fn(),
      setOutputTranscript: vi.fn(),
    };
  }

  it("applies only operational settings", () => {
    const targets = appliers();
    applySettings({ maxConcurrent: 7, agents: { reviewer: { enabled: false } }, outputTranscript: false }, targets);
    expect(targets.setMaxConcurrent).toHaveBeenCalledWith(7);
    expect(targets.setOutputTranscript).toHaveBeenCalledWith(false);
    expect(targets.setGraceTurns).not.toHaveBeenCalled();
  });

  it("loads, applies, and emits the settings snapshot", () => {
    writeProject({ maxConcurrent: 5, agents: { reviewer: { tools: "none" } } });
    const targets = appliers();
    const emit = vi.fn();
    const result = applyAndEmitLoaded(targets, emit, projectDir);
    expect(result.agents?.reviewer.tools).toBe("none");
    expect(targets.setMaxConcurrent).toHaveBeenCalledWith(5);
    expect(emit).toHaveBeenCalledWith("subagents:settings_loaded", { settings: result });
  });

  it("saveAndEmitChanged preserves profiles in the persisted snapshot", () => {
    const emit = vi.fn();
    const snapshot = { maxConcurrent: 2, agents: { reviewer: { enabled: false } } };
    expect(saveAndEmitChanged(snapshot, "saved", emit, projectDir)).toEqual({ message: "saved", level: "info" });
    expect(readJson(projectFile())).toEqual(snapshot);
  });

  it("persists only explicit project patches without copying global settings", () => {
    writeGlobal({ maxConcurrent: 8, graceTurns: 9, agents: { globalOnly: { model: "global/model" } } });
    writeProject({ agents: { reviewer: { enabled: false } } });
    const emit = vi.fn();

    expect(saveAndEmitProjectPatch({ fleetView: false }, "saved", emit, projectDir)).toEqual({
      message: "saved",
      level: "info",
    });
    expect(readJson(projectFile())).toEqual({
      fleetView: false,
      agents: { reviewer: { enabled: false } },
    });
  });

  it("formats persistence failure toasts", () => {
    expect(persistToastFor("saved", false)).toEqual({
      message: "saved (session only; failed to persist)",
      level: "warning",
    });
  });
});
