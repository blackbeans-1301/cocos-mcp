/**
 * Panel UI — plain DOM, no framework (one small panel does not need one).
 *
 * Creator calls `ready()` when the panel opens; `beforeClose()` when it closes.
 * Everything the panel shows comes from the main process over
 * `Editor.Message.request('ads-craft-mcp', 'mcp-status' | 'mcp-set-enabled' |
 * 'mcp-restart')`.
 */

const EXTENSION = 'ads-craft-mcp'

interface Status {
  running: boolean
  url: string
  port: number
  error: string
  enabled: boolean
  toolCount: number
  editorVersion: string
}

export const template = `
<div class="mcp-root">
  <header class="mcp-header">
    <div class="mcp-brand">
      <span class="mcp-dot" id="dot"></span>
      <div>
        <h1>AdsCraft MCP</h1>
        <p id="subtitle">Drive Cocos Creator from AI assistants</p>
      </div>
    </div>
    <button class="mcp-btn mcp-btn-ghost" id="restart" title="Restart the server">Restart</button>
  </header>

  <section class="mcp-card">
    <div class="mcp-row">
      <span class="mcp-label">Status</span>
      <span class="mcp-value" id="state">—</span>
    </div>
    <div class="mcp-row">
      <span class="mcp-label">Endpoint</span>
      <code class="mcp-value mcp-mono" id="url">—</code>
    </div>
    <div class="mcp-row">
      <span class="mcp-label">Tools</span>
      <span class="mcp-value" id="tools">—</span>
    </div>
    <p class="mcp-note" id="error"></p>
  </section>

  <section class="mcp-card">
    <label class="mcp-toggle">
      <input type="checkbox" id="enabled" />
      <span>Start the server when Creator opens</span>
    </label>
    <p class="mcp-note">
      Point your AI assistant at the endpoint below. The server listens on
      <strong>127.0.0.1 only</strong> and is reachable while Creator is open.
    </p>
    <div class="mcp-actions">
      <button class="mcp-btn mcp-btn-primary" id="copy">Copy client config</button>
      <span class="mcp-note" id="copied"></span>
    </div>
  </section>

  <footer class="mcp-footer">
    <span id="editor"></span>
    <a id="docs" href="https://adscraft.app" target="_blank" rel="noreferrer">adscraft.app ↗</a>
  </footer>
</div>
`

export const style = `
.mcp-root { display: flex; flex-direction: column; gap: 14px; padding: 18px; color: #e6e8ef;
  background: #14161c; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100%; }
.mcp-header { display: flex; align-items: center; justify-content: space-between; }
.mcp-brand { display: flex; align-items: center; gap: 10px; }
.mcp-brand h1 { margin: 0; font-size: 16px; font-weight: 700; }
.mcp-brand p { margin: 2px 0 0; font-size: 12px; color: #9aa3b2; }
.mcp-dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7280; box-shadow: 0 0 0 4px rgba(107,114,128,.15); }
.mcp-dot.on { background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.18); }
.mcp-dot.err { background: #ef4444; box-shadow: 0 0 0 4px rgba(239,68,68,.18); }
.mcp-card { background: #1b1e27; border: 1px solid #262a36; border-radius: 10px; padding: 12px 14px; }
.mcp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
.mcp-label { font-size: 12px; color: #9aa3b2; }
.mcp-value { font-size: 13px; text-align: right; word-break: break-all; }
.mcp-mono { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; }
.mcp-note { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: #9aa3b2; }
.mcp-note.err { color: #f87171; }
.mcp-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.mcp-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.mcp-btn { border: 1px solid #333a49; background: #232733; color: #e6e8ef; border-radius: 8px;
  padding: 7px 12px; font-size: 12px; cursor: pointer; }
.mcp-btn:hover { background: #2b3040; }
.mcp-btn-primary { background: #2f6bff; border-color: #2f6bff; color: #fff; }
.mcp-btn-primary:hover { background: #3f79ff; }
.mcp-btn-ghost { background: transparent; }
.mcp-footer { display: flex; align-items: center; justify-content: space-between; margin-top: auto;
  font-size: 12px; color: #9aa3b2; }
.mcp-footer a { color: #7ea2ff; text-decoration: none; }
`

const $ = (id: string): HTMLElement | null => document.getElementById(id)

export function ready(): void {
  void refresh()
  $('enabled')?.addEventListener('change', (event) => {
    const checked = (event.target as HTMLInputElement).checked
    void setEnabled(checked)
  })
  $('restart')?.addEventListener('click', () => void restart())
  $('copy')?.addEventListener('click', () => void copyConfig())
}

export function beforeClose(): void {
  // The server lives in the main process and must outlive the panel; nothing to do.
}

interface MessageApi {
  request(pkg: string, message: string, ...args: unknown[]): Promise<unknown>
}

const message = (globalThis as unknown as { Editor: { Message: MessageApi } }).Editor.Message

const current = (): Promise<Status> => message.request(EXTENSION, 'mcp-status') as Promise<Status>

const setEnabled = async (enabled: boolean): Promise<void> => {
  await message.request(EXTENSION, 'mcp-set-enabled', enabled)
  await refresh()
}

const restart = async (): Promise<void> => {
  await message.request(EXTENSION, 'mcp-restart')
  await refresh()
}

const copyConfig = async (): Promise<void> => {
  const status = await current()
  const url = status.url || `http://127.0.0.1:${status.port}/mcp`
  const config = JSON.stringify({ mcpServers: { adscraft: { type: 'http', url } } }, null, 2)
  try {
    await navigator.clipboard.writeText(config)
    const note = $('copied')
    if (note) {
      note.textContent = 'Copied'
      window.setTimeout(() => (note.textContent = ''), 1500)
    }
  } catch {
    const note = $('copied')
    if (note) note.textContent = config
  }
}

const refresh = async (): Promise<void> => {
  let status: Status
  try {
    status = await current()
  } catch {
    return
  }

  const dot = $('dot')
  dot?.classList.toggle('on', status.running)
  dot?.classList.toggle('err', Boolean(status.error))

  const state = $('state')
  if (state) state.textContent = status.error ? 'Error' : status.running ? 'Running' : 'Stopped'

  const url = $('url')
  if (url) url.textContent = status.url || `http://127.0.0.1:${status.port}/mcp`

  const tools = $('tools')
  if (tools) tools.textContent = `${status.toolCount} tools`

  const error = $('error')
  if (error) {
    error.textContent = status.error
    error.classList.toggle('err', Boolean(status.error))
  }

  const enabled = $('enabled') as HTMLInputElement | null
  if (enabled) enabled.checked = status.enabled

  const editor = $('editor')
  if (editor) editor.textContent = `Cocos Creator ${status.editorVersion}`
}
