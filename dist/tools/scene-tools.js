"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sceneTools = exports.sceneList = void 0;
const types_js_1 = require("./types.js");
const sceneCall = (ctx, method) => ctx.bridge.scene(method, []);
/** `.scene` assets in the project (asset-db `query-assets`, type `cc.SceneAsset`). */
const sceneList = async (ctx) => ctx.bridge.request('asset-db', 'query-assets', { type: 'cc.SceneAsset' });
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
            const created = await ctx.bridge.request('asset-db', 'create-asset', url, null);
            return (0, types_js_1.defined)({ created });
        },
    },
];
//# sourceMappingURL=scene-tools.js.map