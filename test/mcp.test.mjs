/**
 * Protocol + transport tests, run with `node --test` OUTSIDE Cocos Creator.
 *
 * The MCP server has no editor dependency: it talks to a `Bridge`, so a fake
 * bridge here exercises the whole path a real AI client takes —
 * `initialize → tools/list → tools/call` — over a real HTTP socket.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleMessage } from '../dist/mcp/protocol.js'
import { startMcpHttp } from '../dist/mcp/server.js'
import { TOOLS } from '../dist/tools/index.js'

/** Records every call and returns canned data instead of touching an editor. */
const createFakeBridge = () => {
  const calls = []
  return {
    calls,
    bridge: {
      request: async (pkg, message, ...args) => {
        calls.push({ pkg, message, args })
        if (message === 'query-assets') return [{ uuid: 'u1', url: 'db://assets/A.scene', type: 'cc.SceneAsset' }]
        return { pkg, message }
      },
      scene: async (method, args) => {
        calls.push({ pkg: 'scene-script', message: method, args })
        return { method, args }
      },
      projectPath: () => '/tmp/project',
      editorVersion: () => '3.8.8',
    },
  }
}

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
const session = () => 'session-1'

test('tool registry: names are unique and every tool documents itself', () => {
  const names = TOOLS.map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(TOOLS.length >= 30, `expected a broad tool set, got ${TOOLS.length}`)
  for (const tool of TOOLS) {
    assert.ok(tool.description.length > 10, `${tool.name} needs a description`)
    assert.equal(tool.inputSchema.type, 'object')
  }
})

test('initialize negotiates the protocol version and issues a session id', async () => {
  const { bridge } = createFakeBridge()
  const result = await handleMessage(
    request(1, 'initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'test' } }),
    { bridge },
    { name: 'ads-craft-mcp', version: '0.1.0' },
    session,
  )
  assert.equal(result.newSessionId, 'session-1')
  assert.equal(result.body.result.protocolVersion, '2025-03-26')
  assert.deepEqual(result.body.result.serverInfo, { name: 'ads-craft-mcp', version: '0.1.0' })
})

test('initialize falls back to the latest version when the client asks for an unknown one', async () => {
  const { bridge } = createFakeBridge()
  const result = await handleMessage(request(1, 'initialize', { protocolVersion: '1.0' }), { bridge }, { name: 'x', version: '1' }, session)
  assert.equal(result.body.result.protocolVersion, '2025-06-18')
})

test('tools/list returns JSON schemas', async () => {
  const { bridge } = createFakeBridge()
  const result = await handleMessage(request(2, 'tools/list'), { bridge }, { name: 'x', version: '1' }, session)
  const names = result.body.result.tools.map((t) => t.name)
  assert.ok(names.includes('node_create'))
  assert.ok(names.includes('component_set_property'))
  assert.ok(names.includes('asset_query'))
  const create = result.body.result.tools.find((t) => t.name === 'node_create')
  assert.equal(create.inputSchema.additionalProperties, false)
})

test('tools/call runs the tool and returns JSON text content', async () => {
  const { bridge } = createFakeBridge()
  const result = await handleMessage(
    request(3, 'tools/call', { name: 'editor_status', arguments: {} }),
    { bridge },
    { name: 'x', version: '1' },
    session,
  )
  const payload = JSON.parse(result.body.result.content[0].text)
  assert.equal(payload.editorVersion, '3.8.8')
  assert.equal(payload.projectPath, '/tmp/project')
})

test('tools/call with bad input is an invalid-params error, not a tool result', async () => {
  const { bridge } = createFakeBridge()
  const result = await handleMessage(
    request(4, 'tools/call', { name: 'component_add', arguments: { path: 'Canvas' } }),
    { bridge },
    { name: 'x', version: '1' },
    session,
  )
  assert.equal(result.body.error.code, -32602)
  assert.match(result.body.error.message, /must be a non-empty string/)
})

test('unknown tool name is an invalid-params error', async () => {
  const { bridge } = createFakeBridge()
  const result = await handleMessage(request(5, 'tools/call', { name: 'nope' }), { bridge }, { name: 'x', version: '1' }, session)
  assert.equal(result.body.error.code, -32602)
})

test('a tool that fails while running comes back as isError, not a protocol error', async () => {
  const bridge = {
    ...createFakeBridge().bridge,
    scene: async () => {
      throw new Error('No scene is open in the editor.')
    },
  }
  const result = await handleMessage(request(6, 'tools/call', { name: 'scene_info', arguments: {} }), { bridge }, { name: 'x', version: '1' }, session)
  assert.equal(result.body.result.isError, true)
  assert.match(result.body.result.content[0].text, /No scene is open/)
})

test('unknown method is method-not-found; notifications get no body', async () => {
  const { bridge } = createFakeBridge()
  const missing = await handleMessage(request(7, 'does/not/exist'), { bridge }, { name: 'x', version: '1' }, session)
  assert.equal(missing.body.error.code, -32601)
  const note = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, { bridge }, { name: 'x', version: '1' }, session)
  assert.equal(note.body, null)
})

test('HTTP transport: session header, tools/call, notification 202, origin guard', async () => {
  const { bridge, calls } = createFakeBridge()
  const handle = await startMcpHttp({ bridge }, { port: 0, serverInfo: { name: 'ads-craft-mcp', version: '0.1.0' } })
  try {
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

    const init = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(request(1, 'initialize', { protocolVersion: '2025-06-18' })),
    })
    assert.equal(init.status, 200)
    const sessionId = init.headers.get('mcp-session-id')
    assert.ok(sessionId)

    const note = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    assert.equal(note.status, 202)

    const call = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': sessionId },
      body: JSON.stringify(request(2, 'tools/call', { name: 'scene_list', arguments: {} })),
    })
    const body = await call.json()
    assert.equal(body.id, 2)
    assert.ok(calls.some((c) => c.pkg === 'asset-db' && c.message === 'query-assets'))

    const forbidden = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify(request(3, 'tools/list')),
    })
    assert.equal(forbidden.status, 403)

    const get = await fetch(handle.url, { method: 'GET' })
    assert.equal(get.status, 405)

    const del = await fetch(handle.url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } })
    assert.equal(del.status, 204)
  } finally {
    await handle.close()
  }
})
