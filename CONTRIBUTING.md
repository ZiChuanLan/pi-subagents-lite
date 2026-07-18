# Contributing to @lan-local/pi-subagents-lite

This fork is intentionally narrow: preserve a strong child-agent execution and observability experience without reintroducing the removed scheduler, memory, skill-preload, worktree, RPC, or model-scope subsystems.

## Before changing code

- Read [FORK_NOTES.md](FORK_NOTES.md) and keep the retained/removed boundary intact.
- Discuss changes that alter package scope or configuration precedence first.
- Preserve the `subagent`, `get_subagent_result`, and `steer_subagent` tool contracts.
- Keep JSON runtime profiles separate from Markdown prompt bodies.
- Keep permission-system compatibility: `<active_agent>` identity and post-bind tool intersection.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run lint:fix` only for targeted formatting/lint fixes that you have reviewed. Update tests and README documentation for user-visible behavior.

## Pull requests

- Keep each change focused.
- Include a minimal reproduction for bugs.
- Explain changes to lifecycle, tool scoping, or settings persistence explicitly.
- Do not restore an intentionally removed subsystem as an incidental dependency.
- Preserve upstream attribution and the MIT license.
