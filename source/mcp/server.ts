/**
 * Streamable HTTP transport for the MCP server, bound to `127.0.0.1`.
 *
 * HTTP (not stdio) because the server lives **inside the editor process**: an AI
 * client connects to a local port it does not spawn. This is the shape every
 * other Cocos Creator MCP extension uses, and it is what lets a client attach to
 * a running editor.
 *
 * Only the loopback interface is bound, and non-loopback `Origin`/`Host` headers
 * are rejected: this port can create/delete assets and run scripts in the open
 * project, so a random web page on the machine must not be able to reach it
 * (MCP's DNS-rebinding guidance). `GET /mcp` returns `405` — no server-initiated
 * SSE stream, every request answers with a single JSON body.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ToolContext } from '../tools/types.js'
import { handleMessage, invalidRequest, parseError, type RpcResponse, type ServerInfo } from './protocol.js'

export const MCP_PATH = '/mcp'

const MAX_BODY_BYTES = 1 << 20
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1'])

export interface McpHttpOptions {
  /** Preferred port; if busy, `startMcpHttp` falls back to an ephemeral one. */
  port: number
  serverInfo: ServerInfo
}

export interface McpHttpHandle {
  url: string
  port: number
  close(): Promise<void>
}

const hostNameOf = (value: string | undefined): string => {
  if (!value) return ''
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return (end === -1 ? value : value.slice(1, end)).toLowerCase()
  }
  const colon = value.indexOf(':')
  return (colon === -1 ? value : value.slice(0, colon)).toLowerCase()
}

/** No `Origin` = not a browser (CLI/AI client) → allow. Present → must be loopback. */
const originAllowed = (origin: string | undefined): boolean => {
  if (origin === undefined) return true
  try {
    return LOOPBACK_NAMES.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

const sendJson = (
  res: ServerResponse,
  status: number,
  body: RpcResponse,
  headers: Record<string, string> = {},
): void => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    ...headers,
  })
  res.end(payload)
}

/** Reads the request body; `null` once it exceeds the cap (socket destroyed). */
const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

export const startMcpHttp = async (ctx: ToolContext, options: McpHttpOptions): Promise<McpHttpHandle> => {
  const sessions = new Set<string>()
  const serverInfo = options.serverInfo

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!LOOPBACK_NAMES.has(hostNameOf(req.headers.host))) {
      sendJson(res, 403, invalidRequest('Forbidden host.'))
      return
    }
    if (!originAllowed(req.headers.origin)) {
      sendJson(res, 403, invalidRequest('Forbidden origin.'))
      return
    }

    const path = (req.url ?? '').split('?')[0]
    if (path !== MCP_PATH) {
      sendJson(res, 404, invalidRequest(`Not found: ${path}`))
      return
    }

    const header = req.headers['mcp-session-id']
    const sessionId = Array.isArray(header) ? header[0] : header
    if (sessionId !== undefined && !sessions.has(sessionId)) {
      sendJson(res, 404, invalidRequest('Unknown session.'))
      return
    }

    if (req.method === 'DELETE') {
      if (sessionId !== undefined) sessions.delete(sessionId)
      res.writeHead(204).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST, DELETE' }).end()
      return
    }

    const raw = await readBody(req)
    if (raw === null) {
      sendJson(res, 413, invalidRequest('Request body too large.'))
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      sendJson(res, 400, parseError())
      return
    }

    const result = await handleMessage(parsed, ctx, serverInfo, randomUUID)
    const headers: Record<string, string> = {}
    if (result.newSessionId !== undefined) {
      sessions.add(result.newSessionId)
      headers['mcp-session-id'] = result.newSessionId
    }
    if (result.body === null) {
      res.writeHead(202, headers).end()
      return
    }
    sendJson(res, 200, result.body, headers)
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err)
      if (res.headersSent) res.end()
      else sendJson(res, 500, invalidRequest(`Internal error: ${detail}`))
    })
  })

  const listen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve((server.address() as AddressInfo).port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })

  let boundPort: number
  try {
    boundPort = await listen(options.port)
  } catch (err) {
    // Configured port taken (a second editor, another tool): fall back to a free
    // one rather than refusing to start; the panel shows the real port.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') boundPort = await listen(0)
    else throw err
  }

  return {
    url: `http://127.0.0.1:${boundPort}${MCP_PATH}`,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
      }),
  }
}
