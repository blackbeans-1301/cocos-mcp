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

const isEnabled = async (): Promise<boolean> =>
  (await editor().Profile.getProject(EXTENSION_NAME, PROFILE_KEY)) !== false

const status = async (): Promise<Record<string, unknown>> => ({
  ...mcpStatus(),
  enabled: await isEnabled(),
  toolCount: TOOLS.length,
  editorVersion: ctx.bridge.editorVersion(),
  port: mcpStatus().port || DEFAULT_MCP_PORT,
})

const start = async (): Promise<void> => {
  try {
    await startMcp(ctx, { serverInfo: { name: EXTENSION_NAME, version: version() } })
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
