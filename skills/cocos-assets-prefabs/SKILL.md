---
name: cocos-assets-prefabs
description: Managing Cocos Creator assets and prefabs with ccreator-mcp - db:// urls, importing files, querying textures/audio, import settings (.meta), moving or deleting safely, creating and instantiating prefabs, applying or reverting overrides. Use for any asset-database or prefab task.
---

# Assets and prefabs

Assumes `ccreator-mcp` was read.

## The asset database

- Everything lives under `db://assets/...` (project) or `db://internal/...` (engine built-ins, read-only).
- Identify an asset by `uuid` or `url`. Prefer uuid once you have it: urls change when assets move.
- `asset_query` finds things: a glob over urls (`db://assets/**/*.png`) and/or a `type` (`cc.Texture2D`,
  `cc.SpriteFrame`, `cc.AudioClip`, `cc.Prefab`, …). Sub-assets (a texture's spriteFrame) are hidden unless you
  pass a `type`. Check `truncated` in the result.
- `asset_info` for the record, `asset_read` for text content (scripts, JSON, scenes, prefabs; binary is refused),
  `asset_dependencies` for what it uses (`users: true` for what uses it).

## Getting files in

| Goal | Tool |
|---|---|
| copy a file from disk into the project | `asset_import` (`source`: absolute path, `url`: target) |
| create a text/JSON asset | `asset_create` (`content` string or JSON value) |
| overwrite a text/JSON asset | `asset_save` |
| new folder | `asset_mkdir` |
| files were changed outside the editor | `asset_refresh` (a folder url, or none for all of `db://assets`) |

Create folders first if the target folder does not exist. For scripts use `script_write`, not `asset_create`
(see `cocos-scripting`). Do not `asset_save` over a scene or prefab file: edit those through the node and prefab
tools.

## Moving, copying, deleting

- `asset_move` renames or relocates and **keeps the uuid**, so references survive. `asset_copy` makes a new asset
  with a new uuid.
- Before `asset_delete`: run `asset_dependencies` with `users: true`. If anything uses it, tell the user and
  ask. Delete only what was requested.

## Import settings

`asset_meta_get` shows the importer and `userData` (texture compression, sprite border and trim, audio
settings). `asset_meta_set` **deep-merges** the `userData` you pass and re-imports, so send only the keys you
change, e.g. `{"compressSettings": {"useCompressTexture": true}}`. Always read first and re-read to confirm.
`asset_reimport` re-runs the importer without changing anything.

## Using assets in the scene

Reference them from component properties with `{"$asset": uuid-or-url}`. A SpriteFrame of an image is
`<imageUuid>@f9941`; get it from `asset_query` with `type: "cc.SpriteFrame"`, or take the texture uuid and append
`@f9941`. Textures imported as a plain image get their sprite frame automatically.

## Prefabs

| Goal | Tool |
|---|---|
| list | `prefab_list` |
| inspect a prefab asset | `prefab_info` |
| put one in the scene | `prefab_instantiate` (`uuid` of the prefab asset, optional parent and `position`) |
| make a prefab from a scene node | `prefab_create_from_node` |
| push instance edits back | `prefab_apply` |
| drop instance edits | `prefab_revert` |
| make the instance a plain node | `prefab_unlink` |

Things to know:

- `prefab_create_from_node` turns the **source node into an instance**: it is renamed after the prefab and its
  **uuid changes**. Re-read the tree afterwards and use the new uuid or path.
- `prefab_apply` changes the shared asset for **every** instance and every scene using it. Do it only when the
  user wants the prefab itself changed; otherwise leave the override on the instance.
- `prefab_revert` discards the instance's overrides, which loses work: confirm with the user first if you did
  not make those overrides yourself.
- To edit a prefab's internals, open it (`asset_open`) or edit an instance and `prefab_apply`; avoid editing
  the `.prefab` JSON with `asset_save`.
- A prefab asset must exist in `db://assets/...` before you can instantiate it: check with `prefab_list`.

Finish with `scene_save` if the scene changed.
