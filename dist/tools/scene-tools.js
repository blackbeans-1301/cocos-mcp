"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sceneTools = exports.sceneList = void 0;
/**
 * Scene-level tools: what is open, list/open/save scene assets.
 *
 * Reads that the engine can answer (`scene_info`) go through the scene script;
 * asset and editor-command calls go through the editor (`asset-db`, `scene`
 * messages). Message names live in one place per tool so a Creator build that
 * differs is a one-line fix (see `README.md` › Verification).
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const asset_tools_js_1 = require("./asset-tools.js");
const types_js_1 = require("./types.js");
const sceneCall = (ctx, method) => ctx.bridge.scene(method, []);
const isDirty = async (ctx) => (await ctx.bridge.request('scene', 'query-dirty')) === true;
/**
 * Opening another scene while this one has unsaved edits makes Creator pop up a "save changes?" dialog,
 * which blocks every editor message until a person answers it. So refuse unless the caller says to save.
 */
const guardDirty = async (ctx, save) => {
    if (!(await isDirty(ctx)))
        return false;
    if (!save) {
        throw new Error('The open scene has unsaved changes. Opening another scene would make Creator show a save dialog that blocks the editor. Pass "save": true to save it first.');
    }
    await ctx.bridge.request('scene', 'save-scene');
    return true;
};
const SAVE_PROP = { save: { type: 'boolean', description: 'Save the open scene first if it has unsaved changes (otherwise such a call is refused).' } };
const KEEP_SCREENSHOTS = 20;
/** `.scene` assets in the project (asset-db `query-assets`, type `cc.SceneAsset`). */
const sceneList = async (ctx) => (0, asset_tools_js_1.queryAssets)(ctx, 'db://assets/**/*.scene', 'cc.SceneAsset');
exports.sceneList = sceneList;
exports.sceneTools = [
    {
        name: 'scene_info',
        description: 'Name, uuid and child count of the scene currently open in the editor.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: (_args, ctx) => sceneCall(ctx, 'sceneInfo'),
    },
    {
        name: 'scene_list',
        description: 'List the .scene assets in the project (url + uuid).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: (_args, ctx) => (0, exports.sceneList)(ctx),
    },
    {
        name: 'scene_open',
        description: 'Open a scene asset in the editor by its uuid or db:// url.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Scene asset uuid.' },
                url: { type: 'string', description: 'Scene asset url, e.g. db://assets/Scenes/Main.scene.' },
                ...SAVE_PROP,
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const uuid = (0, types_js_1.optionalString)(args, 'uuid');
            const url = (0, types_js_1.optionalString)(args, 'url');
            if (!uuid && !url)
                throw new types_js_1.ToolInputError('Provide "uuid" or "url".');
            const resolved = uuid ?? (await ctx.bridge.request('asset-db', 'query-uuid', url));
            if (!resolved)
                throw new types_js_1.ToolInputError(`No scene asset found for "${url}".`);
            const savedFirst = await guardDirty(ctx, args['save'] === true);
            await ctx.bridge.request('scene', 'open-scene', resolved);
            return { opened: resolved, ...(savedFirst ? { savedPrevious: true } : {}) };
        },
    },
    {
        name: 'scene_is_dirty',
        description: 'Whether the open scene has edits that are not saved to disk yet (tools that change the scene do not save it; use scene_save).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => ({ dirty: await isDirty(ctx), scene: await sceneCall(ctx, 'sceneInfo') }),
    },
    {
        name: 'scene_screenshot',
        description: 'Capture the editor Scene view as a PNG and return its file path (read the file to look at it). Pass uuid or path to frame that node first. The Scene panel must be open.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid to focus the camera on first.' },
                path: { type: 'string', description: 'Node path to focus the camera on first (used when uuid is absent).' },
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const uuid = (0, types_js_1.optionalString)(args, 'uuid');
            const path = (0, types_js_1.optionalString)(args, 'path');
            if (uuid || path) {
                const focus = uuid ?? (await ctx.bridge.scene('getNode', [{ path }])).uuid;
                await ctx.bridge.request('scene', 'focus-camera', [focus]);
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
            const { width, height, png } = await ctx.bridge.capture();
            const dir = (0, node_path_1.join)(ctx.bridge.projectPath(), 'temp', 'ccreator-mcp', 'screenshots');
            (0, node_fs_1.mkdirSync)(dir, { recursive: true });
            const file = (0, node_path_1.join)(dir, `scene-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
            (0, node_fs_1.writeFileSync)(file, png);
            // Screenshots are throwaway: keep only the latest few.
            for (const old of (0, node_fs_1.readdirSync)(dir).filter((name) => name.endsWith('.png')).sort().slice(0, -KEEP_SCREENSHOTS)) {
                try {
                    (0, node_fs_1.unlinkSync)((0, node_path_1.join)(dir, old));
                }
                catch {
                    /* already gone */
                }
            }
            return { file, width, height, bytes: png.length };
        },
    },
    {
        name: 'scene_save',
        description: 'Save the scene currently open in the editor.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => {
            await ctx.bridge.request('scene', 'save-scene');
            return { saved: true };
        },
    },
    {
        name: 'scene_create',
        description: 'Create a new empty scene asset at a db:// url and open it.',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Target url, e.g. db://assets/Scenes/Level2.scene.' }, ...SAVE_PROP },
            required: ['url'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const url = (0, types_js_1.requireString)(args, 'url');
            await guardDirty(ctx, args['save'] === true);
            // `create-asset` with null content makes a *directory*; a scene needs the engine's default scene file.
            const template = (await ctx.bridge.request('asset-db', 'query-asset-info', 'db://internal/default_file_content/scene/default.scene'));
            if (!template?.file)
                throw new Error('Default scene template not found in db://internal.');
            const content = (0, node_fs_1.readFileSync)(template.file, 'utf8');
            const created = await ctx.bridge.request('asset-db', 'create-asset', url, content);
            const uuid = created?.uuid;
            if (uuid) {
                await ctx.bridge.request('scene', 'open-scene', uuid);
                await ctx.bridge.request('scene', 'save-scene');
            }
            return (0, types_js_1.defined)({ created });
        },
    },
];
//# sourceMappingURL=scene-tools.js.map