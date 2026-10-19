"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scriptTools = void 0;
const types_js_1 = require("./types.js");
const asset_tools_js_1 = require("./asset-tools.js");
const SCRIPT_URL = /\.(ts|js|mjs)$/;
exports.scriptTools = [
    {
        name: 'script_list',
        description: 'List the TypeScript/JavaScript scripts under db://assets (url + uuid).',
        inputSchema: {
            type: 'object',
            properties: { pattern: { type: 'string', description: 'Glob over db:// urls (default db://assets/**/*.ts).' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => (0, asset_tools_js_1.queryAssets)(ctx, (0, types_js_1.optionalString)(args, 'pattern') ?? 'db://assets/**/*.ts', undefined),
    },
    {
        name: 'script_write',
        description: 'Create a script, or overwrite it if it exists. Creator recompiles after the write; compile errors appear in the editor console (editor_console_logs).',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'e.g. db://assets/scripts/Player.ts' },
                content: { type: 'string', description: 'Full source of the file.' },
            },
            required: ['url', 'content'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const url = (0, types_js_1.requireString)(args, 'url');
            if (!SCRIPT_URL.test(url))
                throw new Error('A script url must end in .ts, .js or .mjs.');
            const content = (0, asset_tools_js_1.toContent)(args['content']);
            const existing = (await ctx.bridge.request('asset-db', 'query-asset-info', url));
            if (existing?.uuid) {
                await ctx.bridge.request('asset-db', 'save-asset', existing.uuid, content);
                return { url, uuid: existing.uuid, created: false };
            }
            const created = (await ctx.bridge.request('asset-db', 'create-asset', url, content));
            return { url, uuid: created?.uuid, created: true };
        },
    },
];
//# sourceMappingURL=script-tools.js.map