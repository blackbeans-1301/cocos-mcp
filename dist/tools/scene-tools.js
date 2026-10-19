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
const asset_tools_js_1 = require("./asset-tools.js");
const types_js_1 = require("./types.js");
const sceneCall = (ctx, method) => ctx.bridge.scene(method, []);
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
            await ctx.bridge.request('scene', 'open-scene', resolved);
            return { opened: resolved };
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
            properties: { url: { type: 'string', description: 'Target url, e.g. db://assets/Scenes/Level2.scene.' } },
            required: ['url'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const url = (0, types_js_1.requireString)(args, 'url');
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