"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetTools = exports.requireAssetInfo = exports.queryAssets = exports.slimAssets = exports.toContent = exports.assetFile = void 0;
/**
 * Asset tools — routed to the editor's `asset-db` module, which is the API the
 * Asset panel itself uses. `create` takes raw content the caller supplies; this
 * extension does not synthesise asset formats.
 */
const node_fs_1 = require("node:fs");
const types_js_1 = require("./types.js");
/** Accept a uuid or a db:// url (asset-db accepts either in most messages). */
const target = (args) => {
    const uuid = (0, types_js_1.optionalString)(args, 'uuid');
    const url = (0, types_js_1.optionalString)(args, 'url');
    if (!uuid && !url)
        throw new Error('Provide "uuid" or "url".');
    return uuid ?? url;
};
/** On-disk file of an asset (uuid or db:// url), from its asset-db record. */
const assetFile = async (ctx, args) => {
    const info = (await ctx.bridge.request('asset-db', 'query-asset-info', target(args)));
    if (!info?.file)
        throw new Error('Asset not found.');
    return info.file;
};
exports.assetFile = assetFile;
/** asset-db answers `null` for several successful operations; say what happened instead. */
const confirm = async (pending, done) => {
    const result = await pending;
    return result === null || result === undefined ? { ok: true, ...done } : result;
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
/** Read the asset-db record, failing loudly when there is none (asset-db answers `null`). */
const requireAssetInfo = async (ctx, ref) => {
    const info = (await ctx.bridge.request('asset-db', 'query-asset-info', ref));
    if (!info)
        throw new Error(`No asset found for "${ref}".`);
    return info;
};
exports.requireAssetInfo = requireAssetInfo;
/** Recursively merge `patch` into `base` (plain objects merge, everything else is replaced). */
const mergeDeep = (base, patch) => {
    if (!isPlain(base) || !isPlain(patch))
        return patch;
    const out = { ...base };
    for (const [key, value] of Object.entries(patch))
        out[key] = key in out ? mergeDeep(out[key], value) : value;
    return out;
};
const isPlain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
exports.assetTools = [
    {
        name: 'asset_query',
        description: 'Query assets by glob pattern and/or asset type (e.g. "cc.Texture2D", "cc.AudioClip", "cc.SpriteFrame"). Sub-assets (a texture\'s spriteFrame/texture) are left out unless you pass a type or includeSubAssets. Returns { total, returned, truncated, assets }.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob over db:// urls, e.g. db://assets/**/*.png.' },
                type: { type: 'string', description: 'Asset type, e.g. cc.Texture2D.' },
                limit: { type: 'number', description: 'Max assets to return (default 100).' },
                includeSubAssets: { type: 'boolean', description: 'Include sub-assets such as <image>/spriteFrame (default: only when "type" is given).' },
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const type = (0, types_js_1.optionalString)(args, 'type');
            const includeSub = (0, types_js_1.optionalBoolean)(args, 'includeSubAssets') ?? type !== undefined;
            const all = (await (0, exports.queryAssets)(ctx, (0, types_js_1.optionalString)(args, 'pattern'), type));
            const matches = includeSub ? all : all.filter((asset) => !String(asset['uuid'] ?? '').includes('@'));
            const limit = Math.max(1, (0, types_js_1.optionalNumber)(args, 'limit') ?? 100);
            return { total: matches.length, returned: Math.min(limit, matches.length), truncated: matches.length > limit, assets: matches.slice(0, limit) };
        },
    },
    {
        name: 'asset_info',
        description: 'Read the asset-db record for one asset (uuid or db:// url).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => (0, exports.requireAssetInfo)(ctx, target(args)),
    },
    {
        name: 'asset_refresh',
        description: 'Re-scan an asset or folder on disk so the asset db picks up files changed outside the editor (omit url to refresh all of db://assets).',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'db:// url of an asset or folder (default db://assets).' } },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const url = (0, types_js_1.optionalString)(args, 'url') ?? 'db://assets';
            await ctx.bridge.request('asset-db', 'refresh-asset', url);
            return { ok: true, refreshed: url };
        },
    },
    {
        name: 'asset_meta_get',
        description: 'Read an asset\'s .meta: importer and userData (import settings such as texture compression, sprite border/trim, audio).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const info = await (0, exports.requireAssetInfo)(ctx, target(args));
            const meta = (await ctx.bridge.request('asset-db', 'query-asset-meta', info['uuid']));
            if (!meta)
                throw new Error('This asset has no .meta.');
            return { uuid: info['uuid'], url: info['url'], importer: meta['importer'], userData: meta['userData'] ?? {}, subMetas: Object.keys(meta['subMetas'] ?? {}) };
        },
    },
    {
        name: 'asset_meta_set',
        description: 'Change an asset\'s import settings: `userData` is deep-merged into the existing .meta userData, then the asset is re-imported. Read it first with asset_meta_get.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string' },
                url: { type: 'string' },
                userData: { type: 'object', description: 'Partial userData to merge, e.g. {"compressSettings":{"useCompressTexture":true}}.' },
            },
            required: ['userData'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const patch = (0, types_js_1.optionalObject)(args, 'userData');
            if (!patch)
                throw new types_js_1.ToolInputError('"userData" must be an object.');
            const info = await (0, exports.requireAssetInfo)(ctx, target(args));
            const meta = (await ctx.bridge.request('asset-db', 'query-asset-meta', info['uuid']));
            if (!meta)
                throw new Error('This asset has no .meta.');
            const userData = mergeDeep(meta['userData'] ?? {}, patch);
            await ctx.bridge.request('asset-db', 'save-asset-meta', info['uuid'], JSON.stringify({ ...meta, userData }));
            await ctx.bridge.request('asset-db', 'reimport-asset', info['uuid']);
            return { ok: true, uuid: info['uuid'], userData };
        },
    },
    {
        name: 'asset_create',
        description: 'Create an asset from raw content at a db:// url.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'e.g. db://assets/data/level.json' },
                content: { ...types_js_1.JSON_VALUE, description: 'Raw content (string, or JSON value).' },
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
            properties: { uuid: { type: 'string' }, url: { type: 'string' }, content: types_js_1.JSON_VALUE },
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
        handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'move-asset', (0, types_js_1.requireString)(args, 'source'), (0, types_js_1.requireString)(args, 'target'), { overwrite: true }), { moved: (0, types_js_1.requireString)(args, 'source'), to: (0, types_js_1.requireString)(args, 'target') }),
    },
    {
        name: 'asset_delete',
        description: 'Delete an asset (uuid or db:// url).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'delete-asset', target(args)), { deleted: target(args) }),
    },
    {
        name: 'asset_reimport',
        description: 'Re-import an asset (re-run its importer).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'reimport-asset', target(args)), { reimported: target(args) }),
    },
    {
        name: 'asset_open',
        description: 'Open an asset in the editor (double-click equivalent).',
        inputSchema: {
            type: 'object',
            properties: { uuid: { type: 'string' }, url: { type: 'string' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'open-asset', target(args)), { opened: target(args) }),
    },
    {
        name: 'asset_read',
        description: 'Read the text content of an asset (script, json, scene, prefab, …). Binary files are refused.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string' },
                url: { type: 'string' },
                maxBytes: { type: 'number', description: 'Refuse files larger than this (default 1048576).' },
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const file = await (0, exports.assetFile)(ctx, args);
            if (!(0, node_fs_1.existsSync)(file) || !(0, node_fs_1.statSync)(file).isFile())
                throw new Error(`Not a file: ${file}`);
            const max = (0, types_js_1.optionalNumber)(args, 'maxBytes') ?? 1048576;
            if ((0, node_fs_1.statSync)(file).size > max)
                throw new Error(`File is larger than ${max} bytes; raise "maxBytes" to read it.`);
            const buffer = (0, node_fs_1.readFileSync)(file);
            if (buffer.includes(0))
                throw new Error('Binary asset — not readable as text.');
            return { file, content: buffer.toString('utf8') };
        },
    },
    {
        name: 'asset_import',
        description: 'Import a file from disk into the project (copies it to a db:// url and imports it).',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'Absolute path of the file on disk.' },
                url: { type: 'string', description: 'Target url, e.g. db://assets/textures/hero.png.' },
            },
            required: ['source', 'url'],
            additionalProperties: false,
        },
        handler: (args, ctx) => {
            const source = (0, types_js_1.requireString)(args, 'source');
            if (!(0, node_fs_1.existsSync)(source))
                throw new Error(`No such file: ${source}`);
            return ctx.bridge.request('asset-db', 'import-asset', source, (0, types_js_1.requireString)(args, 'url'), { overwrite: true });
        },
    },
    {
        name: 'asset_copy',
        description: 'Copy an asset to another db:// url.',
        inputSchema: {
            type: 'object',
            properties: { source: { type: 'string' }, target: { type: 'string' } },
            required: ['source', 'target'],
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'copy-asset', (0, types_js_1.requireString)(args, 'source'), (0, types_js_1.requireString)(args, 'target')),
    },
    {
        name: 'asset_mkdir',
        description: 'Create a folder at a db:// url.',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'e.g. db://assets/prefabs' } },
            required: ['url'],
            additionalProperties: false,
        },
        handler: (args, ctx) => ctx.bridge.request('asset-db', 'create-asset', (0, types_js_1.requireString)(args, 'url'), null),
    },
    {
        name: 'asset_dependencies',
        description: 'What an asset depends on, and (with users: true) which assets/scenes use it.',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string' },
                url: { type: 'string' },
                users: { type: 'boolean', description: 'Return the assets that use this one instead (default false).' },
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const info = (await ctx.bridge.request('asset-db', 'query-asset-info', target(args)));
            if (!info?.uuid)
                throw new Error('Asset not found.');
            return ctx.bridge.request('asset-db', args['users'] === true ? 'query-asset-users' : 'query-asset-dependencies', info.uuid);
        },
    },
];
//# sourceMappingURL=asset-tools.js.map