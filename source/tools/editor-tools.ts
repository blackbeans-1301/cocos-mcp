/**
 * Editor-level tools: status, console, and the two escape hatches.
 *
 * `editor_script` runs JavaScript in the **editor main process**; `scene_script`
 * runs it in the **engine runtime** (through the scene script). Both are
 * deliberately powerful — they are how an agent does something no typed tool
 * covers yet. Prefer the typed tools: they validate input and return structure.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDef, ToolContext } from './types.js'
import { ToolInputError, asObject, optionalArray, optionalBoolean, optionalNumber, optionalString, requireString } from './types.js'

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
const g = globalThis as unknown as { __adscraftLogHooked?: boolean; __adscraftLogBuffer?: LogLine[]; __adscraftInConsole?: boolean }
const logBuffer: LogLine[] = (g.__adscraftLogBuffer ??= [])

const record = (type: string, message: string): void => {
  logBuffer.push({ type, message: message.replace(/\r?\n$/, ''), time: new Date().toISOString() })
  if (logBuffer.length > LOG_LIMIT) logBuffer.shift()
}

if (!g.__adscraftLogHooked) {
  g.__adscraftLogHooked = true
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
        g.__adscraftInConsole = true
        try {
          original(...parts)
        } finally {
          g.__adscraftInConsole = false
        }
      }
    }
  }
  for (const [stream, type] of [[process.stdout, 'log'], [process.stderr, 'error']] as const) {
    const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
    ;(stream as unknown as { write: typeof original }).write = (chunk, ...rest) => {
      if (!g.__adscraftInConsole) record(type, typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'))
      return original(chunk, ...rest)
    }
  }
}

const normalizeConsole = (raw: unknown): Array<Record<string, unknown>> => {
  const list = Array.isArray(raw) ? raw : []
  return list.map((entry) => {
    const e = asObject(entry)
    return {
      type: typeof e['type'] === 'string' ? e['type'] : 'log',
      message: typeof e['message'] === 'string' ? e['message'] : String(e['message'] ?? ''),
      ...(typeof e['time'] === 'string' ? { time: e['time'] } : {}),
      ...(typeof e['stack'] === 'string' ? { stack: e['stack'] } : {}),
    }
  })
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
    description: 'Read recent editor/console log lines (captured from the editor main process since the extension loaded).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max lines to return (default 100).' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const limit = optionalNumber(args, 'limit') ?? 100
      return { entries: normalizeConsole(logBuffer).slice(-limit), total: logBuffer.length, note: 'Captured since the extension loaded (console + stdout/stderr of the editor main process).' }
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
    name: 'project_build',
    description: 'Start a Cocos build task (e.g. web-mobile). Build options depend on the Creator build — experimental.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Build platform, e.g. web-mobile (default web-mobile).' },
        debug: { type: 'boolean', description: 'Debug build (default false).' },
        buildPath: { type: 'string', description: 'Output directory.' },
        wait: { type: 'boolean', description: 'Block until <buildPath>/<platform>/index.html appears (default false).' },
        timeoutSec: { type: 'number', description: 'With wait: give up after this many seconds (default 300).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const platform = optionalString(args, 'platform') ?? 'web-mobile'
      const options: Record<string, unknown> = {
        name: platform,
        platform,
        debug: optionalBoolean(args, 'debug') ?? false,
      }
      const buildPath = optionalString(args, 'buildPath')
      if (buildPath) options['buildPath'] = buildPath
      const task = await ctx.bridge.request('builder', 'add-task', options)
      const outDir = join(buildPath ?? join(ctx.bridge.projectPath(), 'build'), platform)
      if (args['wait'] !== true) {
        return { started: true, task, outDir, hint: 'Runs in the background. Use build_status, or pass wait: true.' }
      }
      const deadline = Date.now() + (optionalNumber(args, 'timeoutSec') ?? 300) * 1000
      while (Date.now() < deadline) {
        if (existsSync(join(outDir, 'index.html'))) return { started: true, finished: true, task, outDir }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      return { started: true, finished: false, task, outDir, hint: 'Timed out waiting for index.html - check the editor console.' }
    },
  },
  {
    name: 'build_status',
    description: 'State of the build tasks Creator knows about, and whether a build output folder holds index.html.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Platform folder to check (default web-mobile).' },
        buildPath: { type: 'string', description: 'Output directory (default <project>/build).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const outDir = join(optionalString(args, 'buildPath') ?? join(ctx.bridge.projectPath(), 'build'), optionalString(args, 'platform') ?? 'web-mobile')
      let tasks: unknown = null
      try {
        tasks = await ctx.bridge.request('builder', 'query-tasks-info')
      } catch (err) {
        tasks = { error: err instanceof Error ? err.message : String(err) }
      }
      return { outDir, hasIndexHtml: existsSync(join(outDir, 'index.html')), tasks }
    },
  },
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
    name: 'project_setting_set',
    description: 'Write a project setting (experimental; verify with project_setting_get).',
    inputSchema: {
      type: 'object',
      properties: { package: { type: 'string' }, key: { type: 'string' }, value: { description: 'JSON value.' } },
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
