/**
 * Tool registry — the single list the MCP server advertises and dispatches to.
 */
import type { ToolContext, ToolDef } from './types.js'
import { ToolInputError, asObject, optionalArray } from './types.js'
import { editorTools } from './editor-tools.js'
import { sceneTools } from './scene-tools.js'
import { nodeTools } from './node-tools.js'
import { componentTools } from './component-tools.js'
import { prefabTools } from './prefab-tools.js'
import { assetTools } from './asset-tools.js'
import { scriptTools } from './script-tools.js'
import { buildTools } from './build-tools.js'
import { diagnosticsTools } from './diagnostics-tools.js'

export { ToolInputError } from './types.js'
export type { ToolContext, ToolDef, JsonSchema } from './types.js'

const MAX_BATCH = 50

/**
 * Run several tools in one request — saves round trips when an edit is many small steps.
 * Defined here because it dispatches to the other tools (a separate file would import this one in a cycle).
 * Each call is still its own undo step.
 */
const batchTool: ToolDef = {
  name: 'batch',
  description: `Run up to ${MAX_BATCH} tool calls in order in one request. Returns one result per call; by default it stops at the first failure. Each call is still its own undo step.`,
  inputSchema: {
    type: 'object',
    properties: {
      calls: {
        type: 'array',
        description: 'Calls to run, in order.',
        items: {
          type: 'object',
          properties: { tool: { type: 'string', description: 'Tool name.' }, args: { type: 'object', description: 'Tool arguments.' } },
          required: ['tool'],
          additionalProperties: false,
        },
      },
      stopOnError: { type: 'boolean', description: 'Stop at the first failing call (default true).' },
    },
    required: ['calls'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const calls = optionalArray(args, 'calls')
    if (!calls || calls.length === 0) throw new ToolInputError('"calls" must be a non-empty array.')
    if (calls.length > MAX_BATCH) throw new ToolInputError(`At most ${MAX_BATCH} calls per batch.`)
    const stopOnError = args['stopOnError'] !== false
    const results: Array<Record<string, unknown>> = []
    for (const raw of calls) {
      const call = asObject(raw)
      const tool = typeof call['tool'] === 'string' ? call['tool'] : ''
      if (tool === 'batch') {
        results.push({ tool, ok: false, error: 'batch cannot be nested.' })
      } else {
        try {
          const outcome = await callTool(tool, call['args'], ctx)
          results.push('toolError' in outcome ? { tool, ok: false, error: outcome.toolError } : { tool, ok: true, result: outcome.result })
        } catch (err) {
          results.push({ tool, ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (stopOnError && results[results.length - 1]?.['ok'] === false) break
    }
    const failed = results.filter((entry) => entry['ok'] === false).length
    return { ok: failed === 0, completed: results.length - failed, failed, remaining: calls.length - results.length, results }
  },
}

export const TOOLS: ToolDef[] = [
  ...editorTools,
  ...sceneTools,
  ...nodeTools,
  ...componentTools,
  ...prefabTools,
  ...assetTools,
  ...scriptTools,
  ...buildTools,
  ...diagnosticsTools,
  batchTool,
]

// Duplicate names would make tools/list ambiguous and the bug hard to see; fail loud at load.
{
  const seen = new Set<string>()
  for (const tool of TOOLS) {
    if (seen.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`)
    seen.add(tool.name)
  }
}

export const findTool = (name: string): ToolDef | undefined => TOOLS.find((tool) => tool.name === name)

/**
 * Run a tool. Bad input (`ToolInputError`) is thrown so the protocol layer can
 * answer `-32602`; a tool that fails while running (editor error, bad editor
 * build) is returned as `toolError` so it becomes a tool result with
 * `isError: true` — the MCP convention for business errors.
 */
export const callTool = async (
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<{ result: unknown } | { toolError: string }> => {
  const tool = findTool(name)
  if (!tool) throw new ToolInputError(`Unknown tool: ${name}`)
  try {
    return { result: await tool.handler(asObject(args), ctx) }
  } catch (err) {
    if (err instanceof ToolInputError) throw err
    return { toolError: err instanceof Error ? err.message : String(err) }
  }
}
