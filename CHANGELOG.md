# Changelog

All notable changes to `@zichuanlan/pi-subagents-lite` are documented here.

## [0.2.0] - 2026-07-20

### Changed

- Children are single-level by hard policy: nested `subagent` tools, Trellis/goal lifecycle tools, `todo`, `advisor`, `memory`, and `skill_manage` never surface to child sessions.
- Explicit `tools: [...]` profiles are closed allowlists — unselected extension tools no longer auto-surface merely because extensions load.
- `tools: none` is a closed empty allowlist (no built-ins and no extension tools without `ext:`).
- Embedded defaults no longer inherit the parent system prompt (`promptMode: replace`), default to `isolated` + bounded `maxTurns`, and Explore/Plan/Review exclude shell.
- Soft turn-limit steer asks for immediate evidence-only wrap-up; default grace turns reduced from 5 to 1.
- Added embedded `Review` agent for evidence-first read-only review.
- Added embedded `Research` agent: local read-only tools plus `pi-web-access` (`web_search` / `fetch_content` / `get_search_content`) so web lookup does not force `general-purpose`.
- Locked a **5-agent lite roster** with explicit merge rules (`docs/AGENT_ROSTER.md`): security→Review, debug/verify→general-purpose, no OMO-scale cast.
- `general-purpose` display name **Implement**; descriptions and prompts refuse pure search/review/docs work.
- Documented full config pairing: `subagents.json` (policy) + `agents/*.md` (prompt bodies).

### Fixed

- Read-only profiles could previously inherit orchestration tools (e.g. Trellis/todo) when extensions loaded without `ext:` selectors.

## [0.1.0] - 2026-07-19

### Added

- Fork package identity and local Pi package manifest.
- JSON agent profiles in global `~/.pi/agent/subagents.json` and project `.pi/subagents.json`, with field-level project overrides.
- Markdown prompt-body discovery from global agents, `.agents/agents`, and `.pi/agents`.
- `subagent` tool naming and permission-policy identity through `<active_agent name="..."/>`.
- Minimal `Symbol.for("pi-subagents:manager")` lifecycle bridge for headless wait and shutdown handling.

### Changed

- Runtime policy now lives in JSON while Markdown contains prompt bodies; legacy frontmatter remains a migration fallback and JSON wins.
- Tool activation after extension binding is restricted to the intersection of the policy-selected active tools and the agent allowlist.
- Package documentation now describes the balanced-lite scope, local install flow, configuration schema, and upstream attribution.

### Fixed

- Disabled agent types are rejected explicitly instead of falling back to a broader general-purpose configuration.
- Resumed runs now use a fresh abort controller and tracked promise, so stop, parent abort, and `waitForAll()` work correctly.
- Session switches reset old child records, timers, queues, and UI state; late completions cannot inject results into the replacement session.
- Agent names are XML-escaped in `<active_agent>` permission identity tags.
- Settings UI writes only explicit project overrides and no longer copies effective global values into project JSON.
- Zero-tool profiles display as `none` instead of `*` in the advertised type list.

### Removed

- Scheduler and durable schedule store.
- Persistent agent memory.
- Dedicated skill-preload injection.
- Git worktree isolation.
- Cross-extension spawn/stop RPC.
- Enabled-model/model-scope enforcement.
- Related menus, dependencies, fixtures, and tests.

### Retained

- Foreground/background execution, concurrency queues, FleetView, live conversation viewer, steer/stop/resume, notifications, context inheritance, transcripts, custom agents, and lifecycle observation events.

## Upstream history

This fork started from [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) v0.14.2. Consult the upstream repository for history before the fork.
