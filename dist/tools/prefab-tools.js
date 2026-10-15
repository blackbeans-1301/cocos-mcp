"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prefabTools = void 0;
const types_js_1 = require("./types.js");
const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' };
exports.prefabTools = [
    {
        name: 'prefab_list',
        description: 'List the prefab assets in the project (url + uuid).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: (_args, ctx) => ctx.bridge.request('asset-db', 'query-assets', { type: 'cc.Prefab' }),
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
                return ctx.bridge.request('asset-db', 'query-assets', { type: 'cc.Prefab' });
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
        handler: (args, ctx) => {
            const nodeUuid = (0, types_js_1.optionalString)(args, 'uuid');
            const nodePath = (0, types_js_1.optionalString)(args, 'path');
            return ctx.bridge.request('scene', 'create-prefab', {
                ...(nodeUuid === undefined ? {} : { uuid: nodeUuid }),
                ...(nodePath === undefined ? {} : { path: nodePath }),
                url: (0, types_js_1.requireString)(args, 'url'),
            });
        },
    },
];
//# sourceMappingURL=prefab-tools.js.map