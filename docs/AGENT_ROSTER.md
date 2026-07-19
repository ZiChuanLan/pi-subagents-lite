# Lite agent roster — merge rules and dispatch

This package stays **lite**: five defaults, single-level children, closed tool
allowlists. New agents are added only when the **tool boundary** differs, not
when the output template differs.

## Must split (different tools or write rights)

| Agent | Why it cannot merge |
| --- | --- |
| **Explore** | Local read-only only. No web tools. Fast cheap recon. |
| **Research** | Needs `pi-web-access` tools. Merging into Explore forces web on every search or blocks docs lookup. |
| **Plan** | Read-only design deliverable. Not the same success criteria as “find files” or “ship a diff”. |
| **Review** | Read-only judgment deliverable (findings). Not a plan and not an implementation. |
| **general-purpose** | Only role allowed to **write/edit/shell**. Merging write rights into Explore/Research/Plan/Review recreates the “everything is GP” failure mode. |

## Must merge (same tools; differ only by checklist)

| Tempting split | Merge into | How |
| --- | --- | --- |
| Security auditor | **Review** | Security checklist section in Review prompt |
| Plan reviewer (Metis/Momus-style) | **Plan** | Self-critique / gaps section at end of plan |
| Debugger | **general-purpose** | Debug phase rules in GP prompt (repro → minimal fix → evidence) |
| Verifier | **general-purpose** | Verify phase rules (run the right checks; do not expand scope) |
| Implement / worker / Hephaestus | **general-purpose** | Same write boundary; name stays `general-purpose` for API compatibility, display **Implement** |
| Scout / deep-explore | **Explore** | Breadth is a prompt parameter (quick / medium / thorough), not a new agent |
| Librarian-only vs Research | **Research** | One web+local read-only role; prompt prioritizes external docs/OSS when asked |

## Deliberately not in lite

| Heavy role | Why omitted |
| --- | --- |
| Nested orchestrator (Sisyphus-in-child) | Children hard-deny subagent tools |
| Team mode / agent-to-agent mail | Out of scope for lite |
| Category→model engines | Use per-agent `model` in JSON instead |
| Multimodal specialist | Parent session / dedicated extension, not a default child |

## Parent dispatch (only rules you need)

```text
Local files / symbols / “where is X”     → Explore
External docs / versions / APIs / URLs   → Research
Architecture / how should we build       → Plan
Audit quality / security / regressions   → Review
Must edit code or run shell/tests        → general-purpose
```

**Anti-patterns**

1. Defaulting every task to `general-purpose`.
2. Using Explore for npm/docs (use Research).
3. Using Research to implement (use general-purpose).
4. Using Plan or Review to apply patches.
5. Packing Trellis lifecycle / multi-agent orchestration into any child prompt.

## Config ownership

| Concern | Owner |
| --- | --- |
| Tools, extensions, model, maxTurns, isolated | `subagents.json` (global or project) |
| Persona, checklists, output shape | `agents/<Name>.md` (global or project) |
| Hard nested-tool denylist | Package runtime (`CHILD_HARD_DENIED_TOOLS`) — not configurable |

Project JSON overrides global JSON field-by-field. Markdown body overrides the
embedded system prompt when a file with the same agent name exists.
