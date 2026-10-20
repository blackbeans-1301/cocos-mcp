/**
 * Coding-agent config writer: merge/remove behaviour, JSON and TOML, plus the
 * "never touch anything else" guarantees. Pure string functions — no filesystem.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENTS, hasServer, removeServer, upsertServer } from '../dist/config/agents.js'

const URL = 'http://127.0.0.1:3945/mcp'

test('agent specs are well-formed and unique', () => {
  const ids = AGENTS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const agent of AGENTS) {
    assert.ok(agent.name && agent.file && agent.docs.startsWith('http'))
    assert.ok(agent.detect.length > 0)
  }
})

test('upserts into an empty mcpServers config', () => {
  const out = JSON.parse(upsertServer('', 'mcpServers', URL))
  assert.deepEqual(out.mcpServers["ccreator-mcp"], { type: 'http', url: URL })
})

test('preserves other servers and keys', () => {
  const original = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }, null, 2)
  const out = JSON.parse(upsertServer(original, 'mcpServers', URL))
  assert.equal(out.theme, 'dark')
  assert.deepEqual(out.mcpServers.other, { command: 'x' })
  assert.deepEqual(out.mcpServers["ccreator-mcp"], { type: 'http', url: URL })
})

test('updates the url in place', () => {
  const first = upsertServer('', 'mcpServers', URL)
  const second = JSON.parse(upsertServer(first, 'mcpServers', 'http://127.0.0.1:4000/mcp'))
  assert.equal(second.mcpServers["ccreator-mcp"].url, 'http://127.0.0.1:4000/mcp')
})

test('refuses invalid JSON instead of clobbering it', () => {
  assert.throws(() => upsertServer('{ not json', 'mcpServers', URL), /not valid JSON/)
})

test('VS Code uses a "servers" bucket, OpenCode uses "mcp"', () => {
  assert.ok(JSON.parse(upsertServer('', 'vscode', URL)).servers["ccreator-mcp"])
  assert.deepEqual(JSON.parse(upsertServer('', 'opencode', URL)).mcp["ccreator-mcp"], {
    type: 'remote',
    url: URL,
    enabled: true,
  })
})

test('TOML: adds a block, updates it, and removes it without touching other tables', () => {
  const start = 'model = "gpt-5"\n'
  const added = upsertServer(start, 'toml', URL)
  assert.match(added, /\[mcp_servers.ccreator-mcp\]\nurl = "http:\/\/127\.0\.0\.1:3945\/mcp"/)
  assert.match(added, /model = "gpt-5"/)
  assert.ok(hasServer(added, 'toml'))

  const updated = upsertServer(added, 'toml', 'http://127.0.0.1:4000/mcp')
  assert.equal(updated.match(/\[mcp_servers.ccreator-mcp\]/g).length, 1)
  assert.match(updated, /4000/)

  const removed = removeServer(updated, 'toml')
  assert.ok(!hasServer(removed, 'toml'))
  assert.match(removed, /model = "gpt-5"/)
})

test('remove is a no-op when our entry is absent, and hasServer agrees', () => {
  const original = '{\n  "mcpServers": {}\n}\n'
  assert.equal(hasServer(original, 'mcpServers'), false)
  assert.equal(removeServer(original, 'mcpServers'), original)
  assert.equal(hasServer(upsertServer(original, 'mcpServers', URL), 'mcpServers'), true)
})
