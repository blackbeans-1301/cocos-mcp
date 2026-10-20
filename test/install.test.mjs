/**
 * Filesystem side of "Configure coding agents" (what the panel buttons call), against a throwaway
 * home and project folder — never the real ones — plus a static check that the panel only looks up
 * ids its template defines (a missing id fails silently in the DOM).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENTS } from '../dist/config/agents.js'
import { agentStates, configureAgent } from '../dist/config/install.js'

const URL_A = 'http://127.0.0.1:3945/mcp'
const URL_B = 'http://127.0.0.1:4001/mcp'

const sandbox = () => ({ home: mkdtempSync(join(tmpdir(), 'ccmcp-home-')), projectPath: mkdtempSync(join(tmpdir(), 'ccmcp-proj-')), url: URL_A })

const place = (ctx, scope, path, text = '') => {
  const file = join(scope === 'home' ? ctx.home : ctx.projectPath, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

test('every agent can be added, re-pointed to a new port and removed', () => {
  for (const spec of AGENTS) {
    const ctx = sandbox()
    assert.equal(agentStates(ctx).find((a) => a.id === spec.id).configured, false, `${spec.id} starts unconfigured`)
    assert.equal(configureAgent(ctx, spec.id, 'add').configured, true, `${spec.id} add`)
    configureAgent(ctx, spec.id, 'add')
    const file = agentStates(ctx).find((a) => a.id === spec.id).file
    assert.ok(readFileSync(file, 'utf8').includes(URL_A), `${spec.id} wrote the url`)
    assert.equal(readFileSync(file, 'utf8').split(URL_A).length - 1, 1, `${spec.id} add twice does not duplicate`)
    configureAgent({ ...ctx, url: URL_B }, spec.id, 'add')
    const moved = readFileSync(file, 'utf8')
    assert.ok(moved.includes(URL_B) && !moved.includes(URL_A), `${spec.id} follows a port change`)
    assert.equal(configureAgent(ctx, spec.id, 'remove').configured, false, `${spec.id} remove`)
  }
})

test('detection looks for the agent on disk, and an existing config is preserved', () => {
  const ctx = sandbox()
  const claude = AGENTS.find((a) => a.id === 'claude')
  assert.equal(agentStates(ctx).find((a) => a.id === 'claude').installed, false)
  const probe = claude.detect[0]
  place(ctx, probe.scope, probe.path, '{}')
  assert.equal(agentStates(ctx).find((a) => a.id === 'claude').installed, true)
  const file = agentStates(ctx).find((a) => a.id === 'claude').file
  place(ctx, claude.scope, claude.file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }))
  configureAgent(ctx, 'claude', 'add')
  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(after.theme, 'dark')
  assert.deepEqual(after.mcpServers.other, { command: 'x' })
  assert.equal(after.mcpServers['ccreator-mcp'].url, URL_A)
  configureAgent(ctx, 'claude', 'remove')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).mcpServers, { other: { command: 'x' } })
})

test('a broken config is reported, not overwritten; an unknown agent is rejected', () => {
  const ctx = sandbox()
  const claude = AGENTS.find((a) => a.id === 'claude')
  place(ctx, claude.scope, claude.file, '{ not json')
  assert.ok(agentStates(ctx).find((a) => a.id === 'claude').error)
  assert.throws(() => configureAgent(ctx, 'claude', 'add'), /not valid JSON/)
  assert.equal(readFileSync(agentStates(ctx).find((a) => a.id === 'claude').file, 'utf8'), '{ not json')
  assert.throws(() => configureAgent(ctx, 'nope', 'add'), /Unknown agent/)
  assert.ok(!existsSync(join(ctx.home, 'nope')))
})

test('the panel only looks up ids that its template defines', () => {
  const source = readFileSync(fileURLToPath(new URL('../source/panel/index.ts', import.meta.url)), 'utf8')
  const template = source.slice(source.indexOf('export const template'), source.indexOf('export const style'))
  const defined = new Set([...template.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]))
  const used = new Set([...source.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))
  assert.ok(used.size > 10)
  for (const id of used) assert.ok(defined.has(id), `panel looks up #${id} but the template has no such element`)
  assert.ok(template.includes('class="mcp-root"'), 'ready() locates the panel by the .mcp-root marker')
})
