"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editorTools = void 0;
const types_js_1 = require("./types.js");
const normalizeConsole = (raw) => {
    const list = Array.isArray(raw) ? raw : [];
    return list.map((entry) => {
        const e = (0, types_js_1.asObject)(entry);
        return {
            type: typeof e['type'] === 'string' ? e['type'] : 'log',
            message: typeof e['message'] === 'string' ? e['message'] : String(e['message'] ?? ''),
            ...(typeof e['time'] === 'string' ? { time: e['time'] } : {}),
            ...(typeof e['stack'] === 'string' ? { stack: e['stack'] } : {}),
        };
    });
};
const escapeHatch = (name, description, run) => ({
    name,
    description,
    inputSchema: {
        type: 'object',
        properties: {
            code: { type: 'string', description: 'Async function body; `return` the result.' },
            args: { description: 'Value passed as `args`.' },
        },
        required: ['code'],
        additionalProperties: false,
    },
    handler: (args, ctx) => run((0, types_js_1.requireString)(args, 'code'), args['args'] ?? null, ctx),
});
exports.editorTools = [
    {
        name: 'editor_status',
        description: 'Cocos Creator version and the open project path — call this first.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => ({
            editorVersion: ctx.bridge.editorVersion(),
            projectPath: ctx.bridge.projectPath(),
            transport: 'streamable-http',
            endpoint: '/mcp',
        }),
    },
    {
        name: 'editor_project_info',
        description: 'Basic info about the project open in the editor.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => ({
            path: ctx.bridge.projectPath(),
            editorVersion: ctx.bridge.editorVersion(),
        }),
    },
    {
        name: 'editor_console_logs',
        description: 'Read recent editor/console log lines (best effort — depends on the Creator build).',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Max lines to return (default 100).' } },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const limit = (0, types_js_1.optionalNumber)(args, 'limit') ?? 100;
            try {
                const raw = await ctx.bridge.request('scene', 'query-console-logs');
                return { entries: normalizeConsole(raw).slice(-limit) };
            }
            catch (err) {
                return {
                    entries: [],
                    error: err instanceof Error ? err.message : String(err),
                    hint: 'Console reading depends on the Creator build. Use editor_script to read logs directly if this fails.',
                };
            }
        },
    },
    escapeHatch('editor_script', 'Escape hatch: run JavaScript in the editor main process. In scope: `Editor`, `require`, `args`. Return a JSON-serializable value.', async (code, args) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function('Editor', 'require', 'args', `"use strict"; return (async () => { ${code}\n })();`);
        const editor = globalThis.Editor;
        return fn(editor, require, args);
    }),
    escapeHatch('scene_script', 'Escape hatch: run JavaScript in the engine runtime (same context as project scripts). In scope: `cc`, `args`. Return a JSON-serializable value.', (code, args, ctx) => {
        const payload = { code };
        if (args !== null)
            payload['args'] = args;
        return ctx.bridge.scene('evalScript', [payload]);
    }),
    {
        name: 'project_build',
        description: 'Start a Cocos build task (e.g. web-mobile). Build options depend on the Creator build — experimental.',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: 'Build platform, e.g. web-mobile (default web-mobile).' },
                debug: { type: 'boolean', description: 'Debug build (default false).' },
                buildPath: { type: 'string', description: 'Output directory.' },
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const platform = (0, types_js_1.optionalString)(args, 'platform') ?? 'web-mobile';
            const options = {
                name: platform,
                platform,
                debug: (0, types_js_1.optionalBoolean)(args, 'debug') ?? false,
            };
            const buildPath = (0, types_js_1.optionalString)(args, 'buildPath');
            if (buildPath)
                options['buildPath'] = buildPath;
            return ctx.bridge.request('builder', 'add-task', options);
        },
    },
];
//# sourceMappingURL=editor-tools.js.map