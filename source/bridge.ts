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
  /** Absolute path of the opened project. */
  projectPath(): string
  /** Cocos Creator version, e.g. `3.8.8`. */
  editorVersion(): string
}

/** Extension package name — must match `contributions.scene.script`'s owner (`package.json` `name`). */
export const EXTENSION_NAME = 'ads-craft-mcp'

interface EditorGlobal {
  Message: {
    request(pkg: string, message: string, ...args: unknown[]): Promise<unknown>
  }
  Project: { path: string }
  App: { version: string }
}

/**
 * Bridge backed by the real `Editor`. `Editor` is a global injected by Creator,
 * not an import — importing it would break `node --test`, which runs outside the
 * editor and never builds one.
 */
export const createBridge = (): Bridge => {
  const editor = (globalThis as unknown as { Editor: EditorGlobal }).Editor
  return {
    request: (pkg, message, ...args) => editor.Message.request(pkg, message, ...args),
    scene: (method, args = []) =>
      editor.Message.request('scene', 'execute-scene-script', {
        name: EXTENSION_NAME,
        method,
        args,
      }),
    projectPath: () => editor.Project.path,
    editorVersion: () => editor.App.version,
  }
}
