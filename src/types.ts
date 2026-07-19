/** Shared types for pi-subagents-lite. */

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { LifetimeUsage } from "./usage.js";

export type { ThinkingLevel };
export type SubagentType = string;
export const DEFAULT_AGENT_NAMES = ["general-purpose", "Explore", "Research", "Plan", "Review"] as const;

export type AgentExtensions = true | string[] | false;
export type AgentTools = string[] | "all" | "none";
/** How the profile selected tools. Explicit arrays never auto-include unselected extension tools. */
export type ToolsPolicy = "all" | "none" | "explicit";

/** Sanitized JSON profile. All fields are optional so profiles can override defaults field-by-field. */
export interface AgentProfile {
  displayName?: string;
  description?: string;
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  tools?: AgentTools;
  enabled?: boolean;
  promptMode?: "replace" | "append";
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  extensions?: AgentExtensions;
  excludeExtensions?: string[];
  disallowedTools?: string[];
  outputTranscript?: boolean;
}

export interface AgentConfig {
  name: string;
  displayName?: string;
  description: string;
  builtinToolNames?: string[];
  /** Raw extension selectors from tools, e.g. ext:mcp or ext:mcp/search. */
  extSelectors?: string[];
  /**
   * Retained from the profile `tools` field so runtime can distinguish:
   * - omitted: legacy “all loaded extension tools” behavior when extensions load
   * - all / none / explicit array
   */
  toolsPolicy?: ToolsPolicy;
  disallowedTools?: string[];
  extensions: AgentExtensions;
  excludeExtensions?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  outputTranscript?: boolean;
  systemPrompt: string;
  promptMode: "replace" | "append";
  inheritContext?: boolean;
  runInBackground?: boolean;
  isolated?: boolean;
  isDefault?: boolean;
  enabled?: boolean;
  source?: "default" | "project" | "global" | "json";
}

export type JoinMode = "async" | "group" | "smart";
export type WidgetMode = "all" | "background" | "off";

export interface AgentRecord {
  id: string;
  type: SubagentType;
  description: string;
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  session?: AgentSession;
  abortController?: AbortController;
  promise?: Promise<string>;
  groupId?: string;
  joinMode?: JoinMode;
  resultConsumed?: boolean;
  pendingSteers?: string[];
  toolCallId?: string;
  outputFile?: string;
  outputCleanup?: () => void;
  lifetimeUsage: LifetimeUsage;
  compactionCount: number;
  isBackground?: boolean;
  invocation?: AgentInvocation;
}

export interface AgentInvocation {
  modelName?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  runInBackground?: boolean;
}

export interface NotificationDetails {
  id: string;
  description: string;
  status: string;
  toolUses: number;
  turnCount: number;
  maxTurns?: number;
  totalTokens: number;
  durationMs: number;
  outputFile?: string;
  error?: string;
  resultPreview: string;
  others?: NotificationDetails[];
}

export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}
