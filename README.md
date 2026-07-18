# @zichuanlan/pi-subagents-lite

A streamlined Pi subagent package focused on execution and observability.

This fork keeps the parts needed to launch and monitor child agents—foreground/background execution, queues, FleetView, live conversations, steering, stopping, resuming, notifications, context inheritance, and transcripts—while removing unrelated orchestration subsystems.

Forked from [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) v0.14.2. See [FORK_NOTES.md](FORK_NOTES.md) for the exact boundary.

## Scope

### Retained

- Foreground and background child agents
- Configurable background concurrency and queueing
- `subagent`, `get_subagent_result`, and `steer_subagent` tools
- `/agents` management UI
- Above-editor activity widget
- FleetView below the editor
- Live conversation viewer with inline steer and stop
- Session resume within the current Pi session
- Smart/group/async completion notifications
- Optional parent-context inheritance
- Per-agent output transcripts
- Custom agent types
- Lifecycle events for observation
- Minimal headless lifecycle bridge for waiting and shutdown

### Removed

- Scheduled/cron agents
- Persistent agent memory
- Dedicated skill preloading
- Git worktree isolation
- Cross-extension spawn/stop RPC
- Enabled-model/model-scope enforcement

The package does not provide a sandbox. Child agents run with the same local-user privileges as Pi and can use every tool granted by their profile and active permission policy.

## Install

Local development install:

```bash
pi install /home/lan/workspace/pi-subagents-lite
```

Pi records local package paths without copying them, so source edits are picked up after restarting or reloading Pi.

Pi 0.80.10 accepts a bare local path here; it does not accept npm-style `file:/home/...` package specs.

After publishing to an npm scope you control:

```bash
pi install npm:@zichuanlan/pi-subagents-lite
```

The repository can live anywhere, including a WSL path. Publishing depends on npm authentication and ownership of the package scope, not on the filesystem location.

## Tools

### `subagent`

```text
subagent({
  subagent_type: "Explore",
  prompt: "Find the authentication flow and report the critical files.",
  description: "Trace auth flow",
  run_in_background: true
})
```

Important parameters:

| Parameter | Meaning |
| --- | --- |
| `subagent_type` | Built-in or configured agent name |
| `prompt` | Self-contained task for the child |
| `description` | Short UI label |
| `model` | Optional `provider/modelId` or fuzzy model name |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |
| `max_turns` | Optional positive turn limit |
| `run_in_background` | Return an agent ID immediately |
| `inherit_context` | Fork the parent conversation into the child |
| `isolated` | Disable extensions, MCP tools, and skill resources for the run |
| `resume` | Continue an existing current-session child agent |

A value pinned in an agent JSON profile takes precedence over the same tool-call parameter. Tool-call parameters fill profile gaps.

### `get_subagent_result`

```text
get_subagent_result({
  agent_id: "<id>",
  wait: true,
  verbose: true
})
```

`verbose: true` includes the recorded child conversation when its session is still available.

### `steer_subagent`

```text
steer_subagent({
  agent_id: "<id>",
  message: "Stop exploring tests and focus on the production path."
})
```

The message is delivered after the child's current tool execution.

## UI

Run `/agents` to inspect configured agent types, open running/completed conversations, and change operational settings.

FleetView appears below the editor while agents are available:

- At an empty prompt, press `↓` or `←` to focus the fleet.
- Use `↑`/`↓` to select an agent.
- Press `Enter` to open its live conversation.
- In the conversation viewer, press `Enter` to compose a steer message.
- Press `x`, then `x` again, to stop a running agent.
- Press `Esc` to return.

The above-editor widget defaults to background agents only, avoiding duplicate foreground output. Set `widgetMode` to `all`, `background`, or `off`.

## Configuration model

Operational settings and agent runtime profiles use JSON. Markdown files contain prompt bodies.

### JSON locations

| Priority | Path | Purpose |
| --- | --- | --- |
| Higher | `<cwd>/.pi/subagents.json` | Project overrides |
| Lower | `~/.pi/agent/subagents.json` | Global defaults |

Top-level operational fields use project-over-global replacement. `agents` profiles merge field-by-field by agent name, with project fields winning.

Example:

```json
{
  "maxConcurrent": 4,
  "defaultMaxTurns": 0,
  "graceTurns": 3,
  "defaultJoinMode": "smart",
  "fleetView": true,
  "widgetMode": "background",
  "outputTranscript": true,
  "agents": {
    "reviewer": {
      "displayName": "Reviewer",
      "description": "Read-only implementation reviewer",
      "model": "sonnet",
      "thinking": "high",
      "maxTurns": 30,
      "tools": ["read", "grep", "find", "bash", "ext:mcp/search"],
      "extensions": ["mcp"],
      "excludeExtensions": ["pi-notify"],
      "disallowedTools": ["write", "edit"],
      "promptMode": "replace",
      "inheritContext": false,
      "runInBackground": true,
      "isolated": false,
      "outputTranscript": true,
      "enabled": true
    }
  }
}
```

### Operational fields

| Field | Accepted values | Default |
| --- | --- | --- |
| `maxConcurrent` | Integer `1..1024` | `4` |
| `defaultMaxTurns` | Integer `0..10000`; `0` means unlimited | Unlimited |
| `graceTurns` | Integer `1..1000` | Runtime default |
| `defaultJoinMode` | `async`, `group`, `smart` | `smart` |
| `fleetView` | Boolean | `true` |
| `widgetMode` | `all`, `background`, `off` | `background` |
| `outputTranscript` | Boolean | `true` |
| `agents` | Object keyed by agent name | `{}` |

### Agent profile fields

| Field | Type | Purpose |
| --- | --- | --- |
| `displayName` | String | UI label |
| `description` | String | Tool-description guidance |
| `model` | String | Model pin or fuzzy model name |
| `thinking` | String | Thinking level |
| `maxTurns` | Non-negative integer | Profile-level turn policy; `0` is unlimited |
| `tools` | `"all"`, `"none"`, or string array | Built-in and extension-tool allowlist |
| `extensions` | Boolean or string array | Which extensions load |
| `excludeExtensions` | String array | Extension denylist; exclusion wins |
| `disallowedTools` | String array | Final tool denylist |
| `promptMode` | `replace` or `append` | Standalone prompt or parent-prompt twin |
| `inheritContext` | Boolean | Default conversation inheritance |
| `runInBackground` | Boolean | Default execution mode |
| `isolated` | Boolean | Built-in tools only; no extensions/skills |
| `outputTranscript` | Boolean | Per-agent transcript override |
| `enabled` | Boolean | Show or disable the agent type |

#### Tool selectors

`tools` accepts built-in names such as `read`, `grep`, `find`, `bash`, `edit`, and `write`.

Extension tools use selectors:

- `ext:mcp` exposes all tools registered by the `mcp` extension.
- `ext:mcp/search` exposes only the `search` tool from `mcp`.
- `"*"` inside an array means all built-in tools.

Once any `ext:` selector is present, extension tools become opt-in: loaded extensions not named by a selector contribute no tools. `extensions` controls loading; `tools` controls what reaches the child model.

## Prompt Markdown

Prompt discovery order, highest first:

1. `<cwd>/.pi/agents/<name>.md`
2. `<cwd>/.agents/agents/<name>.md`
3. `~/.pi/agent/agents/<name>.md`
4. Embedded default prompt, when applicable

Example `.pi/agents/reviewer.md`:

```markdown
You are a read-only implementation reviewer.

Report correctness, security, lifecycle, and configuration findings in priority order.
Include exact file paths and line references. Do not edit files.
```

The filename is the agent name. A Markdown file can override an embedded prompt such as `Explore.md` or `Plan.md`.

Legacy YAML frontmatter from the upstream package is still parsed as a migration fallback, but new configuration should use `subagents.json`. When both are present, JSON profile fields win and the Markdown body remains the prompt.

## Built-in agents

| Type | Prompt mode | Default tools | Intended use |
| --- | --- | --- | --- |
| `general-purpose` | `append` | All built-ins | Parent-prompt twin for multi-step work |
| `Explore` | `replace` | Read-only set | Fast codebase discovery |
| `Plan` | `replace` | Read-only set | Architecture and implementation planning |

Create a JSON profile with the same name to override runtime fields. Create a Markdown file with the same name to override its prompt body. Set `enabled: false` in JSON to disable it.

## Permission compatibility

Each child prompt includes:

```xml
<active_agent name="reviewer"/>
```

Permission extensions can use that identity to apply agent-specific policies. After child extensions bind, this package re-applies only the intersection of:

1. the agent's configured allowlist, and
2. the tools that remain active after policy binding.

This prevents extension binding from re-enabling tools that a permission policy disabled.

## Observation events

The extension emits observation events on `pi.events`:

- `subagents:created`
- `subagents:started`
- `subagents:completed`
- `subagents:failed`
- `subagents:steered`
- `subagents:compacted`
- `subagents:settings_loaded`
- `subagents:settings_changed`

These events are informational. Cross-extension spawning and stopping are intentionally not provided.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The package entry remains `src/index.ts`; Pi loads TypeScript extensions directly.

## License and attribution

MIT licensed. Original implementation copyright remains with tintinweb. This fork preserves the upstream license and records its removals and compatibility changes in [FORK_NOTES.md](FORK_NOTES.md).
