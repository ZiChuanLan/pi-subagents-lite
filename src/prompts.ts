/** System prompt builder for child agents. */

import type { AgentConfig, EnvInfo } from "./types.js";

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CHILD_CONTRACT = `<sub_agent_contract>
Single-level worker rules (non-negotiable):
- Complete only the assigned task; do not expand into a new product workflow.
- Never dispatch, resume, or steer other agents (no nested subagents).
- Never start/update/finish parent or Trellis task lifecycle.
- Do not create unsolicited report files or notes.
- Prefer tools over guessing; cite absolute paths for evidence.
- If blocked, stop and report the blocker with what you already found.
</sub_agent_contract>`;

export function buildAgentPrompt(
  config: AgentConfig,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
): string {
  const activeAgentTag = `<active_agent name="${escapeXmlAttribute(config.name)}"/>\n\n`;
  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  if (config.promptMode === "append") {
    // Append is an intentional parent-twin mode. Still inject the child contract
    // so nested-agent / workflow ownership never rides along silently.
    const identity = parentSystemPrompt || genericBase;
    const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;
    const custom = config.systemPrompt.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";
    return `${identity}\n\n${bridge}\n\n${CHILD_CONTRACT}\n\n${activeAgentTag}${envBlock}${custom}`;
  }

  const replaceHeader = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

${envBlock}`;
  return `${activeAgentTag}${replaceHeader}\n\n${config.systemPrompt}\n\n${CHILD_CONTRACT}`;
}

const genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;
