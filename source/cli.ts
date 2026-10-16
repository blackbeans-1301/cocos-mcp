#!/usr/bin/env node
/**
 * Standalone coding-agent configurator — same writer as the panel, usable from a
 * shell so it can be dropped into a dotfiles / onboarding script.
 *
 *   node dist/cli.js                 # add to every detected agent
 *   node dist/cli.js --list          # show agents and their state, write nothing
 *   node dist/cli.js --remove        # remove from every agent
 *   node dist/cli.js --agent cursor  # only these agents (repeatable)
 *   node dist/cli.js --url http://127.0.0.1:4000/mcp
 */
import { homedir } from 'node:os'
import { agentStates, configureAgent, type InstallContext } from './config/install.js'
import { DEFAULT_MCP_PORT } from './mcp/session.js'

const args = process.argv.slice(2)
const has = (flag: string): boolean => args.includes(flag)
const valueOf = (flag: string): string | undefined => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const allValues = (flag: string): string[] =>
  args.reduce<string[]>((out, arg, index) => (arg === flag && args[index + 1] ? [...out, args[index + 1] as string] : out), [])

const port = valueOf('--port') ?? process.env['ADSCRAFT_MCP_PORT'] ?? String(DEFAULT_MCP_PORT)
const url = valueOf('--url') ?? `http://127.0.0.1:${port}/mcp`
const wanted = allValues('--agent')
const mode: 'add' | 'remove' = has('--remove') ? 'remove' : 'add'

const ctx: InstallContext = { home: homedir(), projectPath: process.cwd(), url }

const format = (state: ReturnType<typeof agentStates>[number]): string => {
  const mark = state.configured ? '✓ configured' : state.installed ? '· detected' : '  not found'
  return `  ${mark.padEnd(13)} ${state.name.padEnd(20)} ${state.file}`
}

if (has('--help') || has('-h')) {
  console.log('usage: node dist/cli.js [--list] [--remove] [--agent <id>]... [--url <endpoint>] [--port <n>]')
  process.exit(0)
}

const selected = (states: ReturnType<typeof agentStates>): ReturnType<typeof agentStates> =>
  wanted.length === 0 ? states : states.filter((state) => wanted.includes(state.id))

if (has('--list')) {
  console.log(`Endpoint: ${url}\n`)
  for (const state of agentStates(ctx)) console.log(format(state))
  process.exit(0)
}

let touched = 0
for (const state of selected(agentStates(ctx))) {
  if (mode === 'add' && !state.installed && wanted.length === 0) continue
  try {
    const next = configureAgent(ctx, state.id, mode)
    console.log(`${mode === 'add' ? '✓' : '−'} ${next.name} → ${next.file}`)
    touched += 1
  } catch (err) {
    console.error(`✗ ${state.name}: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

if (touched === 0) console.log('Nothing to do. Use --list to see the agents found on this machine.')
