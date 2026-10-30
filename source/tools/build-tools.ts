/**
 * Build tools — routed to Creator's `builder` module. `builder` keeps every build task it has run
 * (with all its options), so raw `query-tasks-info` is huge; the tools here return a summary and
 * give the full options only through `build_options_get`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDef, ToolContext } from './types.js'
import { isDirty } from './scene-tools.js'
import { optionalBoolean, optionalNumber, optionalObject, optionalString } from './types.js'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Recursively merge `patch` into `base` (objects merge, everything else is replaced). */
export const mergeOptions = (base: Json, patch: Json): Json => {
  const out: Json = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    out[key] = isObject(current) && isObject(value) ? mergeOptions(current, value) : value
  }
  return out
}

const DONE = new Set(['success', 'failure', 'error', 'cancel', 'cancelled', 'break'])

/** MCP clients give up on a request after about a minute; a build takes about as long, so never wait past this. */
export const MAX_WAIT_SEC = 45

export interface TaskSummary {
  id: string
  platform: unknown
  state: unknown
  stage: unknown
  progress: unknown
  message: unknown
  time: unknown
  buildPath: unknown
  /** Folder under buildPath — Creator appends -001, -002… when the platform folder already exists. */
  outputName: unknown
  debug: unknown
}

/** `query-tasks-info` answers `{ queue: {id: task}, list: [task], free }` — both views hold the same tasks. */
const rawTasks = (raw: unknown): Json[] => {
  const info = isObject(raw) ? raw : {}
  if (Array.isArray(info['list'])) return (info['list'] as unknown[]).filter(isObject)
  return isObject(info['queue']) ? Object.values(info['queue']).filter(isObject) : []
}

const byNewest = (a: Json, b: Json): number => Number(b['id']) - Number(a['id'])

export const summariseTasks = (raw: unknown): TaskSummary[] =>
  rawTasks(raw)
    .sort(byNewest)
    .map((task) => {
      const options = isObject(task['options']) ? task['options'] : {}
      return {
        id: String(task['id']),
        platform: options['platform'],
        state: task['state'],
        stage: task['stage'],
        progress: task['progress'],
        message: task['message'],
        time: task['time'],
        buildPath: options['buildPath'],
        outputName: options['outputName'],
        debug: options['debug'],
      }
    })

const tasksInfo = async (ctx: ToolContext): Promise<unknown> => ctx.bridge.request('builder', 'query-tasks-info')

const outDirOf = (ctx: ToolContext, args: Json, platform: string): string =>
  join(optionalString(args, 'buildPath') ?? join(ctx.bridge.projectPath(), 'build'), platform)

/** Where a task really wrote its output: `<buildPath>/<outputName>`, or `fallback` when the task does not say. */
const taskOutDir = (task: TaskSummary | undefined, fallback: string): string =>
  task && typeof task.buildPath === 'string' && typeof task.outputName === 'string' && task.outputName ? join(task.buildPath, task.outputName) : fallback

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const buildTools: ToolDef[] = [
  {
    name: 'project_build',
    description:
      'Start a Cocos build task (e.g. web-mobile). Pass `options` to override build options (deep-merged, e.g. {"packages":{"web-mobile":{"orientation":"portrait"}}}); read the current ones with build_options_get. Builds take about a minute: it returns at once with the task, poll build_status (or pass wait: true to wait up to 45 s).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Build platform, e.g. web-mobile (default web-mobile).' },
        debug: { type: 'boolean', description: 'Debug build (default false).' },
        buildPath: { type: 'string', description: 'Output directory.' },
        options: { type: 'object', description: 'Extra build options, deep-merged over the defaults.' },
        wait: { type: 'boolean', description: `Wait for the build to finish, up to ${MAX_WAIT_SEC} s (default false). Builds usually take longer: then poll build_status.` },
        timeoutSec: { type: 'number', description: `With wait: stop waiting after this many seconds (at most ${MAX_WAIT_SEC}).` },
        save: { type: 'boolean', description: 'Save the open scene first if it has unsaved changes (otherwise the build is refused).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      // A build reads the saved scene files, and with unsaved edits Creator's pre-build step stalls ("scene:(onBeforeBuild)")
      // and leaves the builder busy for the next task. So build only from a saved scene.
      let savedScene = false
      if (await isDirty(ctx).catch(() => false)) {
        if (args['save'] !== true) {
          throw new Error('The open scene has unsaved changes: the build would not include them and Creator stalls before building. Save it (scene_save) or pass "save": true.')
        }
        await ctx.bridge.request('scene', 'save-scene')
        savedScene = true
      }
      const platform = optionalString(args, 'platform') ?? 'web-mobile'
      let options: Json = { name: platform, platform, debug: optionalBoolean(args, 'debug') ?? false }
      const buildPath = optionalString(args, 'buildPath')
      if (buildPath) options['buildPath'] = buildPath
      options = mergeOptions(options, optionalObject(args, 'options') ?? {})
      const before = new Set(summariseTasks(await tasksInfo(ctx).catch(() => null)).map((task) => task.id))
      await ctx.bridge.request('builder', 'add-task', options)
      const outDir = outDirOf(ctx, { buildPath: options['buildPath'] }, platform)
      // `add-task` does not name the task; it is the one that was not there before.
      const findTask = async (): Promise<TaskSummary | undefined> =>
        summariseTasks(await tasksInfo(ctx).catch(() => null)).find((task) => !before.has(task.id))
      if (args['wait'] !== true) {
        const task = await findTask()
        return { started: true, task, outDir: taskOutDir(task, outDir), hint: 'Runs in the background. Use build_status, or pass wait: true.', ...(savedScene ? { savedScene } : {}) }
      }
      const deadline = Date.now() + Math.min(optionalNumber(args, 'timeoutSec') ?? MAX_WAIT_SEC, MAX_WAIT_SEC) * 1000
      while (Date.now() < deadline) {
        const task = await findTask()
        if (task && DONE.has(String(task.state))) {
          const dir = taskOutDir(task, outDir)
          return { started: true, finished: true, succeeded: task.state === 'success', task, outDir: dir, hasIndexHtml: existsSync(join(dir, 'index.html')), ...(savedScene ? { savedScene } : {}) }
        }
        await sleep(1500)
      }
      const task = await findTask()
      return { started: true, finished: false, task, outDir: taskOutDir(task, outDir), hint: 'Still running — poll build_status until the task state is success or failure.', ...(savedScene ? { savedScene } : {}) }
    },
  },
  {
    name: 'build_status',
    description:
      'Summary of the most recent build tasks (id, platform, state, progress, message, time) and whether the build output folder holds index.html. Pass verbose: true for the raw task records (very large).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Platform folder to check (default web-mobile).' },
        buildPath: { type: 'string', description: 'Output directory (default <project>/build).' },
        limit: { type: 'number', description: 'How many recent tasks to list (default 3).' },
        verbose: { type: 'boolean', description: 'Return the raw task records instead of the summary.' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const outDir = outDirOf(ctx, args, optionalString(args, 'platform') ?? 'web-mobile')
      let raw: unknown = null
      let error: string | undefined
      try {
        raw = await tasksInfo(ctx)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
      const platform = optionalString(args, 'platform') ?? 'web-mobile'
      const tasks = error ? [] : summariseTasks(raw)
      // The newest task for this platform (and output folder, when given) names the folder it really wrote to.
      const latest = tasks.find((task) => task.platform === platform && (!optionalString(args, 'buildPath') || task.buildPath === optionalString(args, 'buildPath')))
      const dir = taskOutDir(latest, outDir)
      const base = { outDir: dir, hasIndexHtml: existsSync(join(dir, 'index.html')) }
      if (error) return { ...base, error }
      if (args['verbose'] === true) return { ...base, tasks: raw }
      return { ...base, running: tasks.filter((task) => !DONE.has(String(task.state))).length, total: tasks.length, tasks: tasks.slice(0, Math.max(1, optionalNumber(args, 'limit') ?? 3)) }
    },
  },
  {
    name: 'build_options_get',
    description: 'The full build options of the most recent build task for a platform — the starting point for the `options` of project_build.',
    inputSchema: {
      type: 'object',
      properties: { platform: { type: 'string', description: 'Build platform (default web-mobile).' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const platform = optionalString(args, 'platform') ?? 'web-mobile'
      const latest = rawTasks(await tasksInfo(ctx))
        .sort(byNewest)
        .find((task) => isObject(task['options']) && (task['options'] as Json)['platform'] === platform)
      if (!latest) throw new Error(`No build task has run for "${platform}" yet — run project_build once, then read its options here.`)
      return { taskId: String(latest['id']), options: latest['options'] }
    },
  },
  {
    name: 'build_cancel',
    description: 'Stop a running build task (default: the most recent one that is still running).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Task id from build_status.' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const requested = optionalString(args, 'taskId')
      const running = summariseTasks(await tasksInfo(ctx)).find((task) => (requested ? task.id === requested : !DONE.has(String(task.state))))
      if (!running) throw new Error(requested ? `No build task "${requested}".` : 'No build task is running.')
      await ctx.bridge.request('builder', 'break-task', running.id)
      // A task still waiting in the queue can ignore break-task and run later, so report its state afterwards.
      const after = summariseTasks(await tasksInfo(ctx).catch(() => null)).find((task) => task.id === running.id)
      const stopped = !after || DONE.has(String(after.state))
      return {
        ok: stopped,
        cancelled: running.id,
        state: after?.state,
        ...(stopped ? {} : { warning: `Task ${running.id} is still "${String(after?.state)}"; check build_status — a queued task may run anyway.` }),
      }
    },
  },
]
