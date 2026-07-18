/** Load prompt Markdown and merge it with JSON agent profiles. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "./agent-types.js";
import { DEFAULT_AGENTS } from "./default-agents.js";
import { loadSettings } from "./settings.js";
import type { AgentConfig, AgentProfile, AgentTools, ThinkingLevel } from "./types.js";

interface MarkdownAgent {
  name: string;
  body: string;
  legacy: Partial<AgentConfig>;
  source: "project" | "global";
}

export function loadCustomAgents(cwd: string, profiles = loadSettings(cwd).agents ?? {}): Map<string, AgentConfig> {
  const markdown = new Map<string, MarkdownAgent>();
  loadFromDir(join(getAgentDir(), "agents"), markdown, "global");
  loadFromDir(join(cwd, ".agents", "agents"), markdown, "project");
  loadFromDir(join(cwd, ".pi", "agents"), markdown, "project");

  const names = new Set([...markdown.keys(), ...Object.keys(profiles)]);
  const agents = new Map<string, AgentConfig>();
  for (const name of names) {
    const md = markdown.get(name);
    const profile = profiles[name];
    const embedded = DEFAULT_AGENTS.get(name);
    const base: AgentConfig = embedded
      ? { ...embedded }
      : {
          name,
          description: name,
          extensions: true,
          systemPrompt: "",
          promptMode: "replace",
          enabled: true,
        };

    const fromMarkdown: AgentConfig = {
      ...base,
      ...md?.legacy,
      name,
      systemPrompt: md?.body ?? base.systemPrompt,
      source: md?.source ?? (profile ? "json" : base.source),
    };
    agents.set(name, applyProfile(fromMarkdown, profile));
  }
  return agents;
}

function loadFromDir(
  dir: string,
  agents: Map<string, MarkdownAgent>,
  source: "project" | "global",
): void {
  if (!existsSync(dir)) return;
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".md"));
  } catch {
    return;
  }

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch {
      continue;
    }
    const name = basename(file, ".md");
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
    agents.set(name, {
      name,
      body: body.trim(),
      legacy: parseLegacyFrontmatter(frontmatter),
      source,
    });
  }
}

function applyProfile(config: AgentConfig, profile: AgentProfile | undefined): AgentConfig {
  if (!profile) return config;
  const next = { ...config };
  if (profile.displayName !== undefined) next.displayName = profile.displayName;
  if (profile.description !== undefined) next.description = profile.description;
  if (profile.model !== undefined) next.model = profile.model;
  if (profile.thinking !== undefined) next.thinking = profile.thinking;
  if (profile.maxTurns !== undefined) next.maxTurns = profile.maxTurns;
  if (profile.tools !== undefined) {
    const tools = partitionTools(profile.tools);
    next.builtinToolNames = tools.builtinToolNames;
    next.extSelectors = tools.extSelectors;
  }
  if (profile.enabled !== undefined) next.enabled = profile.enabled;
  if (profile.promptMode !== undefined) next.promptMode = profile.promptMode;
  if (profile.inheritContext !== undefined) next.inheritContext = profile.inheritContext;
  if (profile.runInBackground !== undefined) next.runInBackground = profile.runInBackground;
  if (profile.isolated !== undefined) next.isolated = profile.isolated;
  if (profile.extensions !== undefined) next.extensions = profile.extensions;
  if (profile.excludeExtensions !== undefined) next.excludeExtensions = profile.excludeExtensions;
  if (profile.disallowedTools !== undefined) next.disallowedTools = profile.disallowedTools;
  if (profile.outputTranscript !== undefined) next.outputTranscript = profile.outputTranscript;
  return next;
}

function partitionTools(tools: AgentTools): {
  builtinToolNames: string[] | undefined;
  extSelectors: string[] | undefined;
} {
  if (tools === "all") return { builtinToolNames: undefined, extSelectors: undefined };
  if (tools === "none") return { builtinToolNames: [], extSelectors: undefined };
  const wildcard = tools.some((item) => item === "*" || item.toLowerCase() === "all");
  const extSelectors = tools.filter((item) => item.startsWith("ext:"));
  const plain = tools.filter((item) => item !== "*" && item.toLowerCase() !== "all" && !item.startsWith("ext:"));
  return {
    builtinToolNames: wildcard ? [...new Set([...BUILTIN_TOOL_NAMES, ...plain])] : plain,
    extSelectors: extSelectors.length > 0 ? extSelectors : undefined,
  };
}

function parseLegacyFrontmatter(frontmatter: Record<string, unknown>): Partial<AgentConfig> {
  const config: Partial<AgentConfig> = {};
  const displayName = stringValue(frontmatter.display_name);
  const description = stringValue(frontmatter.description);
  const model = stringValue(frontmatter.model);
  const thinking = stringValue(frontmatter.thinking);
  const maxTurns = nonNegativeInt(frontmatter.max_turns);
  const tools = legacyTools(frontmatter.tools);
  const extensions = inheritField(frontmatter.extensions ?? frontmatter.inherit_extensions);
  const excludeExtensions = stringList(frontmatter.exclude_extensions);
  const disallowedTools = stringList(frontmatter.disallowed_tools);

  if (displayName !== undefined) config.displayName = displayName;
  if (description !== undefined) config.description = description;
  if (model !== undefined) config.model = model;
  if (thinking !== undefined) config.thinking = thinking as ThinkingLevel;
  if (maxTurns !== undefined) config.maxTurns = maxTurns;
  if (tools !== undefined) {
    config.builtinToolNames = tools.builtinToolNames;
    config.extSelectors = tools.extSelectors;
  }
  if (extensions !== undefined) config.extensions = extensions;
  if (excludeExtensions !== undefined) config.excludeExtensions = excludeExtensions;
  if (disallowedTools !== undefined) config.disallowedTools = disallowedTools;
  if (frontmatter.output_transcript != null) config.outputTranscript = frontmatter.output_transcript !== false;
  if (frontmatter.prompt_mode != null) config.promptMode = frontmatter.prompt_mode === "append" ? "append" : "replace";
  if (frontmatter.inherit_context != null) config.inheritContext = frontmatter.inherit_context === true;
  if (frontmatter.run_in_background != null) config.runInBackground = frontmatter.run_in_background === true;
  if (frontmatter.isolated != null) config.isolated = frontmatter.isolated === true;
  if (frontmatter.enabled != null) config.enabled = frontmatter.enabled !== false;
  return config;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonNegativeInt(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === "none") return undefined;
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function legacyTools(value: unknown): {
  builtinToolNames: string[] | undefined;
  extSelectors: string[] | undefined;
} | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim().toLowerCase() === "none") {
    return { builtinToolNames: [], extSelectors: undefined };
  }
  return partitionTools(stringList(value) ?? []);
}

function inheritField(value: unknown): true | string[] | false | undefined {
  if (value == null) return undefined;
  if (value === true) return true;
  if (value === false || value === "none") return false;
  return stringList(value) ?? false;
}
