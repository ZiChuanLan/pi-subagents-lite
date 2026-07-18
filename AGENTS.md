# Development Rules

## Scope

`@zichuanlan/pi-subagents-lite` is a balanced-lite fork. Keep execution and observability; do not casually restore removed subsystems.

Retained: foreground/background execution, queues, FleetView, live conversation viewer, steer/stop/resume, notifications, context inheritance, transcripts, custom agents, and observation events.

Removed: scheduler, persistent agent memory, dedicated skill preloading, worktree isolation, cross-extension spawn/stop RPC, and model-scope enforcement.

Read [FORK_NOTES.md](FORK_NOTES.md) before changing architecture or package scope.

## Configuration contract

- JSON (`subagents.json`) owns runtime policy: model, thinking, tools, extensions, defaults, enablement, and transcripts.
- Markdown (`agents/*.md`) owns prompt bodies.
- Project JSON overrides global JSON field-by-field per agent.
- Legacy Markdown frontmatter is migration-only; JSON wins.
- The primary tool name is `subagent`, not `Agent`.

## Safety contract

- Preserve `<active_agent name="..."/>` in child prompts.
- After extension binding, active tools must remain the intersection of the policy-selected set and the agent allowlist.
- The `Symbol.for("pi-subagents:manager")` bridge is lifecycle-only; do not add spawn/steer/RPC orchestration to it.
- Child agents are not sandboxed. Do not document tool scoping as an operating-system security boundary.

## Code quality

- Read files before editing and make the smallest correct change.
- Prefer explicit types; avoid new `any` unless required by Pi APIs or test doubles.
- Keep imports at module scope.
- Preserve the existing Biome style.
- Add or update focused tests for behavioral changes.
- Update README/FORK_NOTES for user-visible scope or configuration changes.

## Verification

After code changes, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Before packaging, also run:

```bash
npm pack --dry-run
```

Do not report completion while any required check fails.

## Git and release

- Do not commit, push, tag, publish, reset, clean, or stash unless the user explicitly asks.
- Preserve upstream MIT attribution.
- Public npm publishing requires a scope/package name controlled by the publisher.
