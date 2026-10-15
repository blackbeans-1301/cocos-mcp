# AdsCraft MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An open **MCP server for Cocos Creator 3.8.8**. It lets AI assistants (Claude Code,
Cursor, Windsurf, …) read and drive the project open in the editor over the
[Model Context Protocol](https://modelcontextprotocol.io): inspect the scene tree,
create and edit nodes and components, manage prefabs and assets, run scripts, and
start builds.

Built by [AdsCraft](https://adscraft.app) — a playable-ads platform for Cocos
Creator. This extension is a stand-alone tool and does not require AdsCraft.

```
AI client  ──HTTP (127.0.0.1)──►  AdsCraft MCP (in the editor)  ──►  Cocos Creator 3.8.8
   Claude Code / Cursor                /mcp endpoint                    scene · assets · build
```

- **40 tools** across editor, scene, node, component, prefab and asset groups.
- **Streamable HTTP** on `http://127.0.0.1:3945/mcp` — attaches to a running editor.
- **Zero runtime dependencies** — the MCP protocol and the HTTP transport are a
  small hand-written subset, so nothing extra is bundled into the editor.
- **Loopback only** — binds `127.0.0.1` and rejects non-loopback `Origin`/`Host`.

## Requirements

- **Cocos Creator 3.8.8** (the `editor` field pins this; other versions are not tested).
- Node.js 18+ for development only (the editor ships its own runtime).

## Install

Clone or download this repository, then import it into Creator:
**Extension → Extension Manager → Import**, and select the repository folder (the
one containing `package.json`). Restart the editor. The MCP server starts
automatically unless you turn it off in the panel (**Extension → AdsCraft MCP**,
or `Cmd/Ctrl+Shift+M`).

The compiled `dist/` is committed, so the folder is importable as-is.

### Build from source

```bash
npm install
npm run build
```

## Connect an AI client

The endpoint is shown in the panel. Default:

```
http://127.0.0.1:3945/mcp
```

**Claude Code**

```bash
claude mcp add --transport http adscraft http://127.0.0.1:3945/mcp
```

**Cursor / any client with an `mcp.json`**

```json
{
  "mcpServers": {
    "adscraft": { "type": "http", "url": "http://127.0.0.1:3945/mcp" }
  }
}
```

Keep Creator open with the project you want to work on — the tools act on the
*open* editor, not on files on disk.

The default port is **3945** (deliberately uncommon — `3000` collides with most
dev servers). If it still clashes, set `ADSCRAFT_MCP_PORT` in the environment you
launch Creator from; the panel always shows the port actually in use.

## Tools

**Editor** — `editor_status`, `editor_project_info`, `editor_console_logs`,
`editor_script` (run JS in the editor main process), `scene_script` (run JS in the
engine runtime), `project_build`.

**Scene** — `scene_info`, `scene_list`, `scene_open`, `scene_save`, `scene_create`.

**Node** — `node_tree`, `node_get`, `node_find`, `node_create`, `node_delete`,
`node_duplicate`, `node_rename`, `node_set_transform`, `node_set_parent`,
`node_set_property`.

**Component** — `component_list`, `component_add`, `component_remove`,
`component_get_property`, `component_set_property`, `component_call_method`,
`component_types`.

**Prefab** — `prefab_list`, `prefab_info`, `prefab_instantiate`,
`prefab_create_from_node`.

**Asset** — `asset_query`, `asset_info`, `asset_create`, `asset_save`,
`asset_move`, `asset_delete`, `asset_reimport`, `asset_open`.

Nodes and components are addressed by `uuid` (preferred) or `path`
(scene-relative, e.g. `Canvas/Player`). Engine values are passed as JSON:
`Vec3`/`Vec2`/`Quat` from `[x, y, z]`, `Color` from `"#rrggbb"` or `[r, g, b, a]`,
`Size` from `[w, h]`.

## How it works

- **`source/scene.ts`** is the extension's *scene script*: it runs in the engine
  runtime (same context as project scripts) and calls `cc.*` directly. Almost
  every node/component tool goes through it, so the editor API surface this
  project depends on lives in one file.
- **`source/mcp/`** is the protocol: `protocol.ts` (JSON-RPC dispatch),
  `server.ts` (Streamable HTTP transport), `session.ts` (lifecycle).
- **`source/bridge.ts`** is the single seam to the editor — the only place that
  touches `Editor.Message`. That is what makes the whole tool layer testable
  outside Creator with a fake bridge.
- **`source/panel/`** is a small plain-DOM panel: status, endpoint, on/off,
  “copy client config”.

## Security

The endpoint can create and delete assets and run arbitrary scripts in the open
project, so it is deliberately narrow:

- Binds **`127.0.0.1` only** (never `0.0.0.0`).
- Rejects requests whose `Origin` or `Host` is not loopback (DNS-rebinding guard).
- Request bodies are capped at 1 MiB.

`editor_script` and `scene_script` execute the code your AI client sends, by
design. Only connect clients you trust, and close the editor (or disable the
server in the panel) when you are not using it.

## Development

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm test           # node --test (protocol + HTTP transport, fake bridge)
```

The tests cover the full `initialize → tools/list → tools/call` path over a real
socket, plus session handling, error mapping and the loopback guards. Anything
that needs a live editor (`scene.ts`, the panel) is listed under *Verification*
below.

## Verification

The MCP protocol, HTTP transport and all 40 tool schemas run under `npm test`.
The editor-facing calls are written against the Cocos Creator 3.8 editor API and
the engine API (`cc`), and **have not yet been exercised inside a real Creator
3.8.8 build** by this project. When you first run it, check in this order:

1. `editor_status` and `scene_info` — confirms the server and the scene script.
2. `node_tree` — confirms engine reads.
3. `node_create` / `component_add` — confirms engine writes.
4. `asset_query` and `scene_open` — confirm the `asset-db`/`scene` message names
   on your build. `editor_console_logs`, `prefab_create_from_node` and
   `project_build` are the most build-dependent; if one fails, `editor_script`
   can reach the same data directly while the wrapper is corrected here.

## License

MIT © AdsCraft team. See [LICENSE](./LICENSE).
