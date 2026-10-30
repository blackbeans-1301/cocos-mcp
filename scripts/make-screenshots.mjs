// Renders the real compiled panel (dist/panel/index.js) in headless Edge against a fake Editor.Message
// with sample data (not a live Creator session). Needs `npm run build` first and Microsoft Edge (EDGE_PATH to override).
// Usage: node scripts/make-screenshots.mjs  -> static/screenshots/*.png
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = join(import.meta.dirname, '..')
const out = join(repo, 'static', 'screenshots')
const scratch = mkdtempSync(join(tmpdir(), 'ccreator-shots-'))
const code = readFileSync(join(repo, 'dist/panel/index.js'), 'utf8')
const agents = (cfg) => [
  { id: 'cursor', name: 'Cursor', installed: true, configured: cfg, error: '' },
  { id: 'claude-code', name: 'Claude Code', installed: true, configured: cfg, error: '' },
  { id: 'windsurf', name: 'Windsurf', installed: true, configured: false, error: '' },
  { id: 'opencode', name: 'OpenCode', installed: false, configured: false, error: '' },
  { id: 'vscode', name: 'VS Code', installed: true, configured: cfg, error: '' },
  { id: 'codex', name: 'Codex CLI', installed: false, configured: false, error: '' },
]
const page = (cfg) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#14161c">
<div id="host" style="width:640px;height:900px"></div>
<script>
var exports = {}
var Editor = { Message: { request: async (_p, m) => {
  if (m === 'mcp-status') return { running: true, url: 'http://127.0.0.1:3945/mcp', port: 3945, configuredPort: 3945, error: '', enabled: true, toolCount: 72, editorVersion: '3.8.8' }
  if (m === 'mcp-agents') return ${JSON.stringify(agents(cfg))}
} } }
${code}
var shadow = document.getElementById('host').attachShadow({ mode: 'open' })
shadow.innerHTML = '<style>' + exports.style + '</style>' + exports.template
exports.ready.call({ shadowRoot: shadow })
</script>`
mkdirSync(out, { recursive: true })
const edge = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
for (const [name, cfg] of [['panel', true], ['panel-first-run', false]]) {
  const html = join(scratch, `${name}.html`)
  writeFileSync(html, page(cfg))
  execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=640,900',
    '--virtual-time-budget=3000', `--screenshot=${join(out, name + '.png')}`, 'file:///' + pathToFileURL(html).href.slice('file:///'.length)], { stdio: 'inherit' })
}
rmSync(scratch, { recursive: true, force: true })
