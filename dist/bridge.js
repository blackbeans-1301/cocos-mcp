"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBridge = exports.EXTENSION_NAME = void 0;
/** Extension package name — must match `contributions.scene.script`'s owner (`package.json` `name`). */
exports.EXTENSION_NAME = 'ads-craft-mcp';
/**
 * Bridge backed by the real `Editor`. `Editor` is a global injected by Creator,
 * not an import — importing it would break `node --test`, which runs outside the
 * editor and never builds one.
 */
const createBridge = () => {
    const editor = globalThis.Editor;
    return {
        request: (pkg, message, ...args) => editor.Message.request(pkg, message, ...args),
        scene: (method, args = []) => editor.Message.request('scene', 'execute-scene-script', {
            name: exports.EXTENSION_NAME,
            method,
            // Creator spreads `args` into the method call; scene.ts methods take the whole list as one parameter.
            args: [args],
        }),
        projectPath: () => editor.Project.path,
        editorVersion: () => editor.App.version,
    };
};
exports.createBridge = createBridge;
//# sourceMappingURL=bridge.js.map