/**
 * MCP server lifecycle: enable/disable/status, one server per editor process.
 * `startMcp` is idempotent — starting while running is a no-op, concurrent starts
 * share a single attempt.
 */
import type { ToolContext } from '../tools/types.js'
import { type McpHttpHandle, startMcpHttp } from './server.js'
import type { ServerInfo } from './protocol.js'

/**
 * Default port.
 *
 * `3000` (what most Cocos MCP extensions use) is the single worst choice in this
 * range — Next.js, Vercel, CRA, Rails and Grafana all default to it. `3945` is
 * obscure: no popular dev server claims it, and it is not an IANA-registered
 * port (unlike 3306/3389/3478 in this block). Override with the
 * `CCREATOR_MCP_PORT` environment variable when it still clashes.
 */
export const DEFAULT_MCP_PORT = 3945

export interface McpSessionStatus {
  running: boolean
  /** Empty until started. */
  url: string
  port: number
  error: string
}

let handle: McpHttpHandle | null = null
let starting: Promise<void> | null = null
let lastError = ''
let configuredPort = DEFAULT_MCP_PORT

export const mcpStatus = (): McpSessionStatus => ({
  running: handle !== null,
  url: handle?.url ?? '',
  port: handle?.port ?? configuredPort,
  error: lastError,
})

export const startMcp = (
  ctx: ToolContext,
  options: { port?: number; serverInfo?: ServerInfo } = {},
): Promise<void> => {
  if (handle) return Promise.resolve()
  if (starting) return starting
  configuredPort = options.port ?? configuredPort
  const serverInfo = options.serverInfo ?? { name: 'ccreator-mcp', version: '0.0.0' }
  const attempt = (async () => {
    try {
      handle = await startMcpHttp(ctx, { port: configuredPort, serverInfo })
      lastError = ''
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      starting = null
    }
  })()
  starting = attempt
  return attempt
}

export const stopMcp = async (): Promise<void> => {
  const current = handle
  handle = null
  if (current) await current.close()
}
