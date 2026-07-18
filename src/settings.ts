// Global defaults: ~/.pi/agent/subagents.json
// Project overrides: <cwd>/.pi/subagents.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentProfile, JoinMode, ThinkingLevel, WidgetMode } from "./types.js";

export interface SubagentsSettings {
  maxConcurrent?: number;
  defaultMaxTurns?: number;
  graceTurns?: number;
  defaultJoinMode?: JoinMode;
  fleetView?: boolean;
  widgetMode?: WidgetMode;
  outputTranscript?: boolean;
  agents?: Record<string, AgentProfile>;
}

export interface SettingsAppliers {
  setMaxConcurrent: (n: number) => void;
  setDefaultMaxTurns: (n: number) => void;
  setGraceTurns: (n: number) => void;
  setDefaultJoinMode: (mode: JoinMode) => void;
  setFleetView: (b: boolean) => void;
  setWidgetMode: (mode: WidgetMode) => void;
  setOutputTranscript: (b: boolean) => void;
}

export type SettingsEmit = (event: string, payload: unknown) => void;

const VALID_JOIN_MODES = new Set<JoinMode>(["async", "group", "smart"]);
const VALID_WIDGET_MODES = new Set<WidgetMode>(["all", "background", "off"]);
const VALID_PROMPT_MODES = new Set(["replace", "append"] as const);
const VALID_THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MAX_CONCURRENT_CEILING = 1024;
const MAX_TURNS_CEILING = 10_000;
const GRACE_TURNS_CEILING = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function sanitizeTools(value: unknown): AgentProfile["tools"] | undefined {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized === "all" || normalized === "none" ? normalized : undefined;
  }
  return stringList(value);
}

function sanitizeExtensions(value: unknown): AgentProfile["extensions"] | undefined {
  if (typeof value === "boolean") return value;
  return stringList(value);
}

/** Reject malformed profile fields independently while preserving valid siblings. */
export function sanitizeAgentProfile(raw: unknown): AgentProfile {
  if (!isRecord(raw)) return {};
  const out: AgentProfile = {};
  if (typeof raw.displayName === "string") out.displayName = raw.displayName;
  if (typeof raw.description === "string") out.description = raw.description;
  if (typeof raw.model === "string") out.model = raw.model;
  if (typeof raw.thinking === "string" && VALID_THINKING.has(raw.thinking as ThinkingLevel)) {
    out.thinking = raw.thinking as ThinkingLevel;
  }
  if (Number.isInteger(raw.maxTurns) && (raw.maxTurns as number) >= 0 && (raw.maxTurns as number) <= MAX_TURNS_CEILING) {
    out.maxTurns = raw.maxTurns as number;
  }
  const tools = sanitizeTools(raw.tools);
  if (tools !== undefined) out.tools = tools;
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (typeof raw.promptMode === "string" && VALID_PROMPT_MODES.has(raw.promptMode as "replace" | "append")) {
    out.promptMode = raw.promptMode as "replace" | "append";
  }
  if (typeof raw.inheritContext === "boolean") out.inheritContext = raw.inheritContext;
  if (typeof raw.runInBackground === "boolean") out.runInBackground = raw.runInBackground;
  if (typeof raw.isolated === "boolean") out.isolated = raw.isolated;
  const extensions = sanitizeExtensions(raw.extensions);
  if (extensions !== undefined) out.extensions = extensions;
  const excludeExtensions = stringList(raw.excludeExtensions);
  if (excludeExtensions !== undefined) out.excludeExtensions = excludeExtensions;
  const disallowedTools = stringList(raw.disallowedTools);
  if (disallowedTools !== undefined) out.disallowedTools = disallowedTools;
  if (typeof raw.outputTranscript === "boolean") out.outputTranscript = raw.outputTranscript;
  return out;
}

export function sanitizeSettings(raw: unknown): SubagentsSettings {
  if (!isRecord(raw)) return {};
  const out: SubagentsSettings = {};
  if (Number.isInteger(raw.maxConcurrent) && (raw.maxConcurrent as number) >= 1 && (raw.maxConcurrent as number) <= MAX_CONCURRENT_CEILING) {
    out.maxConcurrent = raw.maxConcurrent as number;
  }
  if (Number.isInteger(raw.defaultMaxTurns) && (raw.defaultMaxTurns as number) >= 0 && (raw.defaultMaxTurns as number) <= MAX_TURNS_CEILING) {
    out.defaultMaxTurns = raw.defaultMaxTurns as number;
  }
  if (Number.isInteger(raw.graceTurns) && (raw.graceTurns as number) >= 1 && (raw.graceTurns as number) <= GRACE_TURNS_CEILING) {
    out.graceTurns = raw.graceTurns as number;
  }
  if (typeof raw.defaultJoinMode === "string" && VALID_JOIN_MODES.has(raw.defaultJoinMode as JoinMode)) {
    out.defaultJoinMode = raw.defaultJoinMode as JoinMode;
  }
  if (typeof raw.fleetView === "boolean") out.fleetView = raw.fleetView;
  if (typeof raw.widgetMode === "string" && VALID_WIDGET_MODES.has(raw.widgetMode as WidgetMode)) {
    out.widgetMode = raw.widgetMode as WidgetMode;
  }
  if (typeof raw.outputTranscript === "boolean") out.outputTranscript = raw.outputTranscript;
  if (isRecord(raw.agents)) {
    const agents: Record<string, AgentProfile> = {};
    for (const [name, profile] of Object.entries(raw.agents)) {
      if (!name.trim() || !isRecord(profile)) continue;
      agents[name] = sanitizeAgentProfile(profile);
    }
    out.agents = agents;
  }
  return out;
}

function globalPath(): string {
  return join(getAgentDir(), "subagents.json");
}

function projectPath(cwd: string): string {
  return join(cwd, ".pi", "subagents.json");
}

function readSettingsFile(path: string): SubagentsSettings {
  if (!existsSync(path)) return {};
  try {
    return sanitizeSettings(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[pi-subagents-lite] Ignoring malformed settings at ${path}: ${reason}`);
    return {};
  }
}

/** Merge settings with field-level profile overrides. */
export function mergeSettings(global: SubagentsSettings, project: SubagentsSettings): SubagentsSettings {
  const merged = { ...global, ...project };
  const names = new Set([...Object.keys(global.agents ?? {}), ...Object.keys(project.agents ?? {})]);
  if (names.size > 0) {
    merged.agents = {};
    for (const name of names) {
      merged.agents[name] = { ...global.agents?.[name], ...project.agents?.[name] };
    }
  }
  return merged;
}

export function loadProjectSettings(cwd: string = process.cwd()): SubagentsSettings {
  return readSettingsFile(projectPath(cwd));
}

export function loadSettings(cwd: string = process.cwd()): SubagentsSettings {
  return mergeSettings(readSettingsFile(globalPath()), loadProjectSettings(cwd));
}

export function saveSettings(settings: SubagentsSettings, cwd: string = process.cwd()): boolean {
  const path = projectPath(cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function applySettings(settings: SubagentsSettings, appliers: SettingsAppliers): void {
  if (typeof settings.maxConcurrent === "number") appliers.setMaxConcurrent(settings.maxConcurrent);
  if (typeof settings.defaultMaxTurns === "number") appliers.setDefaultMaxTurns(settings.defaultMaxTurns);
  if (typeof settings.graceTurns === "number") appliers.setGraceTurns(settings.graceTurns);
  if (settings.defaultJoinMode) appliers.setDefaultJoinMode(settings.defaultJoinMode);
  if (typeof settings.fleetView === "boolean") appliers.setFleetView(settings.fleetView);
  if (settings.widgetMode) appliers.setWidgetMode(settings.widgetMode);
  if (typeof settings.outputTranscript === "boolean") appliers.setOutputTranscript(settings.outputTranscript);
}

export function persistToastFor(successMsg: string, persisted: boolean): { message: string; level: "info" | "warning" } {
  return persisted
    ? { message: successMsg, level: "info" }
    : { message: `${successMsg} (session only; failed to persist)`, level: "warning" };
}

export function applyAndEmitLoaded(
  appliers: SettingsAppliers,
  emit: SettingsEmit,
  cwd: string = process.cwd(),
): SubagentsSettings {
  const settings = loadSettings(cwd);
  applySettings(settings, appliers);
  emit("subagents:settings_loaded", { settings });
  return settings;
}

export function saveAndEmitChanged(
  snapshot: SubagentsSettings,
  successMsg: string,
  emit: SettingsEmit,
  cwd: string = process.cwd(),
): { message: string; level: "info" | "warning" } {
  const persisted = saveSettings(snapshot, cwd);
  emit("subagents:settings_changed", { settings: snapshot, persisted });
  return persistToastFor(successMsg, persisted);
}

/** Persist only explicit project overrides, preserving existing project profiles. */
export function saveAndEmitProjectPatch(
  patch: SubagentsSettings,
  successMsg: string,
  emit: SettingsEmit,
  cwd: string = process.cwd(),
): { message: string; level: "info" | "warning" } {
  const existing = loadProjectSettings(cwd);
  const projectSettings = { ...existing, ...patch };
  if (patch.agents) projectSettings.agents = { ...existing.agents, ...patch.agents };
  return saveAndEmitChanged(projectSettings, successMsg, emit, cwd);
}
