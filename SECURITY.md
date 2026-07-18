# Security Policy

`@lan-local/pi-subagents-lite` is a Pi extension that launches child agents inside the same local-user security boundary as the parent Pi process.

## Security model

- Child agents are not sandboxed.
- They can use the tools and extensions exposed by their profile and the active Pi permission policy.
- `isolated: true` removes extension/MCP and skill resources, but it is not an operating-system sandbox.
- Custom JSON profiles, Markdown prompts, Pi settings, extensions, and workspace files are trusted local configuration.
- Prompt injection from trusted local files or model output is not treated as a privilege-boundary bypass.

The package includes two defense-in-depth behaviors:

1. `<active_agent name="..."/>` identifies the child to permission extensions.
2. After extensions bind, active tools are intersected with the child profile's allowlist so policy-disabled tools are not re-enabled.

## In scope

- A reproducible bypass of the configured child tool allowlist or `disallowedTools`
- A lifecycle flaw that lets a shut-down child continue affecting a replacement session
- A package flaw that crosses an operating-system privilege boundary
- A reachable vulnerability in shipped runtime dependencies

## Out of scope

- Expected local execution with the user's privileges
- Malicious or user-modified local profiles, prompts, extensions, settings, or workspace files
- Prompt injection without a demonstrated security-boundary bypass
- Behavior of Pi, model providers, or other extensions
- Denial of service requiring trusted local configuration or intentionally unbounded agents

For a future public repository, report security issues privately through its security-advisory channel rather than a public issue.
