/**
 * Filesystem side of the coding-agent config writer: detect which agents are
 * installed, read their config, write the merged result back.
 *
 * Only the file of the selected agent is written, and only via `upsertServer` /
 * `removeServer` — other keys in that file stay untouched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AGENTS, hasServer, removeServer, upsertServer, type AgentSpec } from './agents.js'

export interface InstallContext {
  home: string
  projectPath: string
  /** Endpoint written into the agent config, e.g. `http://127.0.0.1:3945/mcp`. */
  url: string
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

const fileFor = (spec: AgentSpec, ctx: InstallContext): string => resolve(spec.scope, spec.file, ctx)

export const agentStates = (ctx: InstallContext): AgentState[] =>
  AGENTS.map((spec) => {
    const file = fileFor(spec, ctx)
    let configured = false
    let error = ''
    if (existsSync(file)) {
      try {
        configured = hasServer(readFileSync(file, 'utf8'), spec.kind)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    }
    const installed = spec.detect.some((probe) => existsSync(resolve(probe.scope, probe.path, ctx)))
    return { id: spec.id, name: spec.name, file, scope: spec.scope, installed, configured, docs: spec.docs, error }
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
  const state = agentStates(ctx).find((agent) => agent.id === id)
  if (!state) throw new Error(`Unknown agent: ${id}`)
  return state
}
