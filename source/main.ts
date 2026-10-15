/**
 * Extension lifecycle: start the MCP server when the editor loads (if enabled),
 * expose the panel messages, stop the server on unload.
 *
 * The server starts by default: the whole point is that an AI client can attach
 * to a running editor without extra steps. It can be turned off in the panel,
 * and the choice is remembered per project.
 */
import { createBridge, EXTENSION_NAME } from './bridge.js'
import { DEFAULT_MCP_PORT, mcpStatus, startMcp, stopMcp } from './mcp/session.js'
import { TOOLS, type ToolContext } from './tools/index.js'

const PROFILE_KEY = 'mcpEnabled'
const PROFILE_PORT_KEY = 'mcpPort'

interface ProfileApi {
  getProject(pkg: string, key: string): Promise<unknown>
  setProject(pkg: string, key: string, value: unknown): Promise<void>
}

interface EditorApi {
  Profile: ProfileApi
  Panel: { open(name: string): Promise<void> }
}

const editor = (): EditorApi => (globalThis as unknown as { Editor: EditorApi }).Editor

const version = (): string => {
  try {
    // `../package.json` relative to `dist/main.js` (extension root). Kept as a
    // runtime read so the version has a single source: package.json.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('../package.json') as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const ctx: ToolContext = { bridge: createBridge() }

const PORT_MIN = 1024
const PORT_MAX = 65535

/** Accept only an integer in the unprivileged range (below 1024 needs root on Unix). */
const validPort = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed >= PORT_MIN && parsed <= PORT_MAX ? parsed : undefined
}

/** `ADSCRAFT_MCP_PORT=4000` — for cases where even the default clashes. Invalid values are ignored. */
const envPort = (): number | undefined => validPort(process.env['ADSCRAFT_MCP_PORT'])

/** Port the user chose in the panel (remembered per project). */
const profilePort = async (): Promise<number | undefined> =>
  validPort(await editor().Profile.getProject(EXTENSION_NAME, PROFILE_PORT_KEY))

/** Precedence: panel setting → environment variable → default. */
const desiredPort = async (): Promise<number> => (await profilePort()) ?? envPort() ?? DEFAULT_MCP_PORT

const isEnabled = async (): Promise<boolean> =>
  (await editor().Profile.getProject(EXTENSION_NAME, PROFILE_KEY)) !== false

const status = async (): Promise<Record<string, unknown>> => {
  const desired = await desiredPort()
  const session = mcpStatus()
  return {
    ...session,
    // `port` is the port actually bound (or the desired one when stopped);
    // `configuredPort` is what the panel shows in the input.
    port: session.port || desired,
    configuredPort: desired,
    enabled: await isEnabled(),
    toolCount: TOOLS.length,
    editorVersion: ctx.bridge.editorVersion(),
  }
}

const start = async (): Promise<void> => {
  try {
    await startMcp(ctx, { port: await desiredPort(), serverInfo: { name: EXTENSION_NAME, version: version() } })
    console.log(`[adscraft-mcp] listening on ${mcpStatus().url}`)
  } catch (err) {
    // Never let a failure here kill the extension — the panel still has to open
    // so the user can read the error and retry.
    console.error('[adscraft-mcp] failed to start:', err)
  }
}

export const methods = {
  'open-panel': async () => {
    await editor().Panel.open(`${EXTENSION_NAME}.main`)
  },

  'mcp-status': () => status(),

  'mcp-set-enabled': async (enabled: boolean) => {
    await editor().Profile.setProject(EXTENSION_NAME, PROFILE_KEY, enabled === true)
    if (enabled === true) await start()
    else await stopMcp()
    return status()
  },

  /** Save a new port and restart the server on it. Rejects on an invalid port. */
  'mcp-set-port': async (port: number) => {
    const value = validPort(port)
    if (value === undefined) {
      throw new Error(`Port must be an integer between ${PORT_MIN} and ${PORT_MAX}.`)
    }
    await editor().Profile.setProject(EXTENSION_NAME, PROFILE_PORT_KEY, value)
    await stopMcp()
    await start()
    return status()
  },

  'mcp-restart': async () => {
    await stopMcp()
    await start()
    return status()
  },
}

export const load = (): void => {
  void isEnabled()
    .then((enabled) => (enabled ? start() : undefined))
    .catch((err: unknown) => console.error('[adscraft-mcp] load failed:', err))
}

export const unload = (): void => {
  void stopMcp().catch(() => undefined)
}
