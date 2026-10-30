/**
 * "Configure" also installs the agent skills, but only into agents whose skills folder is known, and
 * "Remove" takes out only the skills we ship. Runs against a throwaway home and skills source.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENTS } from '../dist/config/agents.js'
import { agentStates, configureAgent } from '../dist/config/install.js'

const sandbox = () => {
  const skillsSource = mkdtempSync(join(tmpdir(), 'ccmcp-skills-'))
  for (const name of ['alpha', 'beta']) {
    mkdirSync(join(skillsSource, name), { recursive: true })
    writeFileSync(join(skillsSource, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill used by the install test.\n---\n`)
  }
  mkdirSync(join(skillsSource, 'not-a-skill')) // no SKILL.md: must be ignored
  return {
    home: mkdtempSync(join(tmpdir(), 'ccmcp-home-')),
    projectPath: mkdtempSync(join(tmpdir(), 'ccmcp-proj-')),
    url: 'http://127.0.0.1:3945/mcp',
    skillsSource,
  }
}

const state = (ctx, id) => agentStates(ctx).find((agent) => agent.id === id)

test('Claude Code gets the skills with the MCP entry; remove takes only ours', () => {
  const ctx = sandbox()
  const dir = join(ctx.home, '.claude', 'skills')
  mkdirSync(join(dir, 'mine'), { recursive: true })
  writeFileSync(join(dir, 'mine', 'SKILL.md'), 'user skill')

  assert.equal(state(ctx, 'claude').skills, false)
  const added = configureAgent(ctx, 'claude', 'add')
  assert.equal(added.configured, true)
  assert.equal(added.skills, true)
  assert.ok(existsSync(join(dir, 'alpha', 'SKILL.md')) && existsSync(join(dir, 'beta', 'SKILL.md')))
  assert.ok(!existsSync(join(dir, 'not-a-skill')))

  const removed = configureAgent(ctx, 'claude', 'remove')
  assert.equal(removed.configured, false)
  assert.equal(removed.skills, false)
  assert.ok(!existsSync(join(dir, 'alpha')) && !existsSync(join(dir, 'beta')))
  assert.equal(readFileSync(join(dir, 'mine', 'SKILL.md'), 'utf8'), 'user skill', "the user's own skill is untouched")
})

test('adding again refreshes our copy of a skill', () => {
  const ctx = sandbox()
  configureAgent(ctx, 'claude', 'add')
  const file = join(ctx.home, '.claude', 'skills', 'alpha', 'SKILL.md')
  writeFileSync(file, 'stale')
  configureAgent(ctx, 'claude', 'add')
  assert.match(readFileSync(file, 'utf8'), /alpha skill used by the install test/)
})

// Folders documented by each agent (checked against its docs when this was written).
const FOLDERS = {
  claude: ['home', '.claude/skills'],
  cursor: ['home', '.cursor/skills'],
  windsurf: ['home', '.codeium/windsurf/skills'],
  opencode: ['home', '.config/opencode/skills'],
  codex: ['home', '.agents/skills'],
  vscode: ['project', '.github/skills'],
}

test('every agent installs into its own documented skills folder and only removes ours', () => {
  assert.deepEqual(AGENTS.map((agent) => agent.id).sort(), Object.keys(FOLDERS).sort())
  for (const [id, [scope, dir]] of Object.entries(FOLDERS)) {
    const ctx = sandbox()
    const base = join(scope === 'home' ? ctx.home : ctx.projectPath, dir)
    const other = join(scope === 'home' ? ctx.projectPath : ctx.home, dir)
    mkdirSync(join(base, 'mine'), { recursive: true })
    writeFileSync(join(base, 'mine', 'SKILL.md'), 'user skill')

    const added = configureAgent(ctx, id, 'add')
    assert.equal(added.skillsSupported, true, id)
    assert.equal(added.skills, true, id)
    assert.ok(existsSync(join(base, 'alpha', 'SKILL.md')) && existsSync(join(base, 'beta', 'SKILL.md')), `${id} skills copied`)
    assert.ok(!existsSync(other), `${id} wrote nothing in the other scope`)

    assert.equal(configureAgent(ctx, id, 'remove').skills, false, id)
    assert.ok(!existsSync(join(base, 'alpha')) && !existsSync(join(base, 'beta')), `${id} skills removed`)
    assert.equal(readFileSync(join(base, 'mine', 'SKILL.md'), 'utf8'), 'user skill', `${id} kept the user's skill`)
  }
})

test('the skills shipped with the extension install into a fresh home', () => {
  const ctx = { ...sandbox(), skillsSource: undefined }
  const next = configureAgent(ctx, 'claude', 'add')
  assert.equal(next.skills, true)
  assert.ok(existsSync(join(ctx.home, '.claude', 'skills', 'ccreator-mcp', 'SKILL.md')))
})
