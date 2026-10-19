"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetTools = exports.queryAssets = exports.slimAssets = exports.toContent = void 0;
const types_js_1 = require("./types.js");
/** Accept a uuid or a db:// url (asset-db accepts either in most messages). */
const target = (args) => {
    const uuid = (0, types_js_1.optionalString)(args, 'uuid');
    const url = (0, types_js_1.optionalString)(args, 'url');
    if (!uuid && !url)
        throw new Error('Provide "uuid" or "url".');
    return uuid ?? url;
};
/** asset-db wants string content; objects (JSON assets) are serialised. */
const toContent = (value) => {
    if (value === undefined || value === null)
        return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};
exports.toContent = toContent;
/** Slim an asset-db record to what an agent needs (the raw records are huge). */
const slimAssets = (raw) => Array.isArray(raw)
    ? raw.map((a) => {
        const r = (a ?? {});
        return { url: r['url'], uuid: r['uuid'], type: r['type'], name: r['name'] };
    })
    : raw;
exports.slimAssets = slimAssets;
/** `query-assets` filters by `ccType`/`pattern`; an unknown `type` key is silently ignored. */
const queryAssets = async (ctx, pattern, ccType) => (0, exports.slimAssets)(await ctx.bridge.request('asset-db', 'query-assets', (0, types_js_1.defined)({ pattern: pattern ?? 'db://assets/**', ccType })));
exports.queryAssets = queryAssets;
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
        handler: (args, ctx) => (0, exports.queryAssets)(ctx, (0, types_js_1.optionalString)(args, 'pattern'), (0, types_js_1.optionalString)(args, 'type')),
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
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'create-asset', (0, types_js_1.requireString)(args, 'url'), (0, exports.toContent)(args['content']), { overwrite: true }),
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
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'save-asset', target(args), (0, exports.toContent)(args['content'])),
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