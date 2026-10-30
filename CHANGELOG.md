# Changelog

## 0.1.1

Fixes found by running every tool against a real project.

- `component_set_property`: values of custom `@ccclass` types (e.g. `@property([FishSkinEntry])`) are now built with
  their class and filled field by field, so `$asset`/`$node` references inside them resolve. Before, they were stored
  as plain objects holding the literal `{"$asset": …}` and broke the data on save. Fields left out keep their values.
- `component_set_property` / `component_get_property`: `property` takes a dotted path (`skins.1.skinName`, `skins.1`).
- `component_dump`: nested `@ccclass` values come back in the settable form; empty reference slots are `null`.
- A `null` (or other JSON) sent as text by a client is read as JSON for non-string properties, so clearing a
  reference no longer stores the string `"null"`. Free-form `value`/`content` parameters now declare every JSON type.
- Partial Vec2/Vec3/Color/Size objects (`{"x": 5}`) keep the components they leave out.
- Unknown asset uuids/urls fail with "No asset found" instead of an opaque download error.
- `node_create` / `node_create_tree`: new nodes take the parent's layer (UI_2D under a Canvas); `layer` overrides it.
- `component_types` lists project components and module classes such as `sp.Skeleton`.
- `scene_info` counts only user nodes, like `node_tree`.
- `prefab_apply` / `prefab_unlink` refuse a node that is not a prefab instance instead of reporting success.
- `project_build` refuses an unsaved scene (Creator's pre-build step stalls on it); `save: true` saves first.
- `project_build` / `build_status` report the folder Creator really wrote (`web-mobile-001`, … when `web-mobile`
  already exists) instead of assuming `<buildPath>/<platform>`.
- `build_cancel` re-reads the task and says when it did not stop (a queued task can ignore `break-task`).
- `editor_console_logs`: lines like `Warn: [Scene] …` forwarded through `console.error` are reported as `warn`.

## 0.1.0

First public release.

- MCP server (Streamable HTTP, loopback only) running inside Cocos Creator 3.8.8.
- 72 tools: editor, scene, node, component, prefab, asset, script, build, diagnostics.
- Panel with status, port setting, client-config copy and one-click setup for Cursor,
  Claude Code, Windsurf, OpenCode, VS Code and Codex CLI.
- Object references in property setters (`$asset`, `$node`, `$component`).
- English and Chinese extension metadata.
- Six agent skills in `skills/` that teach agents how to use the tools; configuring an agent installs them into that agent's skills folder.
