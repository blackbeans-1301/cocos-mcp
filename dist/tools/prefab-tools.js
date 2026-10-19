"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prefabTools = void 0;
const asset_tools_js_1 = require("./asset-tools.js");
const types_js_1 = require("./types.js");
const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' };
/** A tool that sends one `scene` message with the uuid of a prefab-instance node. */
const prefabNodeTool = (name, description, message) => ({
    name,
    description,
    inputSchema: {
        type: 'object',
        properties: {
            uuid: { type: 'string', description: 'Node uuid of the prefab instance.' },
            path: { type: 'string', description: 'Node path (used when uuid is absent).' },
        },
        additionalProperties: false,
    },
    handler: async (args, ctx) => {
        let uuid = (0, types_js_1.optionalString)(args, 'uuid');
        if (!uuid) {
            const path = (0, types_js_1.optionalString)(args, 'path');
            if (!path)
                throw new types_js_1.ToolInputError('Provide "uuid" or "path".');
            uuid = (await ctx.bridge.scene('getNode', [{ path }])).uuid;
        }
        await ctx.bridge.request('scene', message, uuid);
        return { ok: true, uuid };
    },
});
exports.prefabTools = [
    {
        name: 'prefab_list',
        description: 'List the prefab assets in the project (url + uuid).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: (_args, ctx) => (0, asset_tools_js_1.queryAssets)(ctx, 'db://assets/**/*.prefab', 'cc.Prefab'),
    },
    {
        name: 'prefab_info',
        description: 'Read an asset-db record for a prefab by uuid or db:// url.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string' },
                url: { type: 'string', description: 'e.g. db://assets/Prefabs/Enemy.prefab' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => {
            const uuid = (0, types_js_1.optionalString)(args, 'uuid');
            const url = (0, types_js_1.optionalString)(args, 'url');
            if (!uuid && !url)
                return (0, asset_tools_js_1.queryAssets)(ctx, 'db://assets/**/*.prefab', 'cc.Prefab');
            return ctx.bridge.request('asset-db', 'query-asset-info', uuid ?? url);
        },
    },
    {
        name: 'prefab_instantiate',
        description: 'Instantiate a prefab asset into the scene under a parent (defaults to the scene root).',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Prefab asset uuid.' },
                parentUuid: { type: 'string' },
                parentPath: { type: 'string' },
                position: VEC3,
            },
            required: ['uuid'],
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.scene('instantiatePrefab', [
            (0, types_js_1.defined)({
                uuid: (0, types_js_1.requireString)(args, 'uuid'),
                parentUuid: (0, types_js_1.optionalString)(args, 'parentUuid'),
                parentPath: (0, types_js_1.optionalString)(args, 'parentPath'),
                position: (0, types_js_1.optionalArray)(args, 'position'),
            }),
        ]),
    },
    {
        name: 'prefab_create_from_node',
        description: 'Create a prefab asset from a node in the open scene.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid (the node to turn into a prefab).' },
                path: { type: 'string', description: 'Node path (used when uuid is absent).' },
                url: { type: 'string', description: 'Target prefab url, e.g. db://assets/Prefabs/Enemy.prefab.' },
            },
            required: ['url'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            let nodeUuid = (0, types_js_1.optionalString)(args, 'uuid');
            const nodePath = (0, types_js_1.optionalString)(args, 'path');
            if (!nodeUuid) {
                if (!nodePath)
                    throw new types_js_1.ToolInputError('Provide "uuid" or "path".');
                nodeUuid = (await ctx.bridge.scene('getNode', [{ path: nodePath }])).uuid;
            }
            // Creator's message takes (nodeUuid, url) positionally; it returns nothing useful.
            await ctx.bridge.request('scene', 'create-prefab', nodeUuid, (0, types_js_1.requireString)(args, 'url'));
            return { created: (0, types_js_1.requireString)(args, 'url'), nodeUuid };
        },
    },
    prefabNodeTool('prefab_apply', "Apply a prefab instance's changes back to its prefab asset.", 'apply-prefab'),
    prefabNodeTool('prefab_revert', "Discard a prefab instance's overrides and restore it from the prefab asset.", 'restore-prefab'),
    prefabNodeTool('prefab_unlink', 'Detach a node from its prefab (it becomes a plain node).', 'unlink-prefab'),
];
//# sourceMappingURL=prefab-tools.js.map