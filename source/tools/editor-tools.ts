/**
 * Editor-level tools: status, console, and the two escape hatches.
 *
 * `editor_script` runs JavaScript in the **editor main process**; `scene_script`
 * runs it in the **engine runtime** (through the scene script). Both are
 * deliberately powerful — they are how an agent does something no typed tool
 * covers yet. Prefer the typed tools: they validate input and return structure.
 */
import type { ToolDef, ToolContext } from './types.js'
import { ToolInputError, JSON_VALUE, defined, optionalArray, optionalBoolean, optionalEnum, optionalNumber, optionalString, requireString } from './types.js'

/**
 * Ring buffer of main-process output — Creator 3.8.8 has no `query-console-logs` message.
 *
 * Captured two ways, because which one sees a line depends on how Creator wires `console`:
 * the global `console` methods, and `process.stdout/stderr.write` (which also carries the
 * `[Scene] ...` lines relayed from the scene process). A line seen by both is stored once.
 */
const LOG_LIMIT = 500
type LogLine = { type: string; message: string; time: string }
// Kept on globalThis: an extension reload re-evaluates this module but the patches from the first load survive.
const g = globalThis as unknown as { __ccreatorLogHooked?: boolean; __ccreatorLogBuffer?: LogLine[]; __ccreatorInConsole?: boolean }
const logBuffer: LogLine[] = (g.__ccreatorLogBuffer ??= [])

const record = (type: string, message: string): void => {
  logBuffer.push({ type, message: message.replace(/\r?\n$/, ''), time: new Date().toISOString() })
  if (logBuffer.length > LOG_LIMIT) logBuffer.shift()
}

if (!g.__ccreatorLogHooked) {
  g.__ccreatorLogHooked = true
  const fmt = (parts: unknown[]): string =>
    parts.map((p) => (typeof p === 'string' ? p : p instanceof Error ? p.stack ?? p.message : safeJson(p))).join(' ')
  const safeJson = (v: unknown): string => {
    try {
      return JSON.stringify(v) ?? String(v)
    } catch {
      return String(v)
    }
  }
  // `console` here and `globalThis.console` can be different objects inside Creator's module wrapper.
  const targets = new Set<Console>([console, (globalThis as unknown as { console: Console }).console])
  for (const target of targets) {
    for (const type of ['log', 'info', 'warn', 'error'] as const) {
      const original = target[type].bind(target)
      target[type] = (...parts: unknown[]) => {
        record(type, fmt(parts))
        g.__ccreatorInConsole = true
        try {
          original(...parts)
        } finally {
          g.__ccreatorInConsole = false
        }
      }
    }
  }
  for (const [stream, type] of [[process.stdout, 'log'], [process.stderr, 'error']] as const) {
    const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
    ;(stream as unknown as { write: typeof original }).write = (chunk, ...rest) => {
      if (!g.__ccreatorInConsole) record(type, typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'))
      return original(chunk, ...rest)
    }
  }
}

const STACK_LINE = /^\s+at\s/
const compact = (message: string, stack: boolean, maxChars: number): string => {
  const text = stack ? message : message.split('\n').filter((line) => !STACK_LINE.test(line)).join('\n')
  return maxChars > 0 && text.length > maxChars ? `${text.slice(0, maxChars)}… [${text.length - maxChars} more chars]` : text
}

export interface LogQuery {
  limit?: number | undefined
  type?: string | undefined
  pattern?: string | undefined
  stack?: boolean | undefined
  maxChars?: number | undefined
  /** Only lines logged within this many milliseconds. */
  withinMs?: number | undefined
}

/**
 * The level a line really has. Lines forwarded from the scene process keep it in their text ("Warn: [Scene] …") but
 * reach this process through console.error/stderr, so the channel alone over-reports errors. Decided when reading,
 * not when recording: the console hook is installed once per editor session and survives extension reloads.
 */
export const levelOf = (type: string, message: string): string => {
  if (type !== 'error') return type
  if (/^\s*\[?warn(ing)?\b/i.test(message)) return 'warn'
  if (/^\s*\[?(log|info)\b[:\]]/i.test(message)) return 'log'
  return type
}

/** Filter the captured log buffer. Default output is compact: no stack frames, long messages cut. */
export const searchLogs = (query: LogQuery): Array<Record<string, unknown>> => {
  const matcher = query.pattern ? new RegExp(query.pattern, 'i') : null
  const oldest = query.withinMs === undefined ? 0 : Date.now() - query.withinMs
  return logBuffer
    .map((line) => ({ ...line, type: levelOf(line.type, line.message) }))
    .filter((line) => (!query.type || line.type === query.type) && (!matcher || matcher.test(line.message)) && Date.parse(line.time) >= oldest)
    .slice(-(query.limit ?? 100))
    .map((line) => ({ ...line, message: compact(line.message, query.stack === true, query.maxChars ?? 800) }))
}

const escapeHatch = (name: string, description: string, run: (code: string, args: unknown, ctx: ToolContext) => Promise<unknown>): ToolDef => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Async function body; `return` the result.' },
      args: { description: 'Value passed as `args`.' },
    },
    required: ['code'],
    additionalProperties: false,
  },
  handler: (args, ctx) => run(requireString(args, 'code'), args['args'] ?? null, ctx),
})

export const editorTools: ToolDef[] = [
  {
    name: 'editor_status',
    description: 'Cocos Creator version and the open project path — call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => ({
      editorVersion: ctx.bridge.editorVersion(),
      projectPath: ctx.bridge.projectPath(),
      transport: 'streamable-http',
      endpoint: '/mcp',
    }),
  },
  {
    name: 'editor_project_info',
    description: 'Basic info about the project open in the editor.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => ({
      path: ctx.bridge.projectPath(),
      editorVersion: ctx.bridge.editorVersion(),
    }),
  },
  {
    name: 'editor_console_logs',
    description:
      'Read recent editor/console log lines (captured from the editor main process since the extension loaded). Compact by default: stack frames are dropped and long messages cut; filter with type/pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max lines to return (default 100).' },
        type: { type: 'string', enum: ['log', 'info', 'warn', 'error'], description: 'Only lines of this type.' },
        pattern: { type: 'string', description: 'Case-insensitive regular expression the message must match.' },
        stack: { type: 'boolean', description: 'Keep stack frames (default false).' },
        maxChars: { type: 'number', description: 'Cut messages longer than this (default 800; 0 = no limit).' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const type = optionalEnum(args, 'type', ['log', 'info', 'warn', 'error'] as const)
      let entries: Array<Record<string, unknown>>
      try {
        entries = searchLogs(defined({ limit: optionalNumber(args, 'limit'), type, pattern: optionalString(args, 'pattern'), stack: optionalBoolean(args, 'stack'), maxChars: optionalNumber(args, 'maxChars') }))
      } catch (err) {
        throw new ToolInputError(`Bad "pattern": ${err instanceof Error ? err.message : String(err)}`)
      }
      return { entries, total: logBuffer.length, note: 'Captured since the extension loaded (console + stdout/stderr of the editor main process).' }
    },
  },
  escapeHatch(
    'editor_script',
    'Escape hatch: run JavaScript in the editor main process. In scope: `Editor`, `require`, `args`. Return a JSON-serializable value.',
    async (code, args) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('Editor', 'require', 'args', `"use strict"; return (async () => { ${code}\n })();`)
      const editor = (globalThis as unknown as { Editor: unknown }).Editor
      return (fn as (...a: unknown[]) => Promise<unknown>)(editor, require, args)
    },
  ),
  escapeHatch(
    'scene_script',
    'Escape hatch: run JavaScript in the engine runtime (same context as project scripts). In scope: `cc`, `args`. Return a JSON-serializable value.',
    (code, args, ctx) => {
      const payload: Record<string, unknown> = { code }
      if (args !== null) payload['args'] = args
      return ctx.bridge.scene('evalScript', [payload])
    },
  ),
  {
    name: 'editor_console_clear',
    description: 'Empty the log buffer read by editor_console_logs (does not touch the editor console panel).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      logBuffer.length = 0
      return { cleared: true }
    },
  },
  {
    name: 'editor_undo',
    description: 'Undo the last scene edit (same as Ctrl+Z in the editor).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => {
      await ctx.bridge.request('scene', 'undo')
      return { ok: true }
    },
  },
  {
    name: 'editor_redo',
    description: 'Redo the last undone scene edit.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => {
      await ctx.bridge.request('scene', 'redo')
      return { ok: true }
    },
  },
  {
    name: 'selection_get',
    description: 'Uuids of the nodes currently selected in the editor.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => ({ nodes: ctx.bridge.selection() }),
  },
  {
    name: 'selection_set',
    description: 'Select nodes in the editor by uuid (an empty list clears the selection).',
    inputSchema: {
      type: 'object',
      properties: { uuids: { type: 'array', items: { type: 'string' } } },
      required: ['uuids'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const uuids = (optionalArray(args, 'uuids') ?? []).filter((u): u is string => typeof u === 'string')
      ctx.bridge.select(uuids)
      return { nodes: uuids }
    },
  },
  {
    name: 'project_setting_get',
    description: 'Read a project setting (experimental). `package` is the profile name, e.g. "project"; `key` a dotted path, e.g. "general.designResolution".',
    inputSchema: {
      type: 'object',
      properties: { package: { type: 'string' }, key: { type: 'string' } },
      required: ['package', 'key'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => ({ value: (await ctx.bridge.getProjectSetting(requireString(args, 'package'), requireString(args, 'key'))) ?? null }),
  },
  {
    name: 'project_setting_list',
    description:
      'List what a project setting profile holds: the keys at `key` (default: the whole profile) with their type and a short preview, so you know which keys project_setting_get/set accept.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'string', description: 'Profile name, e.g. "project".' },
        key: { type: 'string', description: 'Dotted path to look inside, e.g. "general" (default: top level).' },
      },
      required: ['package'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const key = optionalString(args, 'key') ?? ''
      const value = await ctx.bridge.getProjectSetting(requireString(args, 'package'), key)
      if (typeof value !== 'object' || value === null) return { key, type: typeof value, value: value ?? null }
      const entries = Object.entries(value as Record<string, unknown>).map(([name, inner]) => ({
        key: key ? `${key}.${name}` : name,
        type: Array.isArray(inner) ? 'array' : inner === null ? 'null' : typeof inner,
        preview: (JSON.stringify(inner) ?? '').slice(0, 80),
      }))
      return { key, entries }
    },
  },
  {
    name: 'project_setting_set',
    description: 'Write a project setting (experimental; verify with project_setting_get).',
    inputSchema: {
      type: 'object',
      properties: { package: { type: 'string' }, key: { type: 'string' }, value: JSON_VALUE },
      required: ['package', 'key', 'value'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      if (!('value' in args)) throw new ToolInputError('Provide "value".')
      await ctx.bridge.setProjectSetting(requireString(args, 'package'), requireString(args, 'key'), args['value'])
      return { ok: true }
    },
  },
]
