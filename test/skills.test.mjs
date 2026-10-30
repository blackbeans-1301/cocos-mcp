import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { TOOLS } = require('../dist/tools/index.js')
const toolNames = new Set(TOOLS.map((tool) => tool.name))

const root = new URL('../skills/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const skills = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())

// What a tool name looks like in prose: group_verb, e.g. node_set_transform.
const TOOL_LIKE = /\b(?:editor|scene|node|component|prefab|asset|script|project|build|selection)_[a-z_]+\b/g

test('skills exist', () => {
  assert.ok(skills.length >= 5)
})

for (const dir of skills) {
  const file = join(root, dir.name, 'SKILL.md')

  test(`${dir.name}: SKILL.md has valid frontmatter`, () => {
    assert.ok(existsSync(file), 'SKILL.md missing')
    const text = readFileSync(file, 'utf8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
    assert.ok(match, 'frontmatter missing')
    const name = /^name:\s*(.+)$/m.exec(match[1])?.[1]?.trim()
    const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim()
    assert.equal(name, dir.name, 'name must equal the folder name')
    assert.ok(description && description.length >= 40 && description.length <= 1024, 'description must be 40-1024 chars')
  })

  test(`${dir.name}: every tool it names exists`, () => {
    const text = readFileSync(file, 'utf8').replace(/^---[\s\S]*?---/, '')
    const unknown = [...new Set(text.match(TOOL_LIKE) ?? [])].filter((name) => !toolNames.has(name))
    assert.deepEqual(unknown, [], `unknown tool names: ${unknown.join(', ')}`)
  })
}
