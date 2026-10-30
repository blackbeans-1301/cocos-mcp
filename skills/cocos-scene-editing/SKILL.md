---
name: cocos-scene-editing
description: How to create, move, reparent, duplicate and delete nodes and to add, inspect and configure components in an open Cocos Creator scene with ccreator-mcp (node_*, component_*, selection_*). Use for any scene-hierarchy or component-property change, including setting properties that reference assets or other nodes.
---

# Editing nodes and components

Assumes `ccreator-mcp` was read (preflight done, addressing and value formats known).

## Reading the scene

- `node_tree` for the shape; `node_get` for one node (transform, active, components).
- `node_find` by `name` (exact or substring) and/or `component` to locate things. If it returns more than one
  match, do not act on the first: pick by path or ask.
- `selection_get` shows what the user has selected in the editor, useful for "this node" / "the selected one".
  `selection_set` highlights nodes for the user after you create or change them.

## Creating

- One node: `node_create` with `name`, `parentUuid`/`parentPath` (default: scene root), and optionally
  `position`, `rotation`, `scale`, `components`.
- Several related nodes: `node_create_tree` with a nested
  `{name, position, components: ["cc.Sprite"], children: [...]}`: one call, one parent, much less chatter.
- Parent matters: 2D UI nodes belong under a `Canvas` (see `cocos-ui-building`); gameplay nodes can sit at the
  scene root.
- New nodes appear **at the end of their parent's children**. Use `node_set_sibling_index` to control order
  (render order for 2D, list order in layouts).

## Moving and restructuring

| Goal | Tool |
|---|---|
| position / rotation (euler degrees) / scale / active / layer | `node_set_transform` |
| change parent | `node_set_parent` (`keepWorldTransform: true` keeps where it appears on screen) |
| z-order among siblings | `node_set_sibling_index` |
| copy | `node_duplicate` (clone stays under the same parent; pass `name`) |
| rename | `node_rename` |
| delete | `node_delete` (the scene root cannot be deleted) |

`node_set_transform` position is **local** to the parent. When reparenting without `keepWorldTransform`, the
local values are kept and the node may jump.

## Components: always dump before you set

1. `component_add` with the class name. Engine classes are `cc.Sprite`, `cc.Label`, `cc.Button`, …; for the
   list of what exists use `component_types`. Components that require others (for example `cc.Sprite` needs
   `cc.UITransform`) get their dependencies added by the engine; check with `component_list`.
2. `component_dump` lists every editable property with its type, current value **in the form
   `component_set_property` accepts**, enum choices and read-only flags. Do this before setting a property you
   have not set before; guessing names wastes calls (an unknown property is an error).
3. `component_set_properties` to set several at once (stops at the first bad one and reports what was applied);
   `component_set_property` for one.
4. Verify with `component_get_property` or `component_dump`.

Enums are set by their numeric value (the dump lists the choices). Custom script components work the same way
once the script has compiled (`component_types` shows them; see `cocos-scripting`).

### Object references

To point a property at an asset, node or component, use the reference forms:

```json
{"property": "spriteFrame", "value": {"$asset": "<imageUuid>@f9941"}}
{"property": "target",      "value": {"$node": "Canvas/Player"}}
{"property": "button",      "value": {"$component": {"node": "Canvas/Btn", "type": "cc.Button"}}}
{"property": "frames",      "value": [{"$asset": "…@f9941"}, {"$asset": "…@f9941"}]}
```

Find the asset uuid with `asset_query` (`type: "cc.SpriteFrame"` returns sprite frames directly, or query the
texture and append `@f9941`). Passing a bare uuid string where an object is expected will not link.
`null` clears a reference.

### Nested data (custom classes and arrays of them)

A property typed with a custom `@ccclass` (e.g. `@property([FishSkinEntry]) skins`) takes plain objects; each is
built with its class, and references inside it resolve. Change one field with a dotted path instead of resending
the whole array — fields you leave out keep their values:

```json
{"property": "skins.1.skinName", "value": "10"}
{"property": "skins.1",          "value": {"skinName": "10", "icon": {"$asset": "…@f9941"}}}
{"property": "skins",            "value": [{"fishType": 1, "skeletonData": {"$asset": "…"}, "skinName": "1"}]}
```

`component_get_property` reads the same paths, and `component_dump` returns nested values in this settable form.

## Node properties vs component properties

`node_set_property` is for properties of the node itself (`name`, `active`, `layer`, `mobility`, …).
Everything on a component, including `string` of a Label or `color` of a Sprite, goes through the
`component_*` tools. An unknown property name is an error that says so.

## Calling component methods

`component_call_method` runs a method with JSON arguments. It executes in the **editor's** engine instance,
not in a running game, so use it for editor-time helpers and setup methods, not for gameplay logic.

## Verify visually

After a non-trivial change, `scene_screenshot` (optionally with `uuid`/`path` to frame a node) returns a PNG
path; open that file to look at the result. The Scene panel must be open in the editor.

## Finish

`scene_is_dirty` → `scene_save`. Tell the user what changed (nodes created, properties set) in a few lines.
