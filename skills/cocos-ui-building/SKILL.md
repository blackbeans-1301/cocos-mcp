---
name: cocos-ui-building
description: Building 2D UI in Cocos Creator 3.8 with ccreator-mcp - Canvas, UITransform sizing, Label, Sprite, Button, Widget alignment, layouts, layers and render order. Use when creating or fixing menus, HUDs, popups or any screen-space UI, including "nothing shows up" problems.
---

# Building UI

Assumes `ccreator-mcp` and `cocos-scene-editing` were read. The editor's own "Create → UI" menu does extra
setup that raw node creation does not, so the checklist below matters.

> The layer and component facts here follow Cocos Creator 3.8 behavior. This extension is young: after the
> first UI node you create, confirm with `node_get` and `scene_screenshot` before building the rest.

## Checklist for a visible UI element

1. **Parent under a `Canvas`.** If the scene has none, create one: `node_create` named `Canvas` with
   components `["cc.Canvas"]`, plus a camera child if the scene lacks one (check `node_find` with
   `component: "cc.Camera"`). Do not create a second Canvas unless asked.
2. **Layer = `UI_2D` (33554432).** Nodes made through this extension use the engine default layer, not the
   parent's. A node on the wrong layer is simply not drawn by the UI camera. Set it on **every** UI node:
   `node_set_transform` with `layer: 33554432`. When you build a tree, set the layer on each node afterwards (or
   in a `batch`).
3. **Size** lives on `cc.UITransform`: `contentSize` (`[w, h]`) and `anchorPoint` (`[x, y]`). A Sprite or
   Label adds a `UITransform` automatically; set `contentSize` explicitly for panels and buttons.
4. **Content**: `cc.Label.string`, `cc.Sprite.spriteFrame` (object reference, see `cocos-scene-editing`).
5. **Order**: later siblings draw on top. Use `node_set_sibling_index` to fix overlap.

## Common components and properties

Always `component_dump` first; these are the usual ones:

| Need | Component | Properties to set |
|---|---|---|
| text | `cc.Label` | `string`, `fontSize`, `lineHeight`, `color`, `horizontalAlign` |
| image | `cc.Sprite` | `spriteFrame`, `sizeMode` (use `CUSTOM` and a `contentSize` to stretch) |
| tap target | `cc.Button` | `target` (a `$node` reference), `transition`; click handlers are wired in code |
| pin to edges | `cc.Widget` | `isAlignTop/Left/Right/Bottom` and the matching `top/left/right/bottom` margins |
| auto-arrange | `cc.Layout` | `type`, `spacingX`/`spacingY`, `resizeMode` |
| scroll | `cc.ScrollView` + `cc.Mask` | needs a content node; build it as a tree |
| clip | `cc.Mask` | on the viewport node |

Prefer `cc.Widget` for anything that must adapt to screen size (HUD at the corners, full-screen backdrops)
and `cc.Layout` for rows/columns, over hand-computed positions.

## Building a screen in one go

Use `node_create_tree` for the structure, then a `batch` for layers and properties:

1. Create the tree under `Canvas` (names meaningful: `StartPanel`, `Title`, `PlayButton`, …) with the
   components each node needs.
2. In a `batch`, per node: `node_set_transform` (`layer: 33554432`, `position`), then
   `component_set_properties` (texts, sizes, colors).
3. Read back with `node_tree` and check with `scene_screenshot`.

## Design resolution

Positions are in design-resolution units. Read it with `project_setting_get` (`package: "project"`,
`key: "general.designResolution"`) before choosing coordinates; do not assume 960×640. Do not change it
without being asked.

## Debugging "it is not visible"

Go down the list; stop at the first hit:

1. Is the node (and every ancestor) `active`? `node_get`.
2. Is it under a `Canvas`, and is its **layer** `33554432`?
3. Is `contentSize` non-zero, and the color alpha not 0?
4. Does the `Sprite` have a `spriteFrame`, and a Label a `string`?
5. Is something with a higher sibling index covering it?
6. Is there an enabled camera that renders the UI layer? `node_find` with `component: "cc.Camera"`, then
   `component_dump` and check `visibility`.
7. `scene_screenshot` framed on the node, and `editor_console_logs` with `type: "error"`.

Text and spacing are easy to get subtly wrong; always look at a screenshot before reporting a UI as done.
