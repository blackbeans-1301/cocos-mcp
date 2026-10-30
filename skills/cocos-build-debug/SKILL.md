---
name: cocos-build-debug
description: Building a Cocos Creator project (web-mobile and others) and diagnosing problems with ccreator-mcp - project_build and build_status polling, build options, console logs, screenshots, project settings, undo. Use when asked to build, when something is broken or missing in the editor, or to confirm a result.
---

# Building and debugging

Assumes `ccreator-mcp` was read.

## Building

1. Only build when the user asked. `scene_is_dirty` → if true, `scene_save` first so the build includes the work.
2. `script_diagnostics` first: a build with type errors usually fails late and wastes minutes.
3. `build_options_get` (with `platform`) to see the options of the last build: the base for any override.
4. `project_build` with `platform` (default `web-mobile`). It **returns at once** with the task; a build takes
   about a minute. Overrides go in `options`, deep-merged over the defaults, e.g.
   `{"packages": {"web-mobile": {"orientation": "portrait"}}}`.
   `debug: true` for a debug build, `buildPath` for the output folder.
5. Poll `build_status` (not more than once every ~10 seconds). It shows state, progress, message and whether
   the output folder has an `index.html`. `wait: true` on `project_build` waits at most 45 seconds: use it only
   as one check, then switch to polling.
6. Done = state finished **and** `index.html` present. Report the output path. If it failed, read the build
   message, then `editor_console_logs` with `type: "error"`, and report the real cause.
7. `build_cancel` stops a running build (default: the latest one); only on the user's request or a hung build.

Do not start a second build while one is running.

## Debugging an editor problem

Work from cheap, read-only checks to heavier ones:

1. `editor_status` and `editor_project_info`: is this the project the user means?
2. `editor_console_logs`: the log buffer starts when the extension loads. Narrow it:
   `type: "error"` or `"warn"`, `pattern` (case-insensitive regex), `limit`. Stack frames are off by default;
   pass `stack: true` only when you need them. `editor_console_clear` empties the buffer, so you can reproduce and
   then read only fresh lines.
3. `node_tree` / `node_get` / `component_dump`: is the scene what you think it is?
4. `scene_screenshot`: look at it (open the returned PNG path). The Scene panel must be open.
5. `asset_dependencies` for "missing asset" or "what uses this".

Only then use `scene_script` / `editor_script`, read-only, to inspect something no typed tool exposes.

## Project settings

`project_setting_list` (`package: "project"`) shows the keys; `project_setting_get` reads one by dotted path.
`project_setting_set` is experimental: change a setting only when asked, read it first, write, then read again to
confirm, and tell the user the old and new values.

## Undo

`editor_undo` / `editor_redo` step through scene edits; each tool call (and each call inside `batch`) is one
step, so to roll back a 5-call edit, undo five times and check with `node_tree`. Asset operations (create,
move, delete) are **not** undone this way. Undo them explicitly (e.g. `asset_move` back).

## Reporting

State what you checked and what you found, with the evidence (error text, build state, node path). Say plainly
when a step failed or was skipped. Do not claim a build or a fix works without having read the result.
