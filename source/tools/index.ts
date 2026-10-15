/**
 * Tool registry — the single list the MCP server advertises and dispatches to.
 */
import type { ToolContext, ToolDef } from './types.js'
import { ToolInputError, asObject } from './types.js'
import { editorTools } from './editor-tools.js'
import { sceneTools } from './scene-tools.js'
import { nodeTools } from './node-tools.js'
import { componentTools } from './component-tools.js'
import { prefabTools } from './prefab-tools.js'
import { assetTools } from './asset-tools.js'

export { ToolInputError } from './types.js'
export type { ToolContext, ToolDef, JsonSchema } from './types.js'

export const TOOLS: ToolDef[] = [
  ...editorTools,
  ...sceneTools,
  ...nodeTools,
  ...componentTools,
  ...prefabTools,
  ...assetTools,
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
