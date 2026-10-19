"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editorTools = void 0;
const types_js_1 = require("./types.js");
/**
 * Ring buffer of main-process output — Creator 3.8.8 has no `query-console-logs` message.
 *
 * Captured two ways, because which one sees a line depends on how Creator wires `console`:
 * the global `console` methods, and `process.stdout/stderr.write` (which also carries the
 * `[Scene] ...` lines relayed from the scene process). A line seen by both is stored once.
 */
const LOG_LIMIT = 500;
// Kept on globalThis: an extension reload re-evaluates this module but the patches from the first load survive.
const g = globalThis;
const logBuffer = (g.__adscraftLogBuffer ??= []);
const record = (type, message) => {
    logBuffer.push({ type, message: message.replace(/\r?\n$/, ''), time: new Date().toISOString() });
    if (logBuffer.length > LOG_LIMIT)
        logBuffer.shift();
};
if (!g.__adscraftLogHooked) {
    g.__adscraftLogHooked = true;
    const fmt = (parts) => parts.map((p) => (typeof p === 'string' ? p : p instanceof Error ? p.stack ?? p.message : safeJson(p))).join(' ');
    const safeJson = (v) => {
        try {
            return JSON.stringify(v) ?? String(v);
        }
        catch {
            return String(v);
        }
    };
    // `console` here and `globalThis.console` can be different objects inside Creator's module wrapper.
    const targets = new Set([console, globalThis.console]);
    for (const target of targets) {
        for (const type of ['log', 'info', 'warn', 'error']) {
            const original = target[type].bind(target);
            target[type] = (...parts) => {
                record(type, fmt(parts));
                g.__adscraftInConsole = true;
                try {
                    original(...parts);
                }
                finally {
                    g.__adscraftInConsole = false;
                }
            };
        }
    }
    for (const [stream, type] of [[process.stdout, 'log'], [process.stderr, 'error']]) {
        const original = stream.write.bind(stream);
        stream.write = (chunk, ...rest) => {
            if (!g.__adscraftInConsole)
                record(type, typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
            return original(chunk, ...rest);
        };
    }
}
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
        description: 'Read recent editor/console log lines (captured from the editor main process since the extension loaded).',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Max lines to return (default 100).' } },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const limit = (0, types_js_1.optionalNumber)(args, 'limit') ?? 100;
            return { entries: normalizeConsole(logBuffer).slice(-limit), total: logBuffer.length, note: 'Captured since the extension loaded (console + stdout/stderr of the editor main process).' };
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
            const task = await ctx.bridge.request('builder', 'add-task', options);
            return {
                started: true,
                task,
                hint: 'The build runs in the background — this call does not wait. It is done when <buildPath or build/>/<platform>/index.html exists.',
            };
        },
    },
];
//# sourceMappingURL=editor-tools.js.map