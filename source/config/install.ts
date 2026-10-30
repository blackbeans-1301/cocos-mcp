/**
 * Filesystem side of the coding-agent config writer: detect which agents are
 * installed, read their config, write the merged result back.
 *
 * Only the file of the selected agent is written, and only via `upsertServer` /
 * `removeServer` — other keys in that file stay untouched.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AGENTS, hasServer, removeServer, upsertServer, type AgentSpec } from './agents.js'

export interface InstallContext {
  home: string
  projectPath: string
  /** Endpoint written into the agent config, e.g. `http://127.0.0.1:3945/mcp`. */
  url: string
  /** Folder holding the skills to install (one subfolder per skill). Default: `skills/` of this extension. */
  skillsSource?: string | undefined
}

export interface AgentState {
  id: string
  name: string
  file: string
  scope: 'home' | 'project'
  installed: boolean
  configured: boolean
  docs: string
  error: string
}

const resolve = (scope: 'home' | 'project', path: string, ctx: InstallContext): string =>
  scope === 'home' ? join(ctx.home, path) : join(ctx.projectPath, path)

const defaultSkillsSource = join(__dirname, '..', '..', 'skills')

/** Names of the skills we ship: every subfolder of the source that holds a SKILL.md. */
const shippedSkills = (ctx: InstallContext): string[] => {
  const source = ctx.skillsSource ?? defaultSkillsSource
  if (!existsSync(source)) return []
  return readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(source, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
}

const skillFolder = (spec: AgentSpec, ctx: InstallContext, name: string): string | undefined =>
  spec.skills ? resolve(spec.skills.scope, join(spec.skills.dir, name), ctx) : undefined

const skillsInstalled = (spec: AgentSpec, ctx: InstallContext): boolean => {
  if (!spec.skills) return false
  const names = shippedSkills(ctx)
  return names.length > 0 && names.every((name) => existsSync(join(skillFolder(spec, ctx, name) as string, 'SKILL.md')))
}

/** Copy our skills into the agent's skills folder (replacing our own copies, touching nothing else). */
const installSkills = (spec: AgentSpec, ctx: InstallContext): void => {
  if (!spec.skills) return
  const source = ctx.skillsSource ?? defaultSkillsSource
  for (const name of shippedSkills(ctx)) {
    const target = skillFolder(spec, ctx, name) as string
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(source, name), target, { recursive: true })
  }
}

/** Remove only the skill folders we ship, by name. */
const removeSkills = (spec: AgentSpec, ctx: InstallContext): void => {
  if (!spec.skills) return
  for (const name of shippedSkills(ctx)) rmSync(skillFolder(spec, ctx, name) as string, { recursive: true, force: true })
}

const fileFor = (spec: AgentSpec, ctx: InstallContext): string => resolve(spec.scope, spec.file, ctx)

export const agentStates = (ctx: InstallContext): AgentState[] =>
  AGENTS.map((spec) => {
    const file = fileFor(spec, ctx)
    let configured = false
    let error = ''
    if (existsSync(file)) {
      try {
        const text = readFileSync(file, 'utf8')
        configured = hasServer(text, spec.kind)
        // `hasServer` treats an unparsable file as "not configured"; a dry-run upsert (nothing is written)
        // surfaces the real problem so the panel can show it instead of offering a button that will fail.
        if (!configured && text.trim() !== '') upsertServer(text, spec.kind, ctx.url)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    }
    const installed = spec.detect.some((probe) => existsSync(resolve(probe.scope, probe.path, ctx)))
    return {
      id: spec.id,
      name: spec.name,
      file,
      scope: spec.scope,
      installed,
      configured,
      skillsSupported: Boolean(spec.skills),
      skills: skillsInstalled(spec, ctx),
      docs: spec.docs,
      error,
    }
  })

/** Add or remove our entry for one agent. Returns the agent's new state. */
export const configureAgent = (ctx: InstallContext, id: string, mode: 'add' | 'remove'): AgentState => {
  const spec = AGENTS.find((agent) => agent.id === id)
  if (!spec) throw new Error(`Unknown agent: ${id}`)
  const file = fileFor(spec, ctx)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const next = mode === 'add' ? upsertServer(current, spec.kind, ctx.url) : removeServer(current, spec.kind)
  if (next !== current) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, next, 'utf8')
  }
  if (mode === 'add') installSkills(spec, ctx)
  else removeSkills(spec, ctx)
  const state = agentStates(ctx).find((agent) => agent.id === id)
  if (!state) throw new Error(`Unknown agent: ${id}`)
  return state
}
