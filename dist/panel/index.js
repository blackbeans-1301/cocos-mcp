"use strict";
/**
 * Panel UI — plain DOM, no framework (one small panel does not need one).
 *
 * Creator calls `ready()` when the panel opens; `beforeClose()` when it closes.
 * Everything the panel shows comes from the main process over
 * `Editor.Message.request('ccreator-mcp', 'mcp-status' | 'mcp-set-enabled' |
 * 'mcp-restart')`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.style = exports.template = void 0;
exports.ready = ready;
exports.beforeClose = beforeClose;
exports.close = close;
const EXTENSION = 'ccreator-mcp';
exports.template = `
<div class="mcp-root">
  <header class="mcp-header">
    <div class="mcp-brand">
      <span class="mcp-dot" id="dot"></span>
      <div>
        <h1>ccreator-mcp</h1>
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
    <div class="mcp-port">
      <label class="mcp-label" for="port">Port</label>
      <input class="mcp-input" id="port" type="number" min="1024" max="65535" inputmode="numeric" />
      <button class="mcp-btn" id="save-port">Save &amp; restart</button>
    </div>
    <p class="mcp-note" id="port-note">Default 3945. Changing the port restarts the server.</p>
    <div class="mcp-actions">
      <button class="mcp-btn mcp-btn-primary" id="copy">Copy client config</button>
      <span class="mcp-note" id="copied"></span>
    </div>
  </section>

  <section class="mcp-card">
    <div class="mcp-row mcp-row-head">
      <span class="mcp-label">Coding agents</span>
      <button class="mcp-btn" id="configure-all">Configure all detected</button>
    </div>
    <ul class="mcp-agents" id="agents"></ul>
    <p class="mcp-note" id="agents-note">
      Registers the endpoint in each agent's MCP config and installs the ccreator-mcp skills. Existing servers are left untouched.
    </p>
  </section>

  <footer class="mcp-footer">
    <span id="editor"></span>
    <a id="docs" href="https://adscraft.app" target="_blank" rel="noreferrer">adscraft.app ↗</a>
  </footer>
</div>
`;
exports.style = `
:host { display: block; height: 100%; }
/* The panel is exactly as tall as its window: the content scrolls inside it instead of being cut off. */
.mcp-root { display: flex; flex-direction: column; gap: 14px; padding: 18px; color: #e6e8ef;
  background: #14161c; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  box-sizing: border-box; height: 100%; overflow-y: auto; overflow-x: hidden; }
.mcp-root > * { flex-shrink: 0; }
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
.mcp-port { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.mcp-input { width: 96px; background: #12141a; border: 1px solid #333a49; color: #e6e8ef;
  border-radius: 8px; padding: 6px 8px; font-size: 13px; }
.mcp-input:focus { outline: none; border-color: #2f6bff; }
.mcp-row-head { justify-content: space-between; }
.mcp-agents { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mcp-agent { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 9px; border: 1px solid #262a36; border-radius: 8px; background: #171a22; }
.mcp-agent-name { font-size: 13px; }
.mcp-agent-meta { font-size: 11px; color: #9aa3b2; margin-left: 6px; }
.mcp-agent-meta.ok { color: #4ade80; }
.mcp-agent-meta.off { opacity: .6; }
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
`;
/**
 * Creator renders a panel's template inside a shadow root, so `document.getElementById` never
 * finds anything — every lookup must go through the panel's own root, set in `ready()`.
 */
let root = document;
const $ = (id) => root.querySelector(`#${id}`);
/** Focused element inside the panel (`document.activeElement` is only the panel host from outside). */
const focused = () => root.activeElement ?? document.activeElement;
let timer;
/** The shadow root that holds our template, found by its marker class (Creator does not pass the panel as `this`). */
const findPanelRoot = (scope = document) => {
    const hit = scope.querySelector('.mcp-root');
    if (hit)
        return hit.getRootNode();
    for (const element of Array.from(scope.querySelectorAll('*'))) {
        if (element.shadowRoot) {
            const found = findPanelRoot(element.shadowRoot);
            if (found)
                return found;
        }
    }
    return null;
};
function ready(attempt = 0) {
    const own = this && this.shadowRoot;
    const found = own && own.querySelector('.mcp-root') ? own : findPanelRoot();
    if (!found) {
        // The template is attached right after `ready` on some builds; wait for it instead of binding to nothing.
        if (attempt < 30)
            window.setTimeout(() => ready.call(undefined, attempt + 1), 100);
        return;
    }
    root = found;
    void refresh();
    $('enabled')?.addEventListener('change', (event) => {
        const checked = event.target.checked;
        void setEnabled(checked);
    });
    $('restart')?.addEventListener('click', () => void restart());
    $('copy')?.addEventListener('click', () => void copyConfig());
    $('save-port')?.addEventListener('click', () => void savePort());
    $('configure-all')?.addEventListener('click', () => void configureAll());
    void loadAgents();
    // The server can start, stop or fail on its own; keep the status current while the panel is open.
    window.clearInterval(timer);
    timer = window.setInterval(() => void refresh(), 2000);
}
function beforeClose() {
    // The server lives in the main process and must outlive the panel; only the polling stops.
    window.clearInterval(timer);
    timer = undefined;
}
function close() {
    beforeClose();
}
const message = globalThis.Editor.Message;
const current = () => message.request(EXTENSION, 'mcp-status');
const setEnabled = async (enabled) => {
    await message.request(EXTENSION, 'mcp-set-enabled', enabled);
    await refresh();
};
const restart = async () => {
    await message.request(EXTENSION, 'mcp-restart');
    await refresh();
};
const note = (id, text, isError = false) => {
    const element = $(id);
    if (!element)
        return;
    element.textContent = text;
    element.classList.toggle('err', isError);
    if (!isError && text)
        window.setTimeout(() => (element.textContent = ''), 1800);
};
const savePort = async () => {
    const input = $('port');
    if (!input)
        return;
    try {
        await message.request(EXTENSION, 'mcp-set-port', Number.parseInt(input.value, 10));
        // Agents configured on the old endpoint would now be stale — rewrite them.
        await refreshConfiguredAgents();
        note('port-note', 'Saved — server restarted.');
        await refresh();
    }
    catch (err) {
        note('port-note', err instanceof Error ? err.message : String(err), true);
    }
};
const loadAgents = async () => {
    try {
        renderAgents((await message.request(EXTENSION, 'mcp-agents')));
    }
    catch {
        /* the panel still works without the agent list */
    }
};
const agentLabel = (agent) => agent.error
    ? agent.error
    : agent.configured
        ? agent.skills
            ? 'configured + skills'
            : 'configured'
        : agent.installed
            ? 'detected'
            : 'not found';
const renderAgents = (agents) => {
    const list = $('agents');
    if (!list)
        return;
    list.replaceChildren(...agents.map((agent) => {
        const item = document.createElement('li');
        item.className = 'mcp-agent';
        const left = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'mcp-agent-name';
        name.textContent = agent.name;
        const meta = document.createElement('span');
        meta.className = `mcp-agent-meta ${agent.configured ? 'ok' : agent.installed ? '' : 'off'}`;
        meta.textContent = agentLabel(agent);
        left.append(name, meta);
        const button = document.createElement('button');
        button.className = 'mcp-btn';
        button.textContent = agent.configured ? 'Remove' : 'Configure';
        button.addEventListener('click', () => void toggleAgent(agent, button));
        item.append(left, button);
        return item;
    }));
};
const toggleAgent = async (agent, button) => {
    button.disabled = true;
    try {
        await message.request(EXTENSION, 'mcp-configure-agent', agent.id, agent.configured ? 'remove' : 'add');
        note('agents-note', `${agent.configured ? 'Removed from' : 'Added to'} ${agent.name}.`);
    }
    catch (err) {
        note('agents-note', err instanceof Error ? err.message : String(err), true);
    }
    finally {
        button.disabled = false;
        await loadAgents();
    }
};
const configureAll = async () => {
    try {
        const agents = (await message.request(EXTENSION, 'mcp-agents'));
        for (const agent of agents) {
            if (agent.installed && !agent.configured)
                await message.request(EXTENSION, 'mcp-configure-agent', agent.id, 'add');
        }
        note('agents-note', 'Configured the detected agents.');
    }
    catch (err) {
        note('agents-note', err instanceof Error ? err.message : String(err), true);
    }
    await loadAgents();
};
/** Re-write the endpoint in every agent we are already configured in (after a port change). */
const refreshConfiguredAgents = async () => {
    try {
        const agents = (await message.request(EXTENSION, 'mcp-agents'));
        for (const agent of agents) {
            if (agent.configured)
                await message.request(EXTENSION, 'mcp-configure-agent', agent.id, 'add');
        }
    }
    catch {
        /* best effort */
    }
};
const copyConfig = async () => {
    const status = await current();
    const url = status.url || `http://127.0.0.1:${status.port}/mcp`;
    const config = JSON.stringify({ mcpServers: { 'ccreator-mcp': { type: 'http', url } } }, null, 2);
    const label = $('copied');
    try {
        // Electron's clipboard always works in a panel; the web API needs document focus and can be refused.
        const electron = globalThis.require?.('electron');
        if (electron?.clipboard)
            electron.clipboard.writeText(config);
        else
            await navigator.clipboard.writeText(config);
        if (label) {
            label.textContent = 'Copied';
            window.setTimeout(() => (label.textContent = ''), 1500);
        }
    }
    catch {
        if (label)
            label.textContent = config;
    }
};
const refresh = async () => {
    let status;
    try {
        status = await current();
    }
    catch (err) {
        // Say so instead of leaving "—" everywhere: this is the first thing to check when the panel looks dead.
        const state = $('state');
        if (state)
            state.textContent = 'Unreachable';
        const error = $('error');
        if (error) {
            error.textContent = `Cannot reach the ${EXTENSION} extension: ${err instanceof Error ? err.message : String(err)}`;
            error.classList.add('err');
        }
        return;
    }
    const dot = $('dot');
    dot?.classList.toggle('on', status.running);
    dot?.classList.toggle('err', Boolean(status.error));
    const state = $('state');
    if (state)
        state.textContent = status.error ? 'Error' : status.running ? 'Running' : 'Stopped';
    const url = $('url');
    if (url)
        url.textContent = status.url || `http://127.0.0.1:${status.port}/mcp`;
    const tools = $('tools');
    if (tools)
        tools.textContent = `${status.toolCount} tools`;
    const error = $('error');
    if (error) {
        error.textContent = status.error;
        error.classList.toggle('err', Boolean(status.error));
    }
    const enabled = $('enabled');
    if (enabled)
        enabled.checked = status.enabled;
    const port = $('port');
    // Don't clobber a value the user is currently typing.
    if (port && focused() !== port)
        port.value = String(status.configuredPort);
    const editor = $('editor');
    if (editor)
        editor.textContent = `Cocos Creator ${status.editorVersion}`;
};
//# sourceMappingURL=index.js.map