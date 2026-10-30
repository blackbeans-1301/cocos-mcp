---
name: cocos-scripting
description: Writing, type-checking and attaching TypeScript components in a Cocos Creator 3.8 project with ccreator-mcp (script_write, script_diagnostics, script_list, component_add). Use whenever a task needs a new or changed game script, including fixing compile errors.
---

# Scripts

Assumes `ccreator-mcp` was read.

## Workflow

1. **Look first.** `script_list` to see the existing scripts and conventions; read a similar one with
   `asset_read`. Match the project's naming, folder layout and style.
2. **Write.** `script_write` with a `db://assets/scripts/<ClassName>.ts` url and the **full** file content (it
   creates or overwrites; there is no patch mode, so read the current file before changing it and send the whole
   result).
3. **Check.** Creator transpiles on save but does not type-check, so run `script_diagnostics` with
   `files: ["db://assets/scripts/<ClassName>.ts"]` right after writing. It returns errors with file, line and
   column, and also lists compile errors Creator logged in the last few minutes (check the time of an error
   before assuming your latest write caused it).
4. **Wait for compile, then confirm.** After `script_write`, Creator recompiles; check `editor_console_logs`
   with `type: "error"` and `limit: 20`. Only once it is clean will the class be available.
5. **Attach.** `component_types` (or `component_add`, which errors on unknown names) with the class name, then
   `component_add` on the target node.
6. **Wire properties.** `component_dump` lists the `@property` fields; set them with `component_set_property`
   (nodes, components and assets via the reference forms).
7. `scene_save`.

## Component template (Creator 3.8)

```ts
import { _decorator, Component, Node, Vec3 } from 'cc'
const { ccclass, property } = _decorator

@ccclass('Spinner')
export class Spinner extends Component {
  @property(Node)
  target: Node | null = null

  @property
  speed = 90

  update(dt: number) {
    if (!this.target) return
    const e = this.target.eulerAngles
    this.target.setRotationFromEuler(e.x, e.y, e.z + this.speed * dt)
  }
}
```

Rules that avoid the usual failures:

- The string in `@ccclass('Name')` is the component's registered name and **must equal the class name**; use
  that name in `component_add`.
- File name should match the class name. One component per file.
- Import engine symbols from `'cc'` (`_decorator`, `Component`, `Node`, …). Do not import Node.js modules in
  game scripts.
- A property typed as a node, component or asset needs its class in the decorator
  (`@property(Node)`, `@property(SpriteFrame)`); plain numbers/strings/booleans infer their type from the
  initializer. Without the decorator the field is invisible to `component_dump`.
- Lifecycle: `onLoad` → `start` → `update(dt)` / `lateUpdate`; `onEnable`/`onDisable`/`onDestroy` for
  subscribe/unsubscribe. Remove every listener you add in `onDestroy`.
- Respect the project's `tsconfig` (strictness, paths). `script_diagnostics` uses it.

## Fixing compile errors

1. `script_diagnostics` (all scripts if unsure which file) → read each error's file, line, column.
2. `asset_read` the file, fix **the cause**, `script_write` the full file again, re-run `script_diagnostics`.
3. Loop at most a few times. If the error does not move, stop and report it with the message instead of
   rewriting the file blindly.

An error that was logged before your last fix can still appear in the list; compare its time with your write.

## Do not

- Do not create scripts with `asset_create`; `script_write` is the supported path.
- Do not delete or rename a script that components in scenes or prefabs use without `asset_dependencies`
  (`users: true`) and the user's go-ahead: those components break.
- Do not put secrets or absolute machine paths in scripts.
