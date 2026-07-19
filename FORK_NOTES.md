# Fork Notes

## Origin

`@zichuanlan/pi-subagents-lite` is a streamlined fork of [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents), based on upstream v0.14.2.

The fork was created to keep tintinweb's strong subagent observability—FleetView, the live conversation viewer, steering, stopping, resuming, and rich status rendering—without carrying unrelated scheduling, persistence, worktree, and RPC subsystems.

## Package identity

- Repository directory: `/home/lan/workspace/pi-subagents-lite`
- Default branch: `main`
- Package name: `@zichuanlan/pi-subagents-lite`
- Initial fork version: `0.1.0`
- Pi extension entry: `src/index.ts`
- Primary tool name: `subagent`

The public npm package uses the `@zichuanlan` user scope. The repository's WSL path does not prevent publishing.

## Retained architecture

- Agent type registry and embedded defaults
- Foreground/background execution
- Background concurrency limit and queue
- Turn limits with graceful wrap-up
- Session resume
- Mid-run steering
- Parent-context inheritance
- Extension loading and tool scoping
- Per-agent output transcript
- Completion notifications and group join modes
- Above-editor widget
- FleetView and live conversation overlay
- `/agents` management/settings UI
- Read-only lifecycle observation events

## Removed architecture

The following upstream modules and their tests were removed:

- `memory.ts`
- `skill-loader.ts`
- `worktree.ts`
- `schedule.ts`
- `schedule-store.ts`
- `enabled-models.ts`
- `cross-extension-rpc.ts`
- `ui/schedule-menu.ts`

Related configuration fields, tool schema entries, menus, persistence stores, dependencies, and test fixtures were removed as well.

## Configuration redesign

The fork separates runtime policy from prompts:

- JSON controls model, thinking, tools, extension scope, execution defaults, enablement, and transcript behavior.
- Markdown controls the system-prompt body.

Locations:

- Global JSON: `~/.pi/agent/subagents.json`
- Project JSON: `<cwd>/.pi/subagents.json`
- Global prompts: `~/.pi/agent/agents/*.md`
- Project prompts: `<cwd>/.pi/agents/*.md` and `<cwd>/.agents/agents/*.md`

Project JSON overrides global JSON. Agent profiles merge field-by-field. Legacy Markdown frontmatter remains readable for migration, but JSON fields win.

## Compatibility and safety patches

This fork includes two compatibility behaviors inspired by the gotgenes fork line:

1. Child prompts contain an `<active_agent name="..."/>` identity tag for permission-system policy matching.
2. After child extensions bind, active tools are reduced to the intersection of the post-policy active set and the agent allowlist. The package never restores the full allowlist after policy binding.
3. Disabled agent profiles are non-runnable, agent identity attributes are XML-escaped, and session switches discard old child runtimes before activating a replacement session.

### Single-level efficiency policy (this fork)

Children are hard-limited to single-level work:

1. Nested delegation tools and parent workflow tools are hard-denied and cannot be re-enabled by profile configuration.
2. Explicit `tools: [...]` profiles are closed allowlists; unselected extension tools do not auto-surface when extensions load.
3. Embedded defaults use `promptMode: replace`, prefer `isolated`, bound `maxTurns`, and keep Explore/Plan/Review without shell/write tools.
4. Soft turn-limit steering demands immediate evidence-only wrap-up with a 1-turn grace default.
5. Role split: `Explore` is local-only; `Research` adds `pi-web-access` web tools; `general-purpose` is reserved for mutation/shell so pure lookup does not force a full agent.

The package also retains a minimal `Symbol.for("pi-subagents:manager")` bridge for Pi's print/headless lifecycle. It exposes only:

- `waitForAll`
- `hasRunning`
- `getRecord`
- `abort`
- `abortAll`

It does not expose spawn, resume, steer, schedules, memory, or an event-bus RPC protocol.

## Intentional non-goals

- No scheduler or durable job store
- No agent-owned persistent memory
- No named skill-preload injection
- No filesystem worktree isolation
- No cross-extension orchestration API
- No model allowlist enforcement
- No sandbox or privilege boundary

Pi and its child agents run with the local user's permissions. Tool and extension profiles reduce the model-visible capability set but do not create an operating-system sandbox.

## Verification baseline

The fork should not be considered release-ready unless all of the following pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

A local Pi package smoke test should then load the package from its absolute directory path in an isolated `PI_CODING_AGENT_DIR` before changing the user's normal Pi settings.
