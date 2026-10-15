/**
 * MCP over JSON-RPC 2.0 — pure, no I/O.
 *
 * Hand-written rather than using `@modelcontextprotocol/sdk`: the SDK pulls in
 * `express`, `hono`, `jose`, `ajv`, … into an extension that users Import as a
 * folder, while the protocol surface AdsCraft MCP needs is a small, stable
 * subset. This intentionally does **not** implement server-initiated SSE
 * (no progress/sampling notifications): every request returns a single JSON
 * response, which is all the `tools/*` flow needs.
 *
 * Nothing here knows about HTTP — `server.ts` owns that. That is what lets the
 * whole `initialize → tools/list → tools/call` chain be tested by calling this
 * function directly with a fake bridge.
 */
import type { ToolContext } from '../tools/types.js'
import { TOOLS, ToolInputError, callTool } from '../tools/index.js'

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0]

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

export interface ServerInfo {
  name: string
  version: string
}

export interface RpcError {
  code: number
  message: string
}

export type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: RpcError }

export interface HandleResult {
  /** `null` = notification/response (nothing to send back) → HTTP 202. */
  body: RpcResponse | null
  /** Present only on `initialize`: session id the transport puts in `Mcp-Session-Id`. */
  newSessionId?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const failure = (id: string | number | null, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

const success = (id: string | number | null, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })

const idOf = (raw: Record<string, unknown>): string | number | null => {
  const id = raw['id']
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

const negotiateProtocolVersion = (params: unknown): string => {
  const requested = isRecord(params) ? params['protocolVersion'] : undefined
  return typeof requested === 'string' && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION
}

const INSTRUCTIONS =
  'AdsCraft MCP drives the open Cocos Creator project. Start with `editor_status` and `scene_info` ' +
  'to see what is open, `node_tree` to read the hierarchy, then use the node/component/prefab/asset tools. ' +
  '`scene_script` and `editor_script` are escape hatches that run arbitrary JavaScript inside the engine ' +
  'and the editor respectively — prefer the typed tools, they validate input and are safer.'

export const handleMessage = async (
  raw: unknown,
  ctx: ToolContext,
  serverInfo: ServerInfo,
  /** Session-id factory, injected so tests are deterministic. */
  newSessionId: () => string,
): Promise<HandleResult> => {
  if (!isRecord(raw) || raw['jsonrpc'] !== '2.0' || typeof raw['method'] !== 'string') {
    return { body: failure(null, INVALID_REQUEST, 'Invalid JSON-RPC request.') }
  }

  const method = raw['method']
  const id = idOf(raw)
  const isNotification = !('id' in raw)

  switch (method) {
    case 'initialize':
      return {
        body: success(id, {
          protocolVersion: negotiateProtocolVersion(raw['params']),
          capabilities: { tools: {} },
          serverInfo,
          instructions: INSTRUCTIONS,
        }),
        newSessionId: newSessionId(),
      }
    case 'ping':
      return { body: success(id, {}) }
    case 'tools/list':
      return {
        body: success(id, {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }),
      }
    case 'tools/call': {
      const params = isRecord(raw['params']) ? raw['params'] : {}
      const name = params['name']
      if (typeof name !== 'string') return { body: failure(id, INVALID_PARAMS, '"name" is required.') }
      try {
        const called = await callTool(name, params['arguments'], ctx)
        if ('toolError' in called) {
          return { body: success(id, { content: [{ type: 'text', text: called.toolError }], isError: true }) }
        }
        return { body: success(id, { content: [{ type: 'text', text: JSON.stringify(called.result, null, 2) }] }) }
      } catch (err) {
        if (err instanceof ToolInputError) return { body: failure(id, INVALID_PARAMS, err.message) }
        throw err
      }
    }
    case 'resources/list':
      return { body: success(id, { resources: [] }) }
    case 'resources/templates/list':
      return { body: success(id, { resourceTemplates: [] }) }
    case 'prompts/list':
      return { body: success(id, { prompts: [] }) }
    case 'logging/setLevel':
      return { body: success(id, {}) }
    default:
      return isNotification ? { body: null } : { body: failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`) }
  }
}

export const parseError = (): RpcResponse => failure(null, PARSE_ERROR, 'Parse error.')
export const invalidRequest = (message: string): RpcResponse => failure(null, INVALID_REQUEST, message)
