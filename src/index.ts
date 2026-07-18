/**
 * pi-subagents-lite — autonomous child agents for Pi.
 *
 * Tools:
 *   subagent             — LLM-callable: spawn a sub-agent
 *   get_subagent_result  — LLM-callable: check background agent status/result
 *   steer_subagent       — LLM-callable: send a steering message to a running agent
 *
 * Commands:
 *   /agents                 — Interactive agent management menu
 */

import { defineTool, type ExtensionAPI, type ExtensionCommandContext, getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { AgentManager } from "./agent-manager.js";
import { getAgentConversation, getDefaultMaxTurns, getGraceTurns, normalizeMaxTurns, SUBAGENT_TOOL_NAMES, setDefaultMaxTurns, setGraceTurns, steerAgent } from "./agent-runner.js";
import { BUILTIN_TOOL_NAMES, getAgentConfig, getAllTypes, getAvailableTypes, registerAgents, resolveType } from "./agent-types.js";
import { loadCustomAgents } from "./custom-agents.js";
import { GroupJoinManager } from "./group-join.js";
import { resolveAgentInvocationConfig, resolveJoinMode } from "./invocation-config.js";
import { type ModelRegistry, resolveModel } from "./model-resolver.js";
import { createOutputFilePath, streamToOutputFile, writeInitialEntry } from "./output-file.js";
import { applyAndEmitLoaded, loadSettings, type SubagentsSettings, saveAndEmitProjectPatch } from "./settings.js";
import { getStatusNote } from "./status-note.js";
import { type AgentConfig, type AgentInvocation, type AgentRecord, type JoinMode, type NotificationDetails, type SubagentType, type WidgetMode } from "./types.js";
import {
  type AgentActivity,
  type AgentDetails,
  AgentWidget,
  buildInvocationTags,
  describeActivity,
  fgPreservingNestedStyles,
  formatDuration,
  formatMs,
  formatTokens,
  formatTurns,
  getDisplayName,
  getPromptModeLabel,
  SPINNER,
  type Theme,
  type UICtx,
} from "./ui/agent-widget.js";
import { FleetList, type FleetUICtx } from "./ui/fleet-list.js";
import { addUsage, getLifetimeTotal, getSessionContextPercent, type LifetimeUsage } from "./usage.js";

// ---- Shared helpers ----

/** Tool execute return value for a text response. */
function textResult(msg: string, details?: AgentDetails) {
  return { content: [{ type: "text" as const, text: msg }], details: details as any };
}

export function renderRunningAgentStatus(
  frame: string,
  statsText: string,
  activity: string,
  theme: Pick<Theme, "fg">,
): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("accent", frame) + (statsText ? " " + statsText : ""), 0, 0));
  container.addChild(new Text(theme.fg("dim", `  ⎿  ${activity}`), 0, 0));
  return container;
}

/** Format an agent's lifetime token total, or "" when zero. */
function formatLifetimeTokens(o: { lifetimeUsage: LifetimeUsage }): string {
  const t = getLifetimeTotal(o.lifetimeUsage);
  return t > 0 ? formatTokens(t) : "";
}

/**
 * Create an AgentActivity state and spawn callbacks for tracking tool usage.
 * Used by both foreground and background paths to avoid duplication.
 */
function createActivityTracker(maxTurns?: number, onStreamUpdate?: () => void) {
  const state: AgentActivity = {
    activeTools: new Map(),
    toolUses: 0,
    turnCount: 1,
    maxTurns,
    responseText: "",
    session: undefined,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
  };

  const callbacks = {
    onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
      if (activity.type === "start") {
        state.activeTools.set(activity.toolName + "_" + Date.now(), activity.toolName);
      } else {
        for (const [key, name] of state.activeTools) {
          if (name === activity.toolName) { state.activeTools.delete(key); break; }
        }
        state.toolUses++;
      }
      onStreamUpdate?.();
    },
    onTextDelta: (_delta: string, fullText: string) => {
      state.responseText = fullText;
      onStreamUpdate?.();
    },
    onTurnEnd: (turnCount: number) => {
      state.turnCount = turnCount;
      onStreamUpdate?.();
    },
    onSessionCreated: (session: any) => {
      state.session = session;
    },
    onAssistantUsage: (usage: { input: number; output: number; cacheWrite: number }) => {
      addUsage(state.lifetimeUsage, usage);
      onStreamUpdate?.();
    },
  };

  return { state, callbacks };
}

/**
 * Advertised thinking levels, ordered to mirror pi-ai's EXTENDED_THINKING_LEVELS
 * (`off` + every `ThinkingLevel`). Single source for the subagent tool description
 * and the `/agents` UI so these lists cannot
 * drift behind pi again (#147). Availability of any level still depends on the
 * host pi version and the selected model — pi clamps unsupported levels down.
 */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Salvaged partial output of a failed run, as a labeled suffix for the error
 * surfaces (or "" if the run produced nothing). `record.result` is bounded to
 * the run's own turns, so this is never a stale earlier answer (#144).
 */
function partialOutputSuffix(record: AgentRecord): string {
  const partial = record.result?.trim();
  return partial ? `\n\nPartial output before the failure:\n${partial}` : "";
}

/** Human-readable status label for agent completion. */
function getStatusLabel(status: string, error?: string): string {
  switch (status) {
    case "error": return `Error: ${error ?? "unknown"}`;
    case "aborted": return "Aborted (max turns exceeded)";
    case "steered": return "Wrapped up (turn limit)";
    case "stopped": return "Stopped";
    default: return "Done";
  }
}

/** Escape XML special characters to prevent injection in structured notifications. */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a structured task notification matching Claude Code's <task-notification> XML. */
function formatTaskNotification(record: AgentRecord, resultMaxLen: number): string {
  const status = getStatusLabel(record.status, record.error);
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : 0;
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);
  const contextPercent = getSessionContextPercent(record.session);
  const ctxXml = contextPercent !== null ? `<context_percent>${Math.round(contextPercent)}</context_percent>` : "";
  const compactXml = record.compactionCount ? `<compactions>${record.compactionCount}</compactions>` : "";

  const resultPreview = record.result
    ? record.result.length > resultMaxLen
      ? record.result.slice(0, resultMaxLen) + "\n...(truncated, use get_subagent_result for full output)"
      : record.result
    : "No output.";

  return [
    `<task-notification>`,
    `<task-id>${record.id}</task-id>`,
    record.toolCallId ? `<tool-use-id>${escapeXml(record.toolCallId)}</tool-use-id>` : null,
    record.outputFile ? `<output-file>${escapeXml(record.outputFile)}</output-file>` : null,
    `<status>${escapeXml(status)}</status>`,
    `<summary>Agent "${escapeXml(record.description)}" ${record.status}${getStatusNote(record.status)}</summary>`,
    `<result>${escapeXml(resultPreview)}</result>`,
    `<usage><total_tokens>${totalTokens}</total_tokens><tool_uses>${record.toolUses}</tool_uses>${ctxXml}${compactXml}<duration_ms>${durationMs}</duration_ms></usage>`,
    `</task-notification>`,
  ].filter(Boolean).join('\n');
}

/** Build AgentDetails from a base + record-specific fields. */
function buildDetails(
  base: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">,
  record: { toolUses: number; startedAt: number; completedAt?: number; status: string; error?: string; id?: string; session?: any; lifetimeUsage: LifetimeUsage },
  activity?: AgentActivity,
  overrides?: Partial<AgentDetails>,
): AgentDetails {
  return {
    ...base,
    toolUses: record.toolUses,
    tokens: formatLifetimeTokens(record),
    turnCount: activity?.turnCount,
    maxTurns: activity?.maxTurns,
    durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    status: record.status as AgentDetails["status"],
    agentId: record.id,
    error: record.error,
    ...overrides,
  };
}

/** Build notification details for the custom message renderer. */
function buildNotificationDetails(record: AgentRecord, resultMaxLen: number, activity?: AgentActivity): NotificationDetails {
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);

  return {
    id: record.id,
    description: record.description,
    status: record.status,
    toolUses: record.toolUses,
    turnCount: activity?.turnCount ?? 0,
    maxTurns: activity?.maxTurns,
    totalTokens,
    durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
    outputFile: record.outputFile,
    error: record.error,
    resultPreview: record.result
      ? record.result.length > resultMaxLen
        ? record.result.slice(0, resultMaxLen) + "…"
        : record.result
      : "No output.",
  };
}

export default function (pi: ExtensionAPI) {
  // ---- Register custom notification renderer ----
  pi.registerMessageRenderer<NotificationDetails>(
    "subagent-notification",
    (message, { expanded }, theme) => {
      const d = message.details;
      if (!d) return undefined;

      function renderOne(d: NotificationDetails): string {
        const isError = d.status === "error" || d.status === "stopped" || d.status === "aborted";
        const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const statusText = isError ? d.status
          : d.status === "steered" ? "completed (steered)"
          : "completed";

        // Line 1: icon + agent description + status
        let line = `${icon} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

        // Line 2: stats
        const parts: string[] = [];
        if (d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
        if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
        if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
        if (d.durationMs > 0) parts.push(formatMs(d.durationMs));
        if (parts.length) {
          line += "\n  " + parts.map(p => theme.fg("dim", p)).join(" " + theme.fg("dim", "·") + " ");
        }

        // Line 3: result preview (collapsed) or full (expanded)
        if (expanded) {
          const lines = d.resultPreview.split("\n").slice(0, 30);
          for (const l of lines) line += "\n" + theme.fg("dim", `  ${l}`);
        } else {
          const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
          line += "\n  " + theme.fg("dim", `⎿  ${preview}`);
        }

        // Line 4: output file link (if present)
        if (d.outputFile) {
          line += "\n  " + theme.fg("muted", `transcript: ${d.outputFile}`);
        }

        return line;
      }

      const all = [d, ...(d.others ?? [])];
      return new Text(all.map(renderOne).join("\n"), 0, 0);
    }
  );

  /** Reload agents from project/global custom agent dirs and merge with defaults (called on init and each Agent invocation). */
  const reloadCustomAgents = () => {
    const userAgents = loadCustomAgents(process.cwd(), loadSettings(process.cwd()).agents ?? {});
    registerAgents(userAgents);
  };

  // Initial load
  reloadCustomAgents();

  // ---- Agent activity tracking + widget ----
  const agentActivity = new Map<string, AgentActivity>();

  // ---- Cancellable pending notifications ----
  // Holds notifications briefly so get_subagent_result can cancel them
  // before they reach pi.sendMessage (fire-and-forget).
  const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();
  const NUDGE_HOLD_MS = 200;

  function scheduleNudge(key: string, send: () => void, delay = NUDGE_HOLD_MS) {
    cancelNudge(key);
    pendingNudges.set(key, setTimeout(() => {
      pendingNudges.delete(key);
      try { send(); } catch { /* ignore stale completion side-effect errors */ }
    }, delay));
  }

  function cancelNudge(key: string) {
    const timer = pendingNudges.get(key);
    if (timer != null) {
      clearTimeout(timer);
      pendingNudges.delete(key);
    }
  }

  // ---- Individual nudge helper (async join mode) ----
  function emitIndividualNudge(record: AgentRecord) {
    if (record.resultConsumed) return;  // re-check at send time

    const notification = formatTaskNotification(record, 500);
    const footer = record.outputFile ? `\nFull transcript available at: ${record.outputFile}` : '';

    pi.sendMessage<NotificationDetails>({
      customType: "subagent-notification",
      content: notification + footer,
      display: true,
      details: buildNotificationDetails(record, 500, agentActivity.get(record.id)),
    }, { deliverAs: "followUp", triggerTurn: true });
  }

  function sendIndividualNudge(record: AgentRecord) {
    agentActivity.delete(record.id);
    widget.markFinished(record.id);
    fleet.onAgentFinished(record.id);
    scheduleNudge(record.id, () => emitIndividualNudge(record));
    widget.update();
  }

  // ---- Group join manager ----
  const groupJoin = new GroupJoinManager(
    (records, partial) => {
      for (const r of records) { agentActivity.delete(r.id); widget.markFinished(r.id); fleet.onAgentFinished(r.id); }

      const groupKey = `group:${records.map(r => r.id).join(",")}`;
      scheduleNudge(groupKey, () => {
        // Re-check at send time
        const unconsumed = records.filter(r => !r.resultConsumed);
        if (unconsumed.length === 0) { widget.update(); return; }

        const notifications = unconsumed.map(r => formatTaskNotification(r, 300)).join('\n\n');
        const label = partial
          ? `${unconsumed.length} agent(s) finished (partial — others still running)`
          : `${unconsumed.length} agent(s) finished`;

        const [first, ...rest] = unconsumed;
        const details = buildNotificationDetails(first, 300, agentActivity.get(first.id));
        if (rest.length > 0) {
          details.others = rest.map(r => buildNotificationDetails(r, 300, agentActivity.get(r.id)));
        }

        pi.sendMessage<NotificationDetails>({
          customType: "subagent-notification",
          content: `Background agent group completed: ${label}\n\n${notifications}\n\nUse get_subagent_result for full output.`,
          display: true,
          details,
        }, { deliverAs: "followUp", triggerTurn: true });
      });
      widget.update();
    },
    30_000,
  );

  /** Helper: build event data for lifecycle events from an AgentRecord. */
  function buildEventData(record: AgentRecord) {
    const durationMs = record.completedAt ? record.completedAt - record.startedAt : Date.now() - record.startedAt;
    // All three fields are lifetime-accumulated (Σ over every assistant message_end),
    // so they survive compaction together — input + output ≤ total always.
    // tokens is omitted when nothing was ever produced (e.g. agent errored before
    // any message_end fired), preserving prior payload shape.
    const u = record.lifetimeUsage;
    const total = getLifetimeTotal(u);
    const tokens = total > 0
      ? { input: u.input, output: u.output, total }
      : undefined;
    return {
      id: record.id,
      type: record.type,
      description: record.description,
      result: record.result,
      error: record.error,
      status: record.status,
      toolUses: record.toolUses,
      durationMs,
      tokens,
    };
  }

  // Background completion: route through group join or send individual nudge.
  // The guard prevents child completions from touching a stale extension context
  // after session replacement or shutdown.
  let runtimeActive = true;
  const manager = new AgentManager((record) => {
    if (!runtimeActive || manager.getRecord(record.id) !== record) return;

    const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
    const eventData = buildEventData(record);
    if (isError) {
      pi.events.emit("subagents:failed", eventData);
    } else {
      pi.events.emit("subagents:completed", eventData);
    }

    if (record.resultConsumed) {
      agentActivity.delete(record.id);
      widget.markFinished(record.id);
      fleet.onAgentFinished(record.id);
      widget.update();
      return;
    }

    if (currentBatchAgents.some(a => a.id === record.id)) {
      widget.update();
      return;
    }

    const result = groupJoin.onAgentComplete(record);
    if (result === "pass") sendIndividualNudge(record);
    widget.update();
  }, undefined, (record) => {
    if (!runtimeActive || manager.getRecord(record.id) !== record) return;
    pi.events.emit("subagents:started", {
      id: record.id,
      type: record.type,
      description: record.description,
    });
  }, (record, info) => {
    if (!runtimeActive || manager.getRecord(record.id) !== record) return;
    pi.events.emit("subagents:compacted", {
      id: record.id,
      type: record.type,
      description: record.description,
      reason: info.reason,
      tokensBefore: info.tokensBefore,
      compactionCount: record.compactionCount,
    });
  });

  // Minimal host lifecycle bridge. It exists solely so print/headless hosts can
  // keep background children alive and perform teardown; it is not a spawn RPC.
  const MANAGER_KEY = Symbol.for("pi-subagents:manager");
  const managerHandle = {
    waitForAll: () => manager.waitForAll(),
    hasRunning: () => manager.hasRunning(),
    getRecord: (id: string) => manager.getRecord(id),
    abort: (id: string) => manager.abort(id),
    abortAll: () => manager.abortAll(),
  };
  const ownsManagerHandle = (globalThis as Record<symbol, unknown>)[MANAGER_KEY] === undefined;
  if (ownsManagerHandle) (globalThis as Record<symbol, unknown>)[MANAGER_KEY] = managerHandle;

  pi.on("session_start", () => {
    runtimeActive = true;
    manager.clearCompleted(true);
  });

  pi.on("session_before_switch", () => {
    runtimeActive = false;
    manager.reset();
    for (const timer of pendingNudges.values()) clearTimeout(timer);
    pendingNudges.clear();
    if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
    batchFinalizeTimer = undefined;
    currentBatchAgents = [];
    groupJoin.dispose();
    agentActivity.clear();
    widget.dispose();
    fleet.dispose();
  });

  pi.on("session_shutdown", async () => {
    runtimeActive = false;
    manager.abortAll();
    for (const timer of pendingNudges.values()) clearTimeout(timer);
    pendingNudges.clear();
    if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
    batchFinalizeTimer = undefined;
    currentBatchAgents = [];
    groupJoin.dispose();
    agentActivity.clear();
    widget.dispose();
    fleet.dispose();
    manager.dispose();
    if (ownsManagerHandle && (globalThis as Record<symbol, unknown>)[MANAGER_KEY] === managerHandle) {
      delete (globalThis as Record<symbol, unknown>)[MANAGER_KEY];
    }
  });

  // Live widget: show running agents above editor.
  // widgetMode (default "background") selects what the widget shows: "all" =
  // every agent; "background" = hide foreground (they already render inline as
  // the subagent tool result, so showing them here too is a duplicate), keep
  // everything else; "off" = hide the widget entirely. Read live at render time.
  let widgetMode: WidgetMode = "background";
  function getWidgetMode(): WidgetMode { return widgetMode; }
  const widget = new AgentWidget(manager, agentActivity, getWidgetMode);
  function setWidgetMode(m: WidgetMode): void { widgetMode = m; widget.update(); }

  // Claude Code-style FleetView: navigable list of main + subagents below the editor.
  const fleet = new FleetList(manager, agentActivity);
  let fleetViewEnabled = true;
  function isFleetViewEnabled(): boolean { return fleetViewEnabled; }
  function setFleetViewEnabled(b: boolean): void { fleetViewEnabled = b; fleet.setEnabled(b); }

  // Project/global default for writing the subagent .output transcript. A custom
  // agent JSON profile overrides this per spawn; legacy `output_transcript`
  // frontmatter remains accepted. Read live at spawn time.
  let outputTranscriptDefault = true;
  function getOutputTranscriptDefault(): boolean { return outputTranscriptDefault; }
  function setOutputTranscript(b: boolean): void { outputTranscriptDefault = b; }

  // ---- Join mode configuration ----
  let defaultJoinMode: JoinMode = 'smart';
  function getDefaultJoinMode(): JoinMode { return defaultJoinMode; }
  function setDefaultJoinMode(mode: JoinMode) { defaultJoinMode = mode; }

  // ---- Batch tracking for smart join mode ----
  // Collects background agent IDs spawned in the current turn for smart grouping.
  // Uses a debounced timer: each new agent resets the 100ms window so that all
  // parallel tool calls (which may be dispatched across multiple microtasks by the
  // framework) are captured in the same batch.
  let currentBatchAgents: { id: string; joinMode: JoinMode }[] = [];
  let batchFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
  let batchCounter = 0;

  /** Finalize the current batch: if 2+ smart-mode agents, register as a group. */
  function finalizeBatch() {
    batchFinalizeTimer = undefined;
    const batchAgents = [...currentBatchAgents];
    currentBatchAgents = [];

    const smartAgents = batchAgents.filter(a => a.joinMode === 'smart' || a.joinMode === 'group');
    if (smartAgents.length >= 2) {
      const groupId = `batch-${++batchCounter}`;
      const ids = smartAgents.map(a => a.id);
      groupJoin.registerGroup(groupId, ids);
      // Retroactively process agents that already completed during the debounce window.
      // Their onComplete fired but was deferred (agent was in currentBatchAgents),
      // so we feed them into the group now.
      for (const id of ids) {
        const record = manager.getRecord(id);
        if (!record) continue;
        record.groupId = groupId;
        if (record.completedAt != null && !record.resultConsumed) {
          groupJoin.onAgentComplete(record);
        }
      }
    } else {
      // No group formed — send individual nudges for any agents that completed
      // during the debounce window and had their notification deferred.
      for (const { id } of batchAgents) {
        const record = manager.getRecord(id);
        if (record?.completedAt != null && !record.resultConsumed) {
          sendIndividualNudge(record);
        }
      }
    }
  }

  // Grab UI context from first tool execution + clear lingering widget on new turn
  pi.on("tool_execution_start", async (_event, ctx) => {
    widget.setUICtx(ctx.ui as UICtx);
    fleet.setUICtx(ctx.ui as unknown as FleetUICtx);
    widget.onTurnStart();
  });

  /** Format an agent's tool scope: "*" when it has all built-ins, else a comma-separated list. */
  const formatToolsSuffix = (cfg: AgentConfig | undefined): string => {
    const tools = cfg?.builtinToolNames;
    if (tools === undefined) return "*";
    if (tools.length === 0) return "none";
    const isFullSet =
      tools.length === BUILTIN_TOOL_NAMES.length
      && BUILTIN_TOOL_NAMES.every((t) => tools.includes(t));
    return isFullSet ? "*" : tools.join(", ");
  };

  /** Build the full type list text dynamically from available agents only. */
  const buildTypeListText = () => {
    const available = getAvailableTypes();

    return available.map((name) => {
      const cfg = getAgentConfig(name);
      const modelSuffix = cfg?.model ? ` (${getModelLabelFromConfig(cfg.model)})` : "";
      const toolsSuffix = ` (Tools: ${formatToolsSuffix(cfg)})`;
      return `- ${name}: ${cfg?.description ?? name}${modelSuffix}${toolsSuffix}`;
    }).join("\n");
  };

  /** Derive a short model label from a model string. */
  function getModelLabelFromConfig(model: string): string {
    // Strip provider prefix (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
    const name = model.includes("/") ? model.split("/").pop()! : model;
    // Strip trailing date suffix (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5")
    return name.replace(/-\d{8}$/, "");
  }

  applyAndEmitLoaded(
    {
      setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
      setDefaultMaxTurns,
      setGraceTurns,
      setDefaultJoinMode,
      setFleetView: setFleetViewEnabled,
      setWidgetMode,
      setOutputTranscript,
    },
    (event, payload) => pi.events.emit(event, payload),
  );
  reloadCustomAgents();

  const subagentToolDescription = `Launch a child agent for complex, multi-step work.

Available agent types:
${buildTypeListText()}

Profiles are configured in ~/.pi/agent/subagents.json and .pi/subagents.json. Prompt Markdown is discovered from .pi/agents, .agents/agents, and the global agents directory.

Use foreground execution when you need the result before continuing. Use run_in_background for independent work; completion notifications and get_subagent_result provide results. Prompts should be self-contained unless inherit_context is enabled. Use resume with a current-session agent ID, and steer_subagent to redirect a running agent. Verify child-agent changes before reporting completion.`;

  pi.registerTool(defineTool({
    name: SUBAGENT_TOOL_NAMES.AGENT,
    label: "Subagent",
    description: subagentToolDescription,
    promptSnippet: "Launch a child agent for complex multi-step tasks",
    promptGuidelines: [
      "Use subagent with specialized agents when the task matches an agent type's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but should not be used excessively when not needed. Importantly, avoid duplicating work that subagents are already doing — if you delegate research to a subagent, do not also perform the same searches yourself.",
      "For broad codebase exploration or research, spawn subagent with an appropriate subagent_type (e.g. Explore). Otherwise use direct tools (read, grep, find) when the target is already known.",
      "When an agent runs in the background, you will be notified on completion — do not poll or sleep waiting for it. Continue with other work instead.",
      "Trust but verify: an agent's summary describes intent, not outcome. When an agent writes or edits code, check the actual changes before reporting work as done.",
    ],
    parameters: Type.Object({
      prompt: Type.String({
        description: "The task for the agent to perform.",
      }),
      description: Type.String({
        description: "A short (3-5 word) description of the task (shown in UI).",
      }),
      subagent_type: Type.String({
        description: `The type of specialized agent to use. Available types: ${getAvailableTypes().join(", ")}. Custom agents from .pi/agents/*.md (project) or ${getAgentDir()}/agents/*.md (global) are also available.`,
      }),
      model: Type.Optional(
        Type.String({
          description:
            'Optional model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Omit to use the agent type\'s default.',
        }),
      ),
      thinking: Type.Optional(
        Type.String({
          description: `Thinking level: ${THINKING_LEVELS.join(", ")}. Overrides agent default.`,
        }),
      ),
      max_turns: Type.Optional(
        Type.Number({
          description: "Maximum number of agentic turns before stopping. Omit for unlimited (default).",
          minimum: 1,
        }),
      ),
      run_in_background: Type.Optional(
        Type.Boolean({
          description: "Set to true to run in background. Returns agent ID immediately. You will be notified on completion.",
        }),
      ),
      resume: Type.Optional(
        Type.String({
          description: "Optional agent ID to resume from. Continues from previous context.",
        }),
      ),
      isolated: Type.Optional(
        Type.Boolean({
          description: "If true, agent gets no extension/MCP tools — only built-in tools.",
        }),
      ),
      inherit_context: Type.Optional(
        Type.Boolean({
          description: "If true, fork parent conversation into the agent. Default: false (fresh context).",
        }),
      ),
    }),

    // ---- Custom rendering: Claude Code style ----

    renderCall(args, theme) {
      const displayName = args.subagent_type ? getDisplayName(args.subagent_type) : "Agent";
      const desc = args.description ?? "";
      return new Text("▸ " + theme.fg("toolTitle", theme.bold(displayName)) + (desc ? "  " + theme.fg("muted", desc) : ""), 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as AgentDetails | undefined;
      if (!details) {
        const text = result.content[0]?.type === "text" ? result.content[0].text : "";
        return new Text(text, 0, 0);
      }

      // Helper: build "haiku · thinking: high · ↻5≤30 · 3 tool uses · 33.8k tokens" stats string
      const stats = (d: AgentDetails) => {
        const parts: string[] = [];
        if (d.modelName) parts.push(d.modelName);
        if (d.tags) parts.push(...d.tags);
        if (d.turnCount != null && d.turnCount > 0) {
          parts.push(formatTurns(d.turnCount, d.maxTurns));
        }
        if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
        if (d.tokens) parts.push(d.tokens);
        return parts.map(p => fgPreservingNestedStyles(theme, "dim", p)).join(" " + theme.fg("dim", "·") + " ");
      };

      // ---- While running (streaming) ----
      if (isPartial || details.status === "running") {
        const frame = SPINNER[details.spinnerFrame ?? 0];
        const s = stats(details);
        return renderRunningAgentStatus(frame, s, details.activity ?? "thinking…", theme);
      }

      // ---- Background agent launched ----
      if (details.status === "background") {
        return new Text(theme.fg("dim", `  ⎿  Running in background (ID: ${details.agentId})`), 0, 0);
      }

      // ---- Completed / Steered ----
      if (details.status === "completed" || details.status === "steered") {
        const duration = formatMs(details.durationMs);
        const isSteered = details.status === "steered";
        const icon = isSteered ? theme.fg("warning", "✓") : theme.fg("success", "✓");
        const s = stats(details);
        let line = icon + (s ? " " + s : "");
        line += " " + theme.fg("dim", "·") + " " + theme.fg("dim", duration);

        if (expanded) {
          const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
          if (resultText) {
            const lines = resultText.split("\n").slice(0, 50);
            for (const l of lines) {
              line += "\n" + theme.fg("dim", `  ${l}`);
            }
            if (resultText.split("\n").length > 50) {
              line += "\n" + theme.fg("muted", "  ... (use get_subagent_result with verbose for full output)");
            }
          }
        } else {
          const doneText = isSteered ? "Wrapped up (turn limit)" : "Done";
          line += "\n" + theme.fg("dim", `  ⎿  ${doneText}`);
        }
        return new Text(line, 0, 0);
      }

      // ---- Stopped (user-initiated abort) ----
      if (details.status === "stopped") {
        const s = stats(details);
        let line = theme.fg("dim", "■") + (s ? " " + s : "");
        line += "\n" + theme.fg("dim", "  ⎿  Stopped");
        return new Text(line, 0, 0);
      }

      // ---- Error / Aborted (hard max_turns) ----
      const s = stats(details);
      let line = theme.fg("error", "✗") + (s ? " " + s : "");

      if (details.status === "error") {
        line += "\n" + theme.fg("error", `  ⎿  Error: ${details.error ?? "unknown"}`);
      } else {
        line += "\n" + theme.fg("warning", "  ⎿  Aborted (max turns exceeded)");
      }

      return new Text(line, 0, 0);
    },

    // ---- Execute ----

    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // Ensure we have UI context for widget rendering
      widget.setUICtx(ctx.ui as UICtx);

      // Reload custom agents so new project/global .md files are picked up without restart
      reloadCustomAgents();

      const rawType = params.subagent_type as SubagentType;
      const requestedConfig = getAgentConfig(rawType);
      if (requestedConfig?.enabled === false) {
        return textResult(`Agent type "${requestedConfig.name}" is disabled.`);
      }
      const resolved = resolveType(rawType);
      const fellBack = resolved === undefined;
      if (fellBack && getAgentConfig("general-purpose")?.enabled === false) {
        return textResult(`Unknown agent type "${rawType}" cannot fall back because "general-purpose" is disabled.`);
      }
      const subagentType = resolved ?? "general-purpose";

      const displayName = getDisplayName(subagentType);

      // Get agent config (if any)
      const customConfig = getAgentConfig(subagentType);

      const resolvedConfig = resolveAgentInvocationConfig(customConfig, params);

      // Resolve model from agent config first; tool-call params only fill gaps.
      let model = ctx.model;
      if (resolvedConfig.modelInput) {
        const resolved = resolveModel(resolvedConfig.modelInput, ctx.modelRegistry);
        if (typeof resolved === "string") {
          if (resolvedConfig.modelFromParams) return textResult(resolved);
          // config-specified: silent fallback to parent
        } else {
          model = resolved;
        }
      }

      const thinking = resolvedConfig.thinking;
      const inheritContext = resolvedConfig.inheritContext;
      const runInBackground = resolvedConfig.runInBackground;
      const isolated = resolvedConfig.isolated;
      // Whether this spawn writes its .output transcript. The per-agent JSON
      // profile wins; otherwise the project/global default applies. Legacy
      // `output_transcript` frontmatter remains accepted. `attachTranscript` is the sole gate — every
      // downstream consumer keys off record.outputFile being set, so no spawn
      // path can re-enable the transcript by accident.
      const outputTranscript = customConfig?.outputTranscript ?? getOutputTranscriptDefault();
      const attachTranscript = (rec: AgentRecord | undefined, agentId: string): void => {
        if (!rec || !outputTranscript) return;
        rec.outputFile = createOutputFilePath(ctx.cwd, agentId, ctx.sessionManager.getSessionId());
        writeInitialEntry(rec.outputFile, agentId, params.prompt, ctx.cwd);
      };

      const parentModelId = ctx.model?.id;
      const effectiveModelId = model?.id;
      const modelName = effectiveModelId && effectiveModelId !== parentModelId
        ? (model?.name ?? effectiveModelId).replace(/^Claude\s+/i, "").toLowerCase()
        : undefined;
      const effectiveMaxTurns = normalizeMaxTurns(resolvedConfig.maxTurns ?? getDefaultMaxTurns());
      const agentInvocation: AgentInvocation = {
        modelName,
        thinking,
        // Explicit value only — the default fallback would just add noise.
        // Normalize so `0` (unlimited) doesn't surface as a misleading "max turns: 0".
        maxTurns: normalizeMaxTurns(resolvedConfig.maxTurns),
        isolated,
        inheritContext,
        runInBackground,
      };
      // Tool-result render shows the mode label too; viewer's header already does.
      const modeLabel = getPromptModeLabel(subagentType);
      const { tags: invocationTags } = buildInvocationTags(agentInvocation);
      const agentTags = modeLabel ? [modeLabel, ...invocationTags] : invocationTags;
      const detailBase = {
        displayName,
        description: params.description,
        subagentType,
        modelName,
        tags: agentTags.length > 0 ? agentTags : undefined,
      };

      // Resume existing agent
      if (params.resume) {
        const existing = manager.getRecord(params.resume);
        if (!existing) {
          return textResult(`Agent not found: "${params.resume}". It may have been cleaned up.`);
        }
        if (!existing.session) {
          return textResult(`Agent "${params.resume}" has no active session to resume.`);
        }
        const record = await manager.resume(params.resume, params.prompt, signal);
        if (!record) {
          return textResult(`Failed to resume agent "${params.resume}".`);
        }
        // A failed resume surfaces the error, plus any partial output THIS
        // resume produced (never the previous turn's answer, #144).
        if (record.status === "error") {
          return textResult(`Agent failed: ${record.error}${partialOutputSuffix(record)}`, buildDetails(detailBase, record));
        }
        return textResult(
          record.result?.trim() || "No output.",
          buildDetails(detailBase, record),
        );
      }

      // Background execution
      if (runInBackground) {
        const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(effectiveMaxTurns);

        // Wrap onSessionCreated to wire output file streaming.
        // The callback lazily reads record.outputFile (set right after spawn)
        // rather than closing over a value that doesn't exist yet.
        let id: string;
        const origBgOnSession = bgCallbacks.onSessionCreated;
        bgCallbacks.onSessionCreated = (session: any) => {
          origBgOnSession(session);
          const rec = manager.getRecord(id);
          if (rec?.outputFile) {
            rec.outputCleanup = streamToOutputFile(session, rec.outputFile, id, ctx.cwd);
          }
        };

        try {
          id = manager.spawn(pi, ctx, subagentType, params.prompt, {
            description: params.description,
            model,
            maxTurns: effectiveMaxTurns,
            isolated,
            inheritContext,
            thinkingLevel: thinking,
            isBackground: true,
                invocation: agentInvocation,
            ...bgCallbacks,
          });
        } catch (err) {
          return textResult(err instanceof Error ? err.message : String(err));
        }

        // Set output file + join mode synchronously after spawn, before the
        // event loop yields — onSessionCreated is async so this is safe.
        const joinMode = resolveJoinMode(defaultJoinMode, true);
        const record = manager.getRecord(id);
        if (record && joinMode) {
          record.joinMode = joinMode;
          record.toolCallId = toolCallId;
          attachTranscript(record, id);
        }

        if (joinMode == null || joinMode === 'async') {
          // Foreground/no join mode or explicit async — not part of any batch
        } else {
          // smart or group — add to current batch
          currentBatchAgents.push({ id, joinMode });
          // Debounce: reset timer on each new agent so parallel tool calls
          // dispatched across multiple event loop ticks are captured together
          if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
          batchFinalizeTimer = setTimeout(finalizeBatch, 100);
        }

        agentActivity.set(id, bgState);
        widget.ensureTimer();
        widget.update();
        fleet.ensureTimer();
        fleet.update();

        // Emit created event
        pi.events.emit("subagents:created", {
          id,
          type: subagentType,
          description: params.description,
          isBackground: true,
        });

        const isQueued = record?.status === "queued";
        return textResult(
          `Agent ${isQueued ? "queued" : "started"} in background.\n` +
          `Agent ID: ${id}\n` +
          `Type: ${displayName}\n` +
          `Description: ${params.description}\n` +
          (record?.outputFile ? `Output file: ${record.outputFile}\n` : "") +
          (isQueued ? `Position: queued (max ${manager.getMaxConcurrent()} concurrent)\n` : "") +
          `\nYou will be notified when this agent completes.\n` +
          `Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n` +
          `Do not duplicate this agent's work.`,
          { ...detailBase, toolUses: 0, tokens: "", durationMs: 0, status: "background" as const, agentId: id },
        );
      }

      // Foreground (synchronous) execution — stream progress via onUpdate
      let spinnerFrame = 0;
      const startedAt = Date.now();
      let fgId: string | undefined;

      const streamUpdate = () => {
        const details: AgentDetails = {
          ...detailBase,
          toolUses: fgState.toolUses,
          tokens: formatLifetimeTokens(fgState),
          turnCount: fgState.turnCount,
          maxTurns: fgState.maxTurns,
          durationMs: Date.now() - startedAt,
          status: "running",
          activity: describeActivity(fgState.activeTools, fgState.responseText),
          spinnerFrame: spinnerFrame % SPINNER.length,
        };
        onUpdate?.({
          content: [{ type: "text", text: `${fgState.toolUses} tool uses...` }],
          details: details as any,
        });
      };

      const { state: fgState, callbacks: fgCallbacks } = createActivityTracker(effectiveMaxTurns, streamUpdate);

      // Wire session creation: register in widget + stream to output file.
      // The output file path is set synchronously after spawn (below),
      // before onSessionCreated fires — same pattern as background agents.
      const origOnSession = fgCallbacks.onSessionCreated;
      fgCallbacks.onSessionCreated = (session: any) => {
        origOnSession(session);
        for (const a of manager.listAgents()) {
          if (a.session === session) {
            fgId = a.id;
            agentActivity.set(a.id, fgState);
            widget.ensureTimer();
            fleet.ensureTimer();
            fleet.update();
            break;
          }
        }
        // Stream conversation to output file (foreground agent logging)
        if (fgId) {
          const rec = manager.getRecord(fgId);
          if (rec?.outputFile) {
            rec.outputCleanup = streamToOutputFile(session, rec.outputFile, fgId, ctx.cwd);
          }
        }
      };

      // Animate spinner at ~80ms (smooth rotation through 10 braille frames)
      const spinnerInterval = setInterval(() => {
        spinnerFrame++;
        streamUpdate();
      }, 80);

      streamUpdate();

      let record: AgentRecord;
      try {
        const fgResult = await manager.spawnAndWait(pi, ctx, subagentType, params.prompt, {
          description: params.description,
          model,
          maxTurns: effectiveMaxTurns,
          isolated,
          inheritContext,
          thinkingLevel: thinking,
            invocation: agentInvocation,
          signal,
          ...fgCallbacks,
        }, (fgAgentId) => {
          // onSpawned: called synchronously after spawn, before onSessionCreated fires.
          // Set up the output file so streamToOutputFile can pick it up.
          const fgRec = manager.getRecord(fgAgentId);
          attachTranscript(fgRec, fgAgentId);
        });
        record = fgResult.record;
      } catch (err) {
        clearInterval(spinnerInterval);
        return textResult(err instanceof Error ? err.message : String(err));
      }

      clearInterval(spinnerInterval);

      // Clean up foreground agent from widget
      if (fgId) {
        agentActivity.delete(fgId);
        widget.markFinished(fgId);
        fleet.onAgentFinished(fgId);
      }

      // Get final token count
      const tokenText = formatLifetimeTokens(fgState);

      const details = buildDetails(detailBase, record, fgState, { tokens: tokenText });

      // "general-purpose" may itself be unregistered (defaults disabled, no
      // user override) — getConfig then uses the hardcoded fallback config.
      const fallbackNote = fellBack
        ? `Note: Unknown agent type "${rawType}" — using ${resolveType("general-purpose") ? "general-purpose" : "the fallback agent config"}.\n\n`
        : "";

      if (record.status === "error") {
        // Error headline + any partial output the run produced before failing.
        return textResult(`${fallbackNote}Agent failed: ${record.error}${partialOutputSuffix(record)}`, details);
      }

      const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
      const statsParts = [`${record.toolUses} tool uses`];
      if (tokenText) statsParts.push(tokenText);
      return textResult(
        `${fallbackNote}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${getStatusNote(record.status)}.\n\n` +
        (record.result?.trim() || "No output."),
        details,
      );
    },
  }));

  // ---- get_subagent_result tool ----

  pi.registerTool(defineTool({
    name: SUBAGENT_TOOL_NAMES.GET_RESULT,
    label: "Get Agent Result",
    description:
      "Check status and retrieve results from a background agent. Use the agent ID returned by subagent with run_in_background.",
    promptSnippet: "Check status and retrieve results from a background agent",
    parameters: Type.Object({
      agent_id: Type.String({
        description: "The agent ID to check.",
      }),
      wait: Type.Optional(
        Type.Boolean({
          description: "If true, wait for the agent to complete before returning. Default: false.",
        }),
      ),
      verbose: Type.Optional(
        Type.Boolean({
          description: "If true, include the agent's full conversation (messages + tool calls). Default: false.",
        }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const record = manager.getRecord(params.agent_id);
      if (!record) {
        return textResult(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);
      }

      // Wait for completion if requested.
      // Pre-mark resultConsumed BEFORE awaiting: onComplete fires inside .then()
      // (attached earlier at spawn time) and always runs before this await resumes.
      // Setting the flag here prevents a redundant follow-up notification.
      // Queued agents have no promise yet (it's created when the queue starts
      // them), so poll until they leave the queue, then await like a running one.
      if (params.wait && (record.status === "running" || record.status === "queued")) {
        record.resultConsumed = true;
        cancelNudge(params.agent_id);
        while (record.status === "queued") {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (record.promise) await record.promise;
      }

      const displayName = getDisplayName(record.type);
      const duration = formatDuration(record.startedAt, record.completedAt);
      const tokens = formatLifetimeTokens(record);
      const contextPercent = getSessionContextPercent(record.session);
      const statsParts = [`Tool uses: ${record.toolUses}`];
      if (tokens) statsParts.push(tokens);
      if (contextPercent !== null) statsParts.push(`Context: ${Math.round(contextPercent)}%`);
      if (record.compactionCount) statsParts.push(`Compactions: ${record.compactionCount}`);
      statsParts.push(`Duration: ${duration}`);

      let output =
        `Agent: ${record.id}\n` +
        `Type: ${displayName} | Status: ${record.status}${getStatusNote(record.status)} | ${statsParts.join(" | ")}\n` +
        `Description: ${record.description}\n\n`;

      if (record.status === "running") {
        output += "Agent is still running. Use wait: true or check back later.";
      } else if (record.status === "error") {
        output += `Error: ${record.error}${partialOutputSuffix(record)}`;
      } else {
        output += record.result?.trim() || "No output.";
      }

      // Mark result as consumed — suppresses the completion notification
      if (record.status !== "running" && record.status !== "queued") {
        record.resultConsumed = true;
        cancelNudge(params.agent_id);
      }

      // Verbose: include full conversation
      if (params.verbose && record.session) {
        const conversation = getAgentConversation(record.session);
        if (conversation) {
          output += `\n\n--- Agent Conversation ---\n${conversation}`;
        }
      }

      return textResult(output);
    },
  }));

  // ---- steer_subagent tool ----

  pi.registerTool(defineTool({
    name: SUBAGENT_TOOL_NAMES.STEER,
    label: "Steer Agent",
    description:
      "Send a steering message to a running agent. The message will interrupt the agent after its current tool execution " +
      "and be injected into its conversation, allowing you to redirect its work mid-run. Only works on running agents.",
    promptSnippet: "Send a steering message to redirect a running background agent",
    parameters: Type.Object({
      agent_id: Type.String({
        description: "The agent ID to steer (must be currently running).",
      }),
      message: Type.String({
        description: "The steering message to send. This will appear as a user message in the agent's conversation.",
      }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const record = manager.getRecord(params.agent_id);
      if (!record) {
        return textResult(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);
      }
      if (record.status !== "running") {
        return textResult(`Agent "${params.agent_id}" is not running (status: ${record.status}). Cannot steer a non-running agent.`);
      }
      if (!record.session) {
        // Session not ready yet — queue the steer for delivery once initialized
        if (!record.pendingSteers) record.pendingSteers = [];
        record.pendingSteers.push(params.message);
        pi.events.emit("subagents:steered", { id: record.id, message: params.message });
        return textResult(`Steering message queued for agent ${record.id}. It will be delivered once the session initializes.`);
      }

      try {
        await steerAgent(record.session, params.message);
        pi.events.emit("subagents:steered", { id: record.id, message: params.message });
        const tokens = formatLifetimeTokens(record);
        const contextPercent = getSessionContextPercent(record.session);
        const stateParts: string[] = [];
        if (tokens) stateParts.push(tokens);
        stateParts.push(`${record.toolUses} tool ${record.toolUses === 1 ? "use" : "uses"}`);
        if (contextPercent !== null) stateParts.push(`context ${Math.round(contextPercent)}% full`);
        if (record.compactionCount) stateParts.push(`${record.compactionCount} compaction${record.compactionCount === 1 ? "" : "s"}`);
        return textResult(
          `Steering message sent to agent ${record.id}. The agent will process it after its current tool execution.\n` +
          `Current state: ${stateParts.join(" · ")}`,
        );
      } catch (err) {
        return textResult(`Failed to steer agent: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  }));

  // ---- /agents interactive menu ----

  function getModelLabel(type: string, registry?: ModelRegistry): string {
    const cfg = getAgentConfig(type);
    if (!cfg?.model) return "inherit"; // no model configured → really inherits parent
    const label = getModelLabelFromConfig(cfg.model);
    if (!registry) return label;
    const resolved = resolveModel(cfg.model, registry);
    // Configured but unresolvable: the runtime silently falls back to the parent
    // model, so flag it (and the fallback) rather than hiding the config.
    if (typeof resolved === "string") return `${label} (unavailable, fallback: inherit)`;
    // Surface what it actually resolved to when that differs from the config —
    // e.g. a provider fallback or a looser version pin. Cosmetic separator/date
    // differences are normalized away so an effectively-identical match stays quiet.
    const resolvedFull = `${resolved.provider}/${resolved.id}`;
    const norm = (s: string) => s.toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "");
    if (norm(cfg.model) === norm(resolvedFull)) return label;
    return `${label} (→ ${resolvedFull.replace(/-\d{8}$/, "")})`;
  }

  async function showAgentsMenu(ctx: ExtensionCommandContext) {
    reloadCustomAgents();
    const allNames = getAllTypes();

    // Build select options
    const options: string[] = [];

    // Running agents entry (only if there are active agents)
    const agents = manager.listAgents();
    if (agents.length > 0) {
      const running = agents.filter(a => a.status === "running" || a.status === "queued").length;
      const done = agents.filter(a => a.status === "completed" || a.status === "steered").length;
      options.push(`Running agents (${agents.length}) — ${running} running, ${done} done`);
    }

    // Agent types list
    if (allNames.length > 0) {
      options.push(`Agent types (${allNames.length})`);
    }

    options.push("Settings");

    const noAgentsMsg = allNames.length === 0 && agents.length === 0
      ? "No agents found. Create specialized subagents that can be delegated to.\n\n" +
        "Each subagent has its own context window, custom system prompt, and specific tools.\n\n" +
        "Try creating: Code Reviewer, Security Auditor, Test Writer, or Documentation Writer.\n\n"
      : "";

    if (noAgentsMsg) {
      ctx.ui.notify(noAgentsMsg, "info");
    }

    const choice = await ctx.ui.select("Agents", options);
    if (!choice) return;

    if (choice.startsWith("Running agents (")) {
      await showRunningAgents(ctx);
      await showAgentsMenu(ctx);
    } else if (choice.startsWith("Agent types (")) {
      await showAllAgentsList(ctx);
      await showAgentsMenu(ctx);
    } else if (choice === "Settings") {
      await showSettings(ctx);
      await showAgentsMenu(ctx);
    }
  }

  async function showAllAgentsList(ctx: ExtensionCommandContext) {
    const allNames = getAllTypes();
    if (allNames.length === 0) {
      ctx.ui.notify("No agents.", "info");
      return;
    }

    // Source indicators: defaults unmarked, custom agents get • (project) or ◦ (global)
    // Disabled agents get ✕ prefix
    const sourceIndicator = (cfg: AgentConfig | undefined) => {
      const disabled = cfg?.enabled === false;
      if (cfg?.source === "project") return disabled ? "✕• " : "•  ";
      if (cfg?.source === "global") return disabled ? "✕◦ " : "◦  ";
      if (disabled) return "✕  ";
      return "   ";
    };

    // One row per agent (name in the left column, model on the right); the
    // full description renders below the highlighted row via SettingsList,
    // exactly like the Settings menu — so long descriptions never wrap the list.
    const items: SettingItem[] = allNames.map(name => {
      const cfg = getAgentConfig(name);
      const disabled = cfg?.enabled === false;
      const model = getModelLabel(name, ctx.modelRegistry);
      return {
        id: name,
        label: `${sourceIndicator(cfg)}${name}`,
        currentValue: model,
        description: disabled ? "(disabled)" : (cfg?.description ?? name),
        // Single-value list so Enter "activates" the row (fires onChange with the
        // agent's id) without offering anything to actually cycle.
        values: [model],
      };
    });

    const hasCustom = allNames.some(n => { const c = getAgentConfig(n); return c && !c.isDefault && c.enabled !== false; });
    const hasDisabled = allNames.some(n => getAgentConfig(n)?.enabled === false);
    const legendParts: string[] = [];
    if (hasCustom) legendParts.push("• = project  ◦ = global");
    if (hasDisabled) legendParts.push("✕ = disabled");

    const selected = await ctx.ui.custom<string | undefined>((_tui, _theme, _kb, done) => {
      const slTheme = getSettingsListTheme();
      const list = new SettingsList(
        items,
        Math.min(items.length, 12),
        slTheme,
        id => done(id), // Enter/Space on a row → return that agent's name
        () => done(undefined), // Esc → cancel
      );
      const container = new Container();
      container.addChild(new Text("Agent types", 0, 0));
      if (legendParts.length) container.addChild(new Text(slTheme.hint(legendParts.join("  ")), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);
      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => list.handleInput?.(data),
      };
    });

    if (selected && getAgentConfig(selected)) {
      await showAgentDetail(ctx, selected);
      await showAllAgentsList(ctx);
    }
  }

  async function showRunningAgents(ctx: ExtensionCommandContext) {
    const agents = manager.listAgents();
    if (agents.length === 0) {
      ctx.ui.notify("No agents.", "info");
      return;
    }

    const options = agents.map(a => {
      const dn = getDisplayName(a.type);
      const dur = formatDuration(a.startedAt, a.completedAt);
      return `${dn} (${a.description}) · ${a.toolUses} tools · ${a.status} · ${dur}`;
    });

    const choice = await ctx.ui.select("Running agents", options);
    if (!choice) return;

    // Find the selected agent by matching the option index
    const idx = options.indexOf(choice);
    if (idx < 0) return;
    const record = agents[idx];

    await viewAgentConversation(ctx, record);
    // Back-navigation: re-show the list
    await showRunningAgents(ctx);
  }

  async function viewAgentConversation(ctx: ExtensionCommandContext, record: AgentRecord) {
    if (!record.session) {
      ctx.ui.notify(`Agent is ${record.status === "queued" ? "queued" : "expired"} — no session available.`, "info");
      return;
    }

    const { ConversationViewer, VIEWPORT_HEIGHT_PCT } = await import("./ui/conversation-viewer.js");
    const session = record.session;
    const activity = agentActivity.get(record.id);

    await ctx.ui.custom<undefined>(
      (tui, theme, keybindings, done) => {
        return new ConversationViewer(tui, session, record, activity, theme, done, () => {
          if (manager.abort(record.id)) {
            ctx.ui.notify(`Stopped "${record.description}".`, "info");
          }
        }, keybindings, (message: string) => manager.steer(record.id, message));
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "90%", maxHeight: `${VIEWPORT_HEIGHT_PCT}%` },
      },
    );
  }

  async function showAgentDetail(ctx: ExtensionCommandContext, name: string) {
    const cfg = getAgentConfig(name);
    if (!cfg) return;
    const tools = cfg.builtinToolNames?.join(", ") ?? "all";
    const extensions = cfg.extensions === true ? "all" : cfg.extensions === false ? "none" : cfg.extensions.join(", ");
    await ctx.ui.select(name, [
      `status: ${cfg.enabled === false ? "disabled" : "enabled"}`,
      `source: ${cfg.source ?? "default"}`,
      `model: ${getModelLabel(name, ctx.modelRegistry)}`,
      `tools: ${tools}`,
      `extensions: ${extensions}`,
      `prompt mode: ${cfg.promptMode}`,
      "Back",
    ]);
  }

  const NUMERIC_IDS = new Set(["maxConcurrent", "defaultMaxTurns", "graceTurns"]);

  async function showSettings(ctx: ExtensionCommandContext) {
    function buildItems(): SettingItem[] {
      const mc = manager.getMaxConcurrent();
      const dmt = getDefaultMaxTurns() ?? 0;
      const gt = getGraceTurns();

      return [
        {
          id: "maxConcurrent",
          label: "Max concurrency",
          description: "Max concurrent background agents (Enter to type)",
          currentValue: String(mc),
          values: [String(mc)],
        },
        {
          id: "defaultMaxTurns",
          label: "Default max turns",
          description: "Default max turns before wrap-up (0 = unlimited, Enter to type)",
          currentValue: String(dmt),
          values: [String(dmt)],
        },
        {
          id: "graceTurns",
          label: "Grace turns",
          description: "Grace turns after wrap-up steer (Enter to type)",
          currentValue: String(gt),
          values: [String(gt)],
        },
        {
          id: "joinMode",
          label: "Join mode",
          description: "Default join mode for background agents",
          currentValue: getDefaultJoinMode(),
          values: ["smart", "async", "group"],
        },
        {
          id: "outputTranscript",
          label: "Output transcript",
          description: "Write each subagent's .output transcript by default. A per-agent JSON profile can override this.",
          currentValue: getOutputTranscriptDefault() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "fleetView",
          label: "Fleet view",
          description: "Claude Code-style main+subagents list below the editor (↓/← to navigate, Enter to view)",
          currentValue: isFleetViewEnabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "widgetMode",
          label: "Widget",
          description: "Above-editor agent widget: all = every agent; background = hide foreground (they already render inline); off = hide the widget.",
          currentValue: getWidgetMode(),
          values: ["all", "background", "off"],
        },
      ];
    }

    function applyValue(id: string, value: string) {
      if (id === "maxConcurrent") {
        const n = parseInt(value, 10);
        if (n >= 1) {
          manager.setMaxConcurrent(n);
          notifyApplied(ctx, `Max concurrency set to ${n}`, { maxConcurrent: n });
        }
      } else if (id === "defaultMaxTurns") {
        const n = parseInt(value, 10);
        if (n === 0) {
          setDefaultMaxTurns(undefined);
          notifyApplied(ctx, "Default max turns set to unlimited", { defaultMaxTurns: 0 });
        } else if (n >= 1) {
          setDefaultMaxTurns(n);
          notifyApplied(ctx, `Default max turns set to ${n}`, { defaultMaxTurns: n });
        }
      } else if (id === "graceTurns") {
        const n = parseInt(value, 10);
        if (n >= 1) {
          setGraceTurns(n);
          notifyApplied(ctx, `Grace turns set to ${n}`, { graceTurns: n });
        }
      } else if (id === "joinMode") {
        setDefaultJoinMode(value as JoinMode);
        notifyApplied(ctx, `Default join mode set to ${value}`, { defaultJoinMode: value as JoinMode });
      } else if (id === "outputTranscript") {
        const enabled = value === "on";
        setOutputTranscript(enabled);
        notifyApplied(ctx, `Output transcript ${enabled ? "enabled" : "disabled"} by default`, { outputTranscript: enabled });
      } else if (id === "fleetView") {
        const enabled = value === "on";
        setFleetViewEnabled(enabled);
        notifyApplied(ctx, `Fleet view ${enabled ? "enabled" : "disabled"}`, { fleetView: enabled });
      } else if (id === "widgetMode") {
        setWidgetMode(value as WidgetMode);
        notifyApplied(ctx, `Widget set to ${value}`, { widgetMode: value as WidgetMode });
      }
    }

    let list: SettingsList;
    // Track current selection index directly (SettingsList doesn't expose it).
    // Updated on arrow keys so Enter knows which field is selected immediately.
    let currentIndex = 0;

    const result = await ctx.ui.custom<string | undefined>((_tui, _theme, _kb, done) => {
      const items = buildItems();

      list = new SettingsList(
        items,
        items.length + 2,
        getSettingsListTheme(),
        (id, newValue) => {
          applyValue(id, newValue);
        },
        () => done(undefined as undefined),
      );

      const container = new Container();
      container.addChild(new Text("⚙  Subagent Settings", 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          // Track navigation so Enter knows the current field
          if (matchesKey(data, "up")) {
            currentIndex = Math.max(0, currentIndex - 1);
          } else if (matchesKey(data, "down")) {
            currentIndex = Math.min(items.length - 1, currentIndex + 1);
          }

          // Enter on numeric field → close and prompt for typed input
          if (matchesKey(data, Key.enter) && NUMERIC_IDS.has(items[currentIndex].id)) {
            done(items[currentIndex].id);
            return;
          }
          list.handleInput?.(data);
        },
      };
    });

    // If a numeric field ID was returned, prompt for typed input
    if (result && NUMERIC_IDS.has(result)) {
      const current = result === "maxConcurrent"
        ? String(manager.getMaxConcurrent())
        : result === "defaultMaxTurns"
          ? String(getDefaultMaxTurns() ?? 0)
          : String(getGraceTurns());

      const label = result === "maxConcurrent"
        ? "Max concurrency (1+)"
        : result === "defaultMaxTurns"
          ? "Default max turns (0 = unlimited)"
          : "Grace turns (1+)";

      // Loop until user enters a valid integer or cancels (Esc / null).
      // Silently trims whitespace; rejects non-numeric input by re-prompting.
      let input: string | undefined = await ctx.ui.input(label, current);
      while (input != null) {
        const trimmed = input.trim();
        const n = Number(trimmed);
        if (trimmed !== "" && Number.isInteger(n)) {
          applyValue(result, String(n));
          await showSettings(ctx);
          return;
        }
        // Invalid — re-prompt with the user's last entry so they can edit it
        input = await ctx.ui.input(label, trimmed);
      }
    }
  }

  // Persist only the explicit project override, emit `subagents:settings_changed`,
  // and surface the right toast. Global effective values are never copied into
  // project settings as accidental overrides.
  function notifyApplied(ctx: ExtensionCommandContext, successMsg: string, patch: SubagentsSettings) {
    const { message, level } = saveAndEmitProjectPatch(
      patch,
      successMsg,
      (event, payload) => pi.events.emit(event, payload),
      ctx.cwd,
    );
    ctx.ui.notify(message, level);
  }

  pi.registerCommand("agents", {
    description: "Manage agents",
    handler: async (_args, ctx) => { await showAgentsMenu(ctx); },
  });
}
