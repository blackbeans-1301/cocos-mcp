/**
 * The one place that talks to Cocos Creator.
 *
 * Every editor call in this extension goes through a `Bridge`. Tools never touch
 * `Editor.Message` directly — two reasons:
 *
 * 1. `Editor` only exists inside Creator, so a seam here is what makes the MCP
 *    layer and the tools testable with `node --test` (a fake bridge).
 * 2. When a message name turns out wrong on a real Creator build, there is one
 *    file to fix instead of forty tools.
 */

/** A line from the editor console (`Editor.Message.request('scene', 'query-console-logs')`-shaped). */
export interface ConsoleEntry {
  type: string
  message: string
  time: string
}

export interface Bridge {
  /** `Editor.Message.request(pkg, message, ...args)` — routed to another editor module. */
  request(pkg: string, message: string, ...args: unknown[]): Promise<unknown>
  /** Runs one method of this extension's scene script in the engine runtime (see `source/scene.ts`). */
  scene(method: string, args?: unknown[]): Promise<unknown>
  /** Uuids of the nodes selected in the editor (`Editor.Selection`). */
  selection(): string[]
  /** Replace the node selection. */
  select(uuids: string[]): void
  /** Read a project profile value (`Editor.Profile.getProject`). */
  getProjectSetting(pkg: string, key: string): Promise<unknown>
  /** Write a project profile value (`Editor.Profile.setProject`). */
  setProjectSetting(pkg: string, key: string, value: unknown): Promise<void>
  /** Absolute path of the opened project. */
  projectPath(): string
  /** Cocos Creator version, e.g. `3.8.8`. */
  editorVersion(): string
  /** Install folder of the editor (`Editor.App.path`) — where its bundled `node_modules` live. */
  appPath(): string
  /** Capture the Scene view as a PNG. */
  capture(): Promise<{ width: number; height: number; png: Uint8Array }>
}

/** Extension package name — must match `contributions.scene.script`'s owner (`package.json` `name`). */
export const EXTENSION_NAME = 'ccreator-mcp'

interface EditorGlobal {
  Message: {
    request(pkg: string, message: string, ...args: unknown[]): Promise<unknown>
  }
  Project: { path: string }
  Selection: { getSelected(type: string): string[]; clear(type: string): void; select(type: string, uuids: string[]): void }
  Profile: {
    getProject(pkg: string, key: string): Promise<unknown>
    setProject(pkg: string, key: string, value: unknown): Promise<void>
  }
  App: { version: string; path: string }
}

/** The subset of Electron's `webContents` the Scene-view capture uses. */
interface WebContentsLike {
  getTitle(): string
  getURL(): string
  capturePage(): Promise<{ getSize(): { width: number; height: number }; toPNG(): Uint8Array }>
}

/**
 * Bridge backed by the real `Editor`. `Editor` is a global injected by Creator,
 * not an import — importing it would break `node --test`, which runs outside the
 * editor and never builds one.
 */
/** Scene-script methods that only read; every other one changes the scene and must leave an undo step. */
const READ_ONLY = new Set(['sceneInfo', 'nodeTree', 'findNodes', 'getNode', 'listComponents', 'getComponentProperty', 'listComponentTypes', 'getPrefabInfo'])

export const createBridge = (): Bridge => {
  const editor = (globalThis as unknown as { Editor: EditorGlobal }).Editor
  return {
    request: (pkg, message, ...args) => editor.Message.request(pkg, message, ...args),
    scene: async (method, args = []) => {
      const call = (name: string, list: unknown[]): Promise<unknown> =>
        editor.Message.request('scene', 'execute-scene-script', {
          name: EXTENSION_NAME,
          method: name,
          // Creator spreads `args` into the method call; scene.ts methods take the whole list as one parameter.
          args: [list],
        })
      const run = (): Promise<unknown> => call(method, args)
      if (READ_ONLY.has(method)) return run()
      // Direct engine edits bypass the editor's undo stack. Wrapping the call in the editor's own recording
      // (what its panels do) makes `undo` revert it. A recording only tracks the nodes it is given, not their
      // descendants, so give it every node the edit names plus that node's parent (covers create/delete/reparent).
      // A bare `snapshot` is the fallback: it adds no undo step for property edits.
      const request = (message: string, ...rest: unknown[]): Promise<unknown> => editor.Message.request('scene', message, ...rest)
      const affected = async (): Promise<string[]> => {
        const spec = (args[0] ?? {}) as Record<string, unknown>
        const refs = [
          { uuid: spec['uuid'], path: spec['path'] },
          { uuid: spec['parentUuid'], path: spec['parentPath'] },
        ].filter((ref) => ref.uuid || ref.path)
        const uuids = new Set<string>()
        for (const ref of refs) {
          const node = (await call('getNode', [ref]).catch(() => null)) as { uuid?: string; path?: string } | null
          if (!node?.uuid) continue
          uuids.add(node.uuid)
          const parentPath = (node.path ?? '').split('/').slice(0, -1).join('/')
          const parent = parentPath ? ((await call('getNode', [{ path: parentPath }]).catch(() => null)) as { uuid?: string } | null) : null
          const parentUuid = parent?.uuid ?? ((await request('query-node-tree').catch(() => null)) as { uuid?: string } | null)?.uuid
          if (parentUuid) uuids.add(parentUuid)
        }
        return [...uuids]
      }
      let undoId: unknown
      try {
        const uuids = await affected()
        if (uuids.length > 0) undoId = await request('begin-recording', uuids)
      } catch {
        undoId = undefined
      }
      const recording = undoId !== undefined && undoId !== null
      try {
        const result = await run()
        if (recording) await request('end-recording', undoId).catch(() => undefined)
        else await request('snapshot').catch(() => undefined)
        return result
      } catch (err) {
        if (recording) await request('cancel-recording', undoId).catch(() => undefined)
        throw err
      }
    },
    selection: () => editor.Selection.getSelected('node'),
    select: (uuids) => {
      editor.Selection.clear('node')
      if (uuids.length > 0) editor.Selection.select('node', uuids)
    },
    getProjectSetting: (pkg, key) => editor.Profile.getProject(pkg, key),
    setProjectSetting: (pkg, key, value) => editor.Profile.setProject(pkg, key, value),
    projectPath: () => editor.Project.path,
    editorVersion: () => editor.App.version,
    appPath: () => editor.App.path,
    capture: async () => {
      // The Scene view is a webview titled "3D Engine WebView"; `electron` only exists inside Creator.
      const { webContents } = require('electron') as { webContents: { getAllWebContents(): WebContentsLike[] } }
      const view = webContents.getAllWebContents().find((w) => w.getTitle() === '3D Engine WebView' || w.getURL().includes('3d-webview'))
      if (!view) throw new Error('The Scene view is not open — open the Scene panel in the editor first.')
      const image = await view.capturePage()
      const { width, height } = image.getSize()
      return { width, height, png: image.toPNG() }
    },
  }
}
