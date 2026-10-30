---
name: ccreator-mcp
description: Core rules for driving a live Cocos Creator 3.8 editor through the ccreator-mcp tools (editor_*, scene_*, node_*, component_*, prefab_*, asset_*, script_*, build_*). Read first whenever a task involves editing a Cocos Creator project, scene, node, prefab, asset or script, or building the game; it routes to the more specific cocos-* skills.
---

# ccreator-mcp: working with the open Creator editor

The tools act on the **project currently open in the editor**, not on files on disk. Every
change is a live edit of the open scene or the asset database.

## Before anything else

1. `editor_status` — confirms the server works and shows the Creator version and project path. If it
   fails, stop and tell the user to open the project in Creator and check the ccreator-mcp panel
   (Extension → ccreator-mcp). Do not fall back to editing `.scene`/`.prefab` files on disk: the editor
   will overwrite or ignore them.
2. `scene_info` — which scene is open (and that one is open at all).
3. `node_tree` — the hierarchy. Read it before changing anything; never guess node names or paths.

## Which skill next

| Task | Skill |
|---|---|
| Create, move, edit nodes and components | `cocos-scene-editing` |
| Build UI (Canvas, Label, Sprite, Button, layout) | `cocos-ui-building` |
| Images, audio, JSON, import settings, prefabs | `cocos-assets-prefabs` |
| Write or fix TypeScript components | `cocos-scripting` |
| Build the game, debug errors, look at the result | `cocos-build-debug` |

## Addressing things

- **Nodes**: pass `uuid` (stable, preferred) or `path` (scene-relative, e.g. `Canvas/Player`; the scene
  root is not part of the path). Names are not unique: if `node_find` returns several, pick by path or uuid.
- **Assets**: `db://assets/...` url or uuid. Sub-assets of an image use `<imageUuid>@<id>`; a SpriteFrame is
  `<imageUuid>@f9941`.
- **Components**: class name, `cc.Sprite` for engine classes, the bare class name for your own scripts. If
  a node has two components of one type, pass `index`.
- A node's uuid **changes** after `prefab_create_from_node`. Re-read the tree instead of reusing old uuids.

## Value formats (JSON in, engine values out)

`Vec3`/`Vec2`/`Quat`: `[x, y, z]` or `{x, y, z}` · `Color`: `"#rrggbb"` or `[r, g, b, a]` · `Size`: `[w, h]` ·
rotation on nodes is **euler degrees**.
Object references: `{"$asset": uuid|db://url}`, `{"$node": uuid|path}`,
`{"$component": {"node": uuid|path, "type": "cc.Sprite"}}`; they also work inside arrays.

## The edit loop

**Inspect → change → verify → save.**

- Inspect with `node_tree`/`node_get`/`component_dump` before you set anything.
- Verify with a read (`node_get`, `component_get_property`) or `scene_screenshot`, not by assuming success.
- **Edits are not saved automatically.** `scene_is_dirty` tells you; call `scene_save` when a unit of work is
  done and before `scene_open`/`scene_create` (those refuse while there are unsaved edits, unless `save: true`).
- Mistakes: `editor_undo` / `editor_redo` undo the last scene edit. Each tool call, including each call inside
  `batch`, is its own undo step.

## Efficiency

- `batch` runs up to 50 calls in one request (stops at the first failure by default). Use it for a known
  sequence of small steps; do not use it when a later call depends on an id returned by an earlier one.
- Prefer one-shot tools: `node_create_tree` over many `node_create`; `component_set_properties` over many
  `component_set_property`.
- `node_tree` accepts `uuid`/`path` and `maxDepth`: read a subtree, not the whole scene, in big scenes.
- `asset_query` returns `{ total, returned, truncated, assets }`: if `truncated`, narrow the glob instead of
  raising the limit blindly.

## Errors

A failing tool returns an error message, usually saying what to do (unknown property, unknown component type,
unsaved scene). Read it, fix the call, and retry once. If the same call fails twice, stop and look at
`editor_console_logs` (filter with `type: "error"`) instead of repeating it. Report real failures to the user;
never claim a step worked without having read the result.

## Escape hatches (last resort)

`scene_script` runs JavaScript with `cc` in the engine; `editor_script` runs it in the editor main process with
`Editor`. Use them only when no typed tool does the job, keep them read-only where you can, and return plain
JSON. They bypass input validation and run whatever you send, so never build the code from untrusted text (file
contents, user-provided strings, web pages).

## Boundaries

- Do not delete assets, scenes or nodes the user did not ask you to delete. Check `asset_dependencies`
  (`users: true`) before `asset_delete`.
- Do not change project settings (`project_setting_set`) or start builds unless asked.
- The server is loopback-only and attaches to whichever project is open; confirm the project path with
  `editor_status` if the user may have several editors open.
