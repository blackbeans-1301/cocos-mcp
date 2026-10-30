/**
 * Coding-agent config writer — the pure part (no filesystem).
 *
 * The extension can register itself into the MCP config of the most common AI
 * coding agents so a user does not have to hand-edit JSON. Everything here is
 * string in / string out so it can be tested without touching a real home dir.
 *
 * Safety rules, to keep this from wrecking a user's config:
 * - **Merge, never replace.** Other servers in the file are preserved.
 * - **Refuse invalid JSON** rather than "fixing" it.
 * - Only ever touch our own `ccreator-mcp` entry.
 */

export const SERVER_NAME = 'ccreator-mcp'
export const SERVER_TITLE = 'ccreator-mcp'

export type ConfigKind = 'mcpServers' | 'vscode' | 'opencode' | 'toml'

export interface AgentSpec {
  id: string
  name: string
  kind: ConfigKind
  /** Where the entry is written (relative to `home` or the project root). */
  file: string
  scope: 'home' | 'project'
  /** Paths whose existence means the agent is installed (same scopes). */
  detect: Array<{ scope: 'home' | 'project'; path: string }>
  /** Where the agent reads `SKILL.md` skills (each skill is a subfolder). Taken from the agent's own docs. */
  skills?: { scope: 'home' | 'project'; dir: string }
  docs: string
}

export const AGENTS: AgentSpec[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'mcpServers',
    scope: 'home',
    file: '.cursor/mcp.json',
    detect: [{ scope: 'home', path: '.cursor' }],
    skills: { scope: 'home', dir: '.cursor/skills' },
    docs: 'https://docs.cursor.com/context/model-context-protocol',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    kind: 'mcpServers',
    scope: 'home',
    file: '.claude.json',
    detect: [
      { scope: 'home', path: '.claude.json' },
      { scope: 'home', path: '.claude' },
    ],
    skills: { scope: 'home', dir: '.claude/skills' },
    docs: 'https://docs.claude.com/en/docs/claude-code/mcp',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'mcpServers',
    scope: 'home',
    file: '.codeium/windsurf/mcp_config.json',
    detect: [{ scope: 'home', path: '.codeium/windsurf' }],
    skills: { scope: 'home', dir: '.codeium/windsurf/skills' },
    docs: 'https://docs.windsurf.com/windsurf/cascade/mcp',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    kind: 'opencode',
    scope: 'home',
    file: '.config/opencode/opencode.json',
    detect: [{ scope: 'home', path: '.config/opencode' }],
    skills: { scope: 'home', dir: '.config/opencode/skills' },
    docs: 'https://opencode.ai/docs/mcp-servers/',
  },
  {
    id: 'vscode',
    name: 'VS Code (workspace)',
    kind: 'vscode',
    scope: 'project',
    file: '.vscode/mcp.json',
    detect: [{ scope: 'project', path: '.vscode' }],
    skills: { scope: 'project', dir: '.github/skills' },
    docs: 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    kind: 'toml',
    scope: 'home',
    file: '.codex/config.toml',
    detect: [{ scope: 'home', path: '.codex' }],
    skills: { scope: 'home', dir: '.agents/skills' },
    docs: 'https://github.com/openai/codex',
  },
]

const TOML_HEADER = `[mcp_servers.${SERVER_NAME}]`

const parseObject = (text: string): Record<string, unknown> => {
  if (text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Refusing to touch this file: it is not valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Refusing to touch this file: it is not a JSON object.')
  }
  return parsed as Record<string, unknown>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const entryFor = (kind: ConfigKind, url: string): unknown => {
  switch (kind) {
    case 'vscode':
      return { type: 'http', url }
    case 'opencode':
      return { type: 'remote', url, enabled: true }
    default:
      return { type: 'http', url }
  }
}

/** Bucket key that holds servers, per agent config format. */
const bucketKey = (kind: ConfigKind): string => {
  switch (kind) {
    case 'vscode':
      return 'servers'
    case 'opencode':
      return 'mcp'
    default:
      return 'mcpServers'
  }
}

/** Strip our TOML block (header line + its key/value lines until the next header). */
const stripTomlBlock = (text: string): string => {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    const isHeader = line.trim().startsWith('[') && line.trim().endsWith(']')
    if (isHeader) skipping = line.trim() === TOML_HEADER
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/** Add (or update) our entry; returns the new file text. Throws on invalid input. */
export const upsertServer = (text: string, kind: ConfigKind, url: string): string => {
  if (kind === 'toml') {
    const base = stripTomlBlock(text)
    return `${base ? `${base}\n\n` : ''}${TOML_HEADER}\nurl = "${url}"\n`
  }
  const root = parseObject(text)
  const bucket = asRecord(root[bucketKey(kind)])
  bucket[SERVER_NAME] = entryFor(kind, url)
  root[bucketKey(kind)] = bucket
  return `${JSON.stringify(root, null, 2)}\n`
}

/** Remove our entry; returns the new file text (unchanged if it was not there). */
export const removeServer = (text: string, kind: ConfigKind): string => {
  if (kind === 'toml') {
    const stripped = `${stripTomlBlock(text)}\n`
    return stripped === `${text.trimEnd()}\n` ? text : stripped
  }
  const root = parseObject(text)
  const bucket = asRecord(root[bucketKey(kind)])
  if (!(SERVER_NAME in bucket)) return text
  delete bucket[SERVER_NAME]
  root[bucketKey(kind)] = bucket
  return `${JSON.stringify(root, null, 2)}\n`
}

/** Is our entry already present in this config text? */
export const hasServer = (text: string, kind: ConfigKind): boolean => {
  if (text.trim() === '') return false
  if (kind === 'toml') return text.split('\n').some((line) => line.trim() === TOML_HEADER)
  try {
    const root = parseObject(text)
    return SERVER_NAME in asRecord(root[bucketKey(kind)])
  } catch {
    return false
  }
}
