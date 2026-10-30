// Renders the store promo images (1280x720) to static/promo/ with headless Edge.
// Pure HTML/CSS; the icon and panel screenshot are embedded. Needs `npm run screenshots` first.
// Usage: node scripts/make-promo.mjs   (EDGE_PATH overrides the browser)
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = join(import.meta.dirname, '..')
const out = join(repo, 'static', 'promo')
const data = (file) => `data:image/png;base64,${readFileSync(join(repo, file)).toString('base64')}`
const icon = data('static/icon.png')
const panel = data('static/screenshots/panel.png')

const css = `
*{box-sizing:border-box;margin:0}
body{width:1280px;height:720px;overflow:hidden;position:relative;color:#eef1f8;
  font-family:"Segoe UI",system-ui,-apple-system,sans-serif;background:#0b0d13}
.glow{position:absolute;border-radius:50%;filter:blur(120px);opacity:.55}
.g1{width:620px;height:620px;background:#2f6bff;left:-160px;top:-220px}
.g2{width:520px;height:520px;background:#7c3aed;right:-140px;bottom:-240px;opacity:.4}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:48px 48px;
  mask-image:radial-gradient(ellipse at 30% 40%,#000 20%,transparent 75%)}
.wrap{position:relative;height:100%;padding:64px 72px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:22px;letter-spacing:.2px}
.brand img{width:44px;height:44px}
h1{font-size:68px;line-height:1.04;font-weight:800;letter-spacing:-1.5px}
h2{font-size:52px;line-height:1.08;font-weight:800;letter-spacing:-1px}
.grad{background:linear-gradient(90deg,#6ea0ff,#b490ff);-webkit-background-clip:text;color:transparent}
.lead{font-size:24px;line-height:1.45;color:#aab3c5;max-width:560px}
.tag{display:inline-block;font-size:15px;font-weight:600;color:#9db8ff;border:1px solid #2f6bff66;background:#2f6bff1f;border-radius:999px;padding:6px 14px}
.pill{display:inline-block;font-size:17px;color:#d6dcea;background:#ffffff0f;border:1px solid #ffffff1c;border-radius:10px;padding:9px 15px}
.row{display:flex;gap:10px;flex-wrap:wrap}
.card{background:#151925cc;border:1px solid #ffffff17;border-radius:16px;box-shadow:0 30px 80px #0009}
.mono{font-family:ui-monospace,Consolas,Menlo,monospace}
.foot{margin-top:auto;font-size:15px;color:#6f7a90}
.cap{font:600 14px system-ui;color:#7f8aa0;letter-spacing:1px;margin-bottom:8px}
.k{color:#9db8ff}.s{color:#86efac}.ok{color:#4ade80}
`
const shell = (body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><body>
<div class="glow g1"></div><div class="glow g2"></div><div class="grid"></div><div class="wrap">${body}</div>`

const brand = `<div class="brand"><img src="${icon}"><span>ccreator-mcp</span></div>`
const tile = (title, text, pad = '20px 22px', ts = 24, ds = 17) =>
  `<div class="card" style="padding:${pad}"><div style="font-size:${ts}px;font-weight:700;margin-bottom:6px">${title}</div><div style="font-size:${ds}px;line-height:1.4;color:#9aa5bb">${text}</div></div>`

const slides = {
  '1-hero': shell(`
    ${brand}
    <div style="display:flex;flex:1;align-items:center;gap:40px">
      <div style="flex:1">
        <span class="tag">MCP server for Cocos Creator 3.8.8</span>
        <h1 style="margin:22px 0 20px">Let AI <span class="grad">drive</span><br>your Creator project.</h1>
        <p class="lead">Scenes, nodes, components, prefabs and assets, edited by Claude Code, Cursor or Windsurf.</p>
      </div>
      <div class="card" style="width:330px;height:500px;overflow:hidden;transform:rotate(2.5deg);margin-right:-10px">
        <img src="${panel}" style="width:330px;display:block">
      </div>
    </div>
    <div class="foot">Open source · MIT · by AdsCraft</div>`),

  '2-chat': shell(`
    ${brand}
    <h2 style="margin:26px 0 30px">Say what you want.<br><span class="grad">Watch the scene change.</span></h2>
    <div style="display:flex;gap:28px;align-items:flex-start">
      <div class="card" style="flex:1;padding:26px;display:flex;flex-direction:column;gap:16px">
        <div style="align-self:flex-end;background:#2f6bff;border-radius:16px 16px 4px 16px;padding:14px 18px;font-size:20px;max-width:430px">
          Add a Player node with a Sprite under Canvas and put it at (0, -120).</div>
        <div style="background:#ffffff0d;border-radius:16px 16px 16px 4px;padding:14px 18px;font-size:20px;color:#cfd6e6;max-width:430px">
          Done. The Player node now has a Sprite and sits at the bottom of the screen.</div>
      </div>
      <div class="card mono" style="width:420px;padding:22px;font-size:19px;line-height:2;color:#cfd6e6">
        <div class="cap">TOOL CALLS</div>
        <div><span class="ok">●</span> node_create</div>
        <div><span class="ok">●</span> component_add</div>
        <div><span class="ok">●</span> node_set_transform</div>
        <div><span class="ok">●</span> scene_save</div>
      </div>
    </div>
    <div class="foot">Illustrative example</div>`),

  '3-tools': shell(`
    ${brand}
    <div style="display:flex;align-items:flex-end;gap:36px;margin:26px 0 34px">
      <div style="font-size:150px;font-weight:800;line-height:.9;letter-spacing:-6px" class="grad">72</div>
      <h2 style="padding-bottom:6px">tools that cover<br>the whole editor.</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      ${tile('Scene', 'open, save, create, screenshot')}${tile('Node', 'create, move, reparent, find')}${tile('Component', 'add, inspect, set properties')}
      ${tile('Prefab', 'instantiate, apply, revert')}${tile('Asset', 'query, import, move, meta')}${tile('Script &amp; Build', 'write, type-check, build')}
    </div>
    <div class="foot">Plus editor status, console logs, undo/redo, selection and batch calls.</div>`),

  '4-setup': shell(`
    ${brand}
    <div style="display:flex;flex:1;align-items:center;gap:56px">
      <div style="flex:1">
        <h2>Connect your agent<br><span class="grad">in one click.</span></h2>
        <p class="lead" style="margin:20px 0 28px">The panel finds your coding agents and writes the MCP config for you. Other servers in those files stay untouched.</p>
        <div class="row">${['Cursor', 'Claude Code', 'Windsurf', 'OpenCode', 'VS Code', 'Codex CLI'].map((n) => `<span class="pill">${n}</span>`).join('')}</div>
      </div>
      <div class="card mono" style="width:470px;padding:24px;font-size:17px;line-height:1.7;color:#cfd6e6;white-space:nowrap">
        <div class="cap">MCP CONFIG</div>
        <div>{</div>
        <div>&nbsp;&nbsp;<span class="k">"mcpServers"</span>: {</div>
        <div>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">"ccreator-mcp"</span>: {</div>
        <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">"type"</span>: <span class="s">"http"</span>,</div>
        <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">"url"</span>: <span class="s">"http://127.0.0.1:3945/mcp"</span></div>
        <div>&nbsp;&nbsp;&nbsp;&nbsp;}</div><div>&nbsp;&nbsp;}</div><div>}</div>
      </div>
    </div>`),

  '5-safe': shell(`
    ${brand}
    <h2 style="margin:26px 0 34px">Local by design.<br><span class="grad">Only your machine can reach it.</span></h2>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:18px">
      ${tile('127.0.0.1 only', 'The server never binds to 0.0.0.0.', '24px 26px', 26, 19)}
      ${tile('Origin and Host checks', 'Non-loopback requests are rejected (DNS-rebinding guard).', '24px 26px', 26, 19)}
      ${tile('Zero runtime dependencies', 'A small hand-written MCP transport, nothing extra bundled.', '24px 26px', 26, 19)}
      ${tile('Open source, MIT', 'Read every line before it runs in your editor.', '24px 26px', 26, 19)}
    </div>
    <div class="foot">Only connect AI clients you trust: they can run scripts in the open project.</div>`),
}

mkdirSync(out, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'ccreator-promo-'))
const edge = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
for (const [name, html] of Object.entries(slides)) {
  const file = join(scratch, `${name}.html`)
  writeFileSync(file, html)
  execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,720',
    '--virtual-time-budget=2000', `--screenshot=${join(out, name + '.png')}`, pathToFileURL(file).href], { stdio: 'ignore' })
}
rmSync(scratch, { recursive: true, force: true })
console.log(`rendered ${Object.keys(slides).length} images to ${out}`)
