/**
 * Tool-level tests with a fake bridge: each tool must reach the right editor message
 * with the right arguments. (Real message names are checked against Creator separately.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callTool, TOOLS } from '../dist/tools/index.js'

const fake = (replies = {}) => {
  const calls = []
  const bridge = {
    request: async (pkg, message, ...args) => {
      calls.push({ pkg, message, args })
      const key = `${pkg}/${message}`
      return key in replies ? replies[key] : { pkg, message }
    },
    scene: async (method, args) => {
      calls.push({ pkg: 'scene-script', message: method, args })
      return replies[`scene-script/${method}`] ?? { uuid: 'node-1' }
    },
    selection: () => ['a', 'b'],
    select: (uuids) => calls.push({ pkg: 'selection', message: 'select', args: [uuids] }),
    getProjectSetting: async () => 42,
    setProjectSetting: async (...args) => calls.push({ pkg: 'profile', message: 'set', args }),
    projectPath: () => '/tmp/project',
    editorVersion: () => '3.8.8',
  }
  return { calls, ctx: { bridge } }
}

test('every tool advertises a closed object schema', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, 'object', tool.name)
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
  }
})

test('undo/redo go to the scene module', async () => {
  const { calls, ctx } = fake()
  await callTool('editor_undo', {}, ctx)
  await callTool('editor_redo', {}, ctx)
  assert.deepEqual(calls.map((c) => [c.pkg, c.message]), [['scene', 'undo'], ['scene', 'redo']])
})

test('prefab_revert sends restore-prefab with (instance root uuid, prefab asset uuid)', async () => {
  const { calls, ctx } = fake({ 'scene-script/getPrefabInfo': { rootUuid: 'root-1', assetUuid: 'prefab-1' } })
  const out = await callTool('prefab_revert', { path: 'Canvas/Enemy' }, ctx)
  assert.deepEqual(out, { result: { ok: true, uuid: 'root-1', prefab: 'prefab-1' } })
  assert.deepEqual(calls.at(-1), { pkg: 'scene', message: 'restore-prefab', args: ['root-1', 'prefab-1'] })
})

test('prefab_apply resolves a path to a uuid, then sends apply-prefab', async () => {
  const { calls, ctx } = fake()
  await callTool('prefab_apply', { path: 'Canvas/Enemy' }, ctx)
  assert.deepEqual(calls.at(-1), { pkg: 'scene', message: 'apply-prefab', args: ['node-1'] })
})

test('prefab_create_from_node sends (uuid, url) positionally and reports the prefab uuid', async () => {
  const { calls, ctx } = fake({ 'asset-db/query-asset-info': { uuid: 'p1' } })
  const out = await callTool('prefab_create_from_node', { uuid: 'n1', url: 'db://assets/E.prefab' }, ctx)
  assert.deepEqual(calls.find((c) => c.message === 'create-prefab'), { pkg: 'scene', message: 'create-prefab', args: ['n1', 'db://assets/E.prefab'] })
  assert.equal(out.result.prefabUuid, 'p1')
})

test('asset operations that answer null still confirm what they did', async () => {
  const { ctx } = fake({ 'asset-db/move-asset': null, 'asset-db/reimport-asset': null })
  assert.equal((await callTool('asset_move', { source: 'db://a', target: 'db://b' }, ctx)).result.ok, true)
  assert.equal((await callTool('asset_reimport', { url: 'db://a' }, ctx)).result.ok, true)
})

test('asset_create sends string content and overwrite', async () => {
  const { calls, ctx } = fake()
  await callTool('asset_create', { url: 'db://assets/a.json', content: { x: 1 } }, ctx)
  const call = calls.at(-1)
  assert.equal(call.message, 'create-asset')
  assert.equal(typeof call.args[1], 'string')
  assert.deepEqual(JSON.parse(call.args[1]), { x: 1 })
  assert.deepEqual(call.args[2], { overwrite: true })
})

test('script_write creates a new script and overwrites an existing one', async () => {
  const created = fake({ 'asset-db/query-asset-info': null, 'asset-db/create-asset': { uuid: 'new' } })
  assert.deepEqual((await callTool('script_write', { url: 'db://assets/A.ts', content: 'x' }, created.ctx)).result, {
    url: 'db://assets/A.ts', uuid: 'new', created: true,
  })
  const existing = fake({ 'asset-db/query-asset-info': { uuid: 'old' } })
  const out = await callTool('script_write', { url: 'db://assets/A.ts', content: 'y' }, existing.ctx)
  assert.equal(out.result.created, false)
  assert.deepEqual(existing.calls.at(-1), { pkg: 'asset-db', message: 'save-asset', args: ['old', 'y'] })
})

test('script_write refuses a non-script url', async () => {
  const { ctx } = fake()
  const out = await callTool('script_write', { url: 'db://assets/A.png', content: 'x' }, ctx)
  assert.ok('toolError' in out)
})

test('asset_dependencies picks the users message when asked', async () => {
  const { calls, ctx } = fake({ 'asset-db/query-asset-info': { uuid: 'u1' } })
  await callTool('asset_dependencies', { url: 'db://assets/a.png', users: true }, ctx)
  assert.equal(calls.at(-1).message, 'query-asset-users')
})

test('node_create_tree and node_set_sibling_index reach the scene script', async () => {
  const { calls, ctx } = fake()
  await callTool('node_create_tree', { tree: { name: 'Root', children: [{ name: 'Kid' }] }, parentPath: 'Canvas' }, ctx)
  assert.equal(calls.at(-1).message, 'createNodeTree')
  assert.equal(calls.at(-1).args[0].parentPath, 'Canvas')
  await callTool('node_set_sibling_index', { path: 'Canvas/A', index: 0 }, ctx)
  assert.deepEqual(calls.at(-1).args[0], { path: 'Canvas/A', index: 0 })
})

test('selection and project settings use the bridge helpers', async () => {
  const { calls, ctx } = fake()
  assert.deepEqual((await callTool('selection_get', {}, ctx)).result, { nodes: ['a', 'b'] })
  await callTool('selection_set', { uuids: ['x'] }, ctx)
  assert.deepEqual(calls.at(-1).args, [['x']])
  assert.deepEqual((await callTool('project_setting_get', { package: 'project', key: 'k' }, ctx)).result, { value: 42 })
})

test('a tool that returns nothing still yields a serialisable result', async () => {
  const { ctx } = fake({ 'scene/create-prefab': undefined })
  const out = await callTool('editor_undo', {}, ctx)
  assert.ok(JSON.stringify(out) !== undefined)
})

test('prefab_apply and prefab_unlink refuse a node that is not a prefab instance', async () => {
  const { calls, ctx } = fake()
  ctx.bridge.scene = async (method, args) => {
    calls.push({ pkg: 'scene-script', message: method, args })
    if (method === 'getPrefabInfo') throw new Error('Node "Plain" is not part of a prefab instance.')
    return { uuid: 'node-1' }
  }
  for (const name of ['prefab_apply', 'prefab_unlink']) {
    const out = await callTool(name, { uuid: 'node-1' }, ctx)
    assert.match(out.toolError ?? '', /not part of a prefab instance/, name)
  }
  assert.ok(!calls.some((c) => c.message === 'apply-prefab' || c.message === 'unlink-prefab'))
})
