# Changelog

All notable changes to `@lan-local/pi-subagents-lite` are documented here.

## [Unreleased]

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
