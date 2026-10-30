/**
 * Tests for the second wave of tools and the fixes to the first: diagnostics, screenshot, dumps,
 * build summaries, dirty-scene guard, batch, log filters, asset meta. Fake bridge, no editor.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callTool, TOOLS } from '../dist/tools/index.js'
import { dumpProperty } from '../dist/tools/component-tools.js'
import { mergeOptions, summariseTasks } from '../dist/tools/build-tools.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Replies may be plain values or functions (args) => value, keyed `pkg/message` or `scene-script/method`. */
const fake = (replies = {}, extra = {}) => {
  const calls = []
  const answer = (key, args, fallback) => {
    if (!(key in replies)) return fallback
    const reply = replies[key]
    return typeof reply === 'function' ? reply(...args) : reply
  }
  const bridge = {
    request: async (pkg, message, ...args) => {
      calls.push({ pkg, message, args })
      return answer(`${pkg}/${message}`, args, { pkg, message })
    },
    scene: async (method, args) => {
      calls.push({ pkg: 'scene-script', message: method, args })
      return answer(`scene-script/${method}`, [args], { uuid: 'node-1', path: 'Canvas/N' })
    },
    selection: () => [],
    select: () => undefined,
    getProjectSetting: async (pkg, key) => (key === '' ? { general: { a: 1 }, list: [1, 2], name: 'x', nothing: null } : { a: 1 }),
    setProjectSetting: async () => undefined,
    projectPath: () => '/tmp/project',
    editorVersion: () => '3.8.8',
    appPath: () => ROOT,
    capture: async () => ({ width: 2, height: 1, png: new Uint8Array([137, 80, 78, 71]) }),
    ...extra,
  }
  return { calls, ctx: { bridge } }
}

const ok = (out) => {
  assert.ok('result' in out, `expected a result, got ${JSON.stringify(out)}`)
  return out.result
}
const failed = (out) => {
  assert.ok('toolError' in out, `expected a tool error, got ${JSON.stringify(out)}`)
  return out.toolError
}

test('tool names are unique and the new tools are registered', () => {
  const names = TOOLS.map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length)
  for (const name of [
    'batch', 'script_diagnostics', 'scene_screenshot', 'scene_is_dirty', 'component_dump', 'component_set_properties',
    'asset_refresh', 'asset_meta_get', 'asset_meta_set', 'build_options_get', 'build_cancel', 'project_setting_list',
  ]) {
    assert.ok(names.includes(name), `${name} missing`)
  }
})

test('asset_info and prefab_info fail when the asset does not exist', async () => {
  const { ctx } = fake({ 'asset-db/query-asset-info': null })
  assert.match(failed(await callTool('asset_info', { url: 'db://assets/none.png' }, ctx)), /No asset found/)
  assert.match(failed(await callTool('prefab_info', { url: 'db://assets/none.prefab' }, ctx)), /No asset found/)
})

test('asset_query hides sub-assets unless a type is asked for, and honours limit', async () => {
  const rows = [
    { url: 'db://assets/a.png', uuid: 'a', type: 'cc.ImageAsset', name: 'a.png' },
    { url: 'db://assets/a.png/spriteFrame', uuid: 'a@f9941', type: 'cc.SpriteFrame', name: 'spriteFrame' },
    { url: 'db://assets/b.png', uuid: 'b', type: 'cc.ImageAsset', name: 'b.png' },
  ]
  const { ctx } = fake({ 'asset-db/query-assets': rows })
  const plain = ok(await callTool('asset_query', { pattern: 'db://assets/*.png' }, ctx))
  assert.deepEqual([plain.total, plain.assets.length, plain.truncated], [2, 2, false])
  const typed = ok(await callTool('asset_query', { type: 'cc.SpriteFrame' }, ctx))
  assert.equal(typed.total, 3, 'a type query keeps sub-assets (spriteFrames only exist as sub-assets)')
  const cut = ok(await callTool('asset_query', { limit: 1 }, ctx))
  assert.deepEqual([cut.returned, cut.truncated], [1, true])
})

test('asset_refresh defaults to db://assets', async () => {
  const { calls, ctx } = fake()
  assert.deepEqual(ok(await callTool('asset_refresh', {}, ctx)), { ok: true, refreshed: 'db://assets' })
  assert.deepEqual(calls.at(-1), { pkg: 'asset-db', message: 'refresh-asset', args: ['db://assets'] })
})

test('asset_meta_set deep-merges userData, saves the .meta and re-imports', async () => {
  const meta = { ver: '1', importer: 'image', userData: { type: 'sprite-frame', compress: { enabled: false, quality: 80 } }, subMetas: {} }
  const { calls, ctx } = fake({ 'asset-db/query-asset-info': { uuid: 'u1', url: 'db://assets/a.png' }, 'asset-db/query-asset-meta': meta })
  const out = ok(await callTool('asset_meta_set', { url: 'db://assets/a.png', userData: { compress: { enabled: true } } }, ctx))
  assert.deepEqual(out.userData, { type: 'sprite-frame', compress: { enabled: true, quality: 80 } })
  const save = calls.find((c) => c.message === 'save-asset-meta')
  assert.equal(save.args[0], 'u1')
  assert.deepEqual(JSON.parse(save.args[1]).userData, out.userData)
  assert.equal(calls.at(-1).message, 'reimport-asset')
  const read = ok(await callTool('asset_meta_get', { url: 'db://assets/a.png' }, ctx))
  assert.equal(read.importer, 'image')
})

const TASKS = {
  free: true,
  queue: {},
  list: [
    { id: '100', state: 'success', stage: 'build', progress: 1, message: 'old', time: 't1', options: { platform: 'web-mobile', buildPath: '/b', debug: false, huge: { a: 1 } } },
    { id: '300', state: 'processing', stage: 'build', progress: 0.4, message: 'busy', time: 't3', options: { platform: 'web-mobile', buildPath: '/b' } },
    { id: '200', state: 'failure', stage: 'build', progress: 1, message: 'bad', time: 't2', options: { platform: 'android' } },
  ],
}

test('build_status summarises tasks newest-first instead of dumping their options', async () => {
  const { ctx } = fake({ 'builder/query-tasks-info': TASKS })
  const out = ok(await callTool('build_status', { limit: 2 }, ctx))
  assert.deepEqual(out.tasks.map((t) => t.id), ['300', '200'])
  assert.equal(out.running, 1)
  assert.equal(out.tasks[0].progress, 0.4)
  assert.ok(!JSON.stringify(out).includes('huge'))
  assert.deepEqual(ok(await callTool('build_status', { verbose: true }, ctx)).tasks, TASKS)
})

test('summariseTasks reads the queue map when there is no list, and mergeOptions merges deeply', () => {
  assert.equal(summariseTasks({ queue: { 1: { id: '1', state: 'success', options: {} } } })[0].id, '1')
  assert.deepEqual(mergeOptions({ a: { b: 1, c: 2 }, d: 1 }, { a: { b: 9 }, e: 3 }), { a: { b: 9, c: 2 }, d: 1, e: 3 })
})

test('project_build merges options, and wait blocks until the new task is done', async () => {
  let polls = 0
  const { calls, ctx } = fake({
    'builder/query-tasks-info': () => {
      polls++
      // 1st call: before add-task (nothing). Later calls: the new task, running then finished.
      if (polls === 1) return { list: [] }
      return { list: [{ id: '7', state: polls < 3 ? 'processing' : 'success', options: { platform: 'web-mobile' } }] }
    },
  })
  const out = ok(await callTool('project_build', { options: { packages: { 'web-mobile': { orientation: 'portrait' } } }, wait: true, timeoutSec: 20 }, ctx))
  const add = calls.find((c) => c.message === 'add-task')
  assert.equal(add.args[0].packages['web-mobile'].orientation, 'portrait')
  assert.equal(add.args[0].platform, 'web-mobile')
  assert.deepEqual([out.finished, out.succeeded, out.task.id], [true, true, '7'])
})

test('build_options_get returns the latest options for a platform; build_cancel stops the running task', async () => {
  const { calls, ctx } = fake({ 'builder/query-tasks-info': TASKS })
  const options = ok(await callTool('build_options_get', {}, ctx))
  assert.deepEqual([options.taskId, options.options.buildPath], ['300', '/b'])
  assert.match(failed(await callTool('build_options_get', { platform: 'ios' }, ctx)), /No build task has run/)
  // The fake never changes state: a task that is still running after break-task is reported, not hidden.
  const stuck = ok(await callTool('build_cancel', {}, ctx))
  assert.deepEqual([stuck.ok, stuck.cancelled, stuck.state], [false, '300', 'processing'])
  assert.match(stuck.warning, /still "processing"/)
  assert.ok(calls.some((c) => c.message === 'break-task' && c.args[0] === '300'))
})

test('build_cancel confirms a task that stopped, and build output paths follow outputName', async () => {
  let broken = false
  const task = () => ({ id: '9', state: broken ? 'failure' : 'processing', options: { platform: 'web-mobile', buildPath: '/b', outputName: 'web-mobile-002' } })
  const { ctx } = fake({ 'builder/query-tasks-info': () => ({ list: [task()] }), 'builder/break-task': () => { broken = true } })
  assert.deepEqual(ok(await callTool('build_cancel', {}, ctx)), { ok: true, cancelled: '9', state: 'failure' })
  const status = ok(await callTool('build_status', {}, ctx))
  assert.equal(status.outDir.split('\\').join('/'), '/b/web-mobile-002')
})

test('editor_console_logs is compact by default and filters by type and pattern', async () => {
  const token = `tok${Date.now()}`
  console.error(`${token} boom\n    at frame1 (file.js:1:1)\n    at frame2 (file.js:2:2)`)
  console.log(`${token} fine`)
  const { ctx } = fake()
  const errors = ok(await callTool('editor_console_logs', { type: 'error', pattern: token }, ctx)).entries
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, `${token} boom`, 'stack frames are dropped by default')
  const withStack = ok(await callTool('editor_console_logs', { type: 'error', pattern: token, stack: true }, ctx)).entries
  assert.match(withStack[0].message, /at frame1/)
  const cut = ok(await callTool('editor_console_logs', { pattern: token, maxChars: 5 }, ctx)).entries
  assert.match(cut[0].message, /more chars/)
  assert.match(failed(await callTool('editor_console_logs', { type: 'nope' }, ctx).catch((e) => ({ toolError: e.message }))), /type/)
})

test('scene_open refuses while the scene is dirty unless save is set', async () => {
  const dirty = fake({ 'scene/query-dirty': true, 'asset-db/query-uuid': 'scene-2' })
  assert.match(failed(await callTool('scene_open', { url: 'db://assets/b.scene' }, dirty.ctx)), /unsaved changes/)
  assert.ok(!dirty.calls.some((c) => c.message === 'open-scene'), 'must not open the scene')
  const saved = ok(await callTool('scene_open', { url: 'db://assets/b.scene', save: true }, dirty.ctx))
  assert.equal(saved.savedPrevious, true)
  const order = dirty.calls.map((c) => c.message).filter((m) => m === 'save-scene' || m === 'open-scene')
  assert.deepEqual(order, ['save-scene', 'open-scene'])
  const clean = fake({ 'scene/query-dirty': false, 'asset-db/query-uuid': 'scene-2' })
  assert.equal(ok(await callTool('scene_open', { url: 'db://assets/b.scene' }, clean.ctx)).opened, 'scene-2')
  assert.match(failed(await callTool('scene_create', { url: 'db://assets/c.scene' }, dirty.ctx)), /unsaved changes/)
})

test('scene_is_dirty reports the flag and the scene', async () => {
  const { ctx } = fake({ 'scene/query-dirty': true, 'scene-script/sceneInfo': { name: 'main' } })
  assert.deepEqual(ok(await callTool('scene_is_dirty', {}, ctx)), { dirty: true, scene: { name: 'main' } })
})

test('scene_screenshot focuses a node, writes a png and prunes old ones', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ccmcp-shot-'))
  const dir = join(project, 'temp', 'ccreator-mcp', 'screenshots')
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 25; i++) writeFileSync(join(dir, `scene-2000-01-01T00-00-${String(i).padStart(2, '0')}.png`), 'x')
  const { calls, ctx } = fake({}, { projectPath: () => project })
  const out = ok(await callTool('scene_screenshot', { path: 'Canvas/Bird' }, ctx))
  assert.ok(existsSync(out.file))
  assert.deepEqual([out.width, out.height, out.bytes], [2, 1, 4])
  assert.deepEqual(calls.find((c) => c.message === 'focus-camera').args, [['node-1']])
  assert.equal(readdirSync(dir).length, 20)
})

test('component_dump flattens the editor dump into settable values', async () => {
  const { ctx } = fake({
    'scene-script/getNode': { uuid: 'n1', path: 'Canvas' },
    'scene/query-node': { __comps__: [{ type: 'cc.UITransform', value: { uuid: { value: 'c0' } } }, { type: 'GameManager', value: { uuid: { value: 'c1' }, enabled: { value: false } } }] },
    'scene/query-component': {
      value: {
        _hidden: { type: 'Number', value: 1, visible: true },
        __scriptAsset: { type: 'cc.Script', value: { uuid: 's' }, visible: true },
        targetScore: { type: 'Number', value: 10, visible: true },
        mode: { type: 'Enum', value: 2, visible: true, enumList: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }] },
        bgm: { type: 'cc.AudioClip', value: { uuid: 'clip' }, extends: ['cc.Asset'], visible: true },
        target: { type: 'cc.Node', value: { uuid: 'node-9' }, visible: true },
        frames: { type: 'cc.SpriteFrame', isArray: true, extends: ['cc.Asset'], visible: true, value: [{ value: { uuid: 'f1' }, type: 'cc.SpriteFrame' }] },
        internal: { type: 'Number', value: 5, visible: false },
      },
    },
  })
  const out = ok(await callTool('component_dump', { path: 'Canvas', type: 'GameManager' }, ctx))
  assert.equal(out.enabled, false)
  const by = Object.fromEntries(out.properties.map((p) => [p.name, p]))
  assert.deepEqual(Object.keys(by).sort(), ['bgm', 'frames', 'mode', 'target', 'targetScore'])
  assert.equal(by.targetScore.value, 10)
  assert.deepEqual(by.mode.enum, [{ name: 'A', value: 1 }, { name: 'B', value: 2 }])
  assert.deepEqual(by.bgm.value, { $asset: 'clip' })
  assert.deepEqual(by.target.value, { $node: 'node-9' })
  assert.deepEqual(by.frames.value, [{ $asset: 'f1' }])
  assert.equal(by.frames.array, true)
  const all = ok(await callTool('component_dump', { path: 'Canvas', type: 'GameManager', all: true }, ctx))
  assert.ok(all.properties.some((p) => p.name === 'internal'))
  assert.match(failed(await callTool('component_dump', { path: 'Canvas', type: 'cc.Nope' }, ctx)), /no component of type/)
  assert.equal(dumpProperty('x', { type: 'Number', value: null }).value, null)
})

test('component_set_properties applies in order and reports where it stopped', async () => {
  const seen = []
  const { ctx } = fake({
    'scene-script/setComponentProperty': (args) => {
      if (args[0].property === 'bad') throw new Error('no such property')
      seen.push(args[0].property)
      return {}
    },
  })
  assert.deepEqual(ok(await callTool('component_set_properties', { path: 'Canvas', type: 'X', properties: { a: 1, b: 2 } }, ctx)), { ok: true, applied: ['a', 'b'] })
  const message = failed(await callTool('component_set_properties', { path: 'Canvas', type: 'X', properties: { c: 1, bad: 2, d: 3 } }, ctx))
  assert.match(message, /Failed on "bad".*applied before it: c/)
  assert.ok(!seen.includes('d'))
})

test('batch runs calls in order, stops on failure by default, and refuses nesting', async () => {
  const { calls, ctx } = fake({ 'asset-db/query-asset-info': (ref) => (ref === 'missing' ? null : { uuid: 'u' }) })
  const good = ok(await callTool('batch', { calls: [{ tool: 'selection_get' }, { tool: 'asset_info', args: { uuid: 'present' } }] }, ctx))
  assert.deepEqual([good.ok, good.completed, good.failed], [true, 2, 0])
  const stopped = ok(await callTool('batch', { calls: [{ tool: 'asset_info', args: { uuid: 'missing' } }, { tool: 'selection_get' }] }, ctx))
  assert.deepEqual([stopped.ok, stopped.failed, stopped.remaining], [false, 1, 1])
  assert.match(stopped.results[0].error, /No asset found/)
  const goOn = ok(await callTool('batch', { calls: [{ tool: 'asset_info', args: { uuid: 'missing' } }, { tool: 'selection_get' }], stopOnError: false }, ctx))
  assert.deepEqual([goOn.completed, goOn.failed, goOn.remaining], [1, 1, 0])
  const nested = ok(await callTool('batch', { calls: [{ tool: 'batch', args: { calls: [] } }] }, ctx))
  assert.match(nested.results[0].error, /nested/)
  const unknown = ok(await callTool('batch', { calls: [{ tool: 'nope' }] }, ctx))
  assert.match(unknown.results[0].error, /Unknown tool/)
  assert.ok(calls.length > 0)
  assert.equal((await callTool('batch', { calls: [] }, ctx).catch((e) => ({ thrown: e.message }))).thrown?.includes('non-empty'), true)
})

test('project_setting_list shows keys with type and preview', async () => {
  const { ctx } = fake()
  const out = ok(await callTool('project_setting_list', { package: 'project' }, ctx))
  assert.deepEqual(out.entries.map((e) => [e.key, e.type]), [['general', 'object'], ['list', 'array'], ['name', 'string'], ['nothing', 'null']])
})

test('script_diagnostics reports a type error with file and line, and honours the files filter', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ccmcp-diag-'))
  mkdirSync(join(project, 'assets', 'scripts'), { recursive: true })
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2020', lib: ['ES2020'], types: [], noEmit: true } }))
  writeFileSync(join(project, 'assets', 'scripts', 'Good.ts'), 'export const n: number = 1\n')
  writeFileSync(join(project, 'assets', 'scripts', 'Bad.ts'), "export const n: number = 'text'\n")
  const { ctx } = fake({}, { projectPath: () => project })
  const all = ok(await callTool('script_diagnostics', {}, ctx))
  assert.equal(all.filesChecked, 2)
  assert.equal(all.count, 1)
  assert.deepEqual([all.items[0].file, all.items[0].line, all.items[0].code, all.items[0].severity], ['assets/scripts/Bad.ts', 1, 2322, 'error'])
  const onlyGood = ok(await callTool('script_diagnostics', { files: ['db://assets/scripts/Good.ts'] }, ctx))
  assert.deepEqual([onlyGood.filesChecked, onlyGood.count], [1, 0])
  const fixed = (writeFileSync(join(project, 'assets', 'scripts', 'Bad.ts'), 'export const n: number = 2\n'), ok(await callTool('script_diagnostics', {}, ctx)))
  assert.equal(fixed.count, 0)
  console.error('SyntaxError: fake compile failure for the log window test')
  assert.ok(ok(await callTool('script_diagnostics', {}, ctx)).recentCreatorErrors.some((e) => e.message.includes('fake compile failure')))
  assert.equal(ok(await callTool('script_diagnostics', { sinceMinutes: -1 }, ctx)).recentCreatorErrors.length, 0, 'older errors are left out')
  const empty = fake({}, { projectPath: () => mkdtempSync(join(tmpdir(), 'ccmcp-none-')) })
  assert.match(failed(await callTool('script_diagnostics', {}, empty.ctx)), /No tsconfig/)
})

test('component_dump turns nested @ccclass values into settable objects and empty slots into null', () => {
  // Shape of the editor dump for `@property([FishSkinEntry]) skins` (each field is itself a dump entry).
  const entry = (type, value, ext) => ({ name: 'x', type, value, ...(ext ? { extends: ext } : {}) })
  const skins = dumpProperty('skins', {
    type: 'FishSkinEntry',
    isArray: true,
    value: [
      {
        type: 'FishSkinEntry',
        value: {
          fishType: entry('Integer', 1),
          skeletonData: entry('sp.SkeletonData', { uuid: 'sk1' }, ['cc.Asset']),
          skinName: entry('String', '1'),
          icon: entry('cc.SpriteFrame', { uuid: '' }, ['cc.Asset']),
          frames: { name: 'frames', type: 'cc.SpriteFrame', isArray: true, extends: ['cc.Asset'], value: [{ type: 'cc.SpriteFrame', value: { uuid: 'f1' } }] },
        },
      },
    ],
  })
  assert.deepEqual(skins.value, [{ fishType: 1, skeletonData: { $asset: 'sk1' }, skinName: '1', icon: null, frames: [{ $asset: 'f1' }] }])
  assert.equal(dumpProperty('m', { type: 'cc.Material', extends: ['cc.Asset'], value: { uuid: '' } }).value, null)
  assert.equal(dumpProperty('n', { type: 'cc.Node', value: { uuid: '' } }).value, null)
})

test('free-form value parameters declare every JSON type', () => {
  for (const name of ['component_set_property', 'node_set_property', 'project_setting_set']) {
    const tool = TOOLS.find((t) => t.name === name)
    assert.deepEqual(tool.inputSchema.properties.value.type, ['string', 'number', 'boolean', 'object', 'array', 'null'], name)
  }
})

test('log lines forwarded through console.error keep the level written in their text', async () => {
  const { levelOf } = await import('../dist/tools/editor-tools.js')
  assert.equal(levelOf('error', 'Warn: [Scene] No needs to indicate the cc.String attribute'), 'warn')
  assert.equal(levelOf('error', '[Warning] something'), 'warn')
  assert.equal(levelOf('error', 'Log: hello'), 'log')
  assert.equal(levelOf('error', 'TypeError: Cannot read properties of undefined'), 'error')
  assert.equal(levelOf('error', 'Warnings are not this'), 'error')
  assert.equal(levelOf('log', 'Warn: stays log when the channel says log'), 'log')
})

test('project_build refuses an unsaved scene unless asked to save it first', async () => {
  const { calls, ctx } = fake({ 'scene/query-dirty': true, 'builder/query-tasks-info': { list: [] } })
  assert.match(failed(await callTool('project_build', {}, ctx)), /unsaved changes/)
  assert.ok(!calls.some((c) => c.message === 'add-task'))
  const out = ok(await callTool('project_build', { save: true }, ctx))
  const order = calls.map((c) => c.message).filter((m) => m === 'save-scene' || m === 'add-task')
  assert.deepEqual(order, ['save-scene', 'add-task'])
  assert.equal(out.savedScene, true)
})
