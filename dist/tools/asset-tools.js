"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetTools = void 0;
const types_js_1 = require("./types.js");
/** Accept a uuid or a db:// url (asset-db accepts either in most messages). */
const target = (args) => {
    const uuid = (0, types_js_1.optionalString)(args, 'uuid');
    const url = (0, types_js_1.optionalString)(args, 'url');
    if (!uuid && !url)
        throw new Error('Provide "uuid" or "url".');
    return uuid ?? url;
};
exports.assetTools = [
    {
        name: 'asset_query',
        description: 'Query assets by glob pattern and/or asset type (e.g. "cc.Texture2D", "cc.AudioClip", "cc.SpriteFrame").',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob over db:// urls, e.g. db://assets/**/*.png.' },
                type: { type: 'string', description: 'Asset type, e.g. cc.Texture2D.' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'query-assets', (0, types_js_1.defined)({ pattern: (0, types_js_1.optionalString)(args, 'pattern'), type: (0, types_js_1.optionalString)(args, 'type') })),
    },
    {
        name: 'asset_info',
        description: 'Read the asset-db record for one asset (uuid or db:// url).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'query-asset-info', target(args)),
    },
    {
        name: 'asset_create',
        description: 'Create an asset from raw content at a db:// url.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'e.g. db://assets/data/level.json' },
                content: { description: 'Raw content (string, or JSON value).' },
            },
            required: ['url'],
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'create-asset', (0, types_js_1.requireString)(args, 'url'), args['content'] ?? null),
    },
    {
        name: 'asset_save',
        description: 'Overwrite an asset with new raw content.',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' }, content: {} },
            required: ['content'],
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'save-asset', target(args), args['content']),
    },
    {
        name: 'asset_move',
        description: 'Move/rename an asset. Both source and target are db:// urls.',
        inputSchema: {
            type: 'object',
            properties: { source: { type: 'string' }, target: { type: 'string' } },
            required: ['source', 'target'],
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'move-asset', (0, types_js_1.requireString)(args, 'source'), (0, types_js_1.requireString)(args, 'target'), { overwrite: true }),
    },
    {
        name: 'asset_delete',
        description: 'Delete an asset (uuid or db:// url).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'delete-asset', target(args)),
    },
    {
        name: 'asset_reimport',
        description: 'Re-import an asset (re-run its importer).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'reimport-asset', target(args)),
    },
    {
        name: 'asset_open',
        description: 'Open an asset in the editor (double-click equivalent).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'open-asset', target(args)),
    },
];
//# sourceMappingURL=asset-tools.js.map