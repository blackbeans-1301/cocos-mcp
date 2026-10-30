"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editorTools = exports.searchLogs = exports.levelOf = void 0;
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
const logBuffer = (g.__ccreatorLogBuffer ??= []);
const record = (type, message) => {
    logBuffer.push({ type, message: message.replace(/\r?\n$/, ''), time: new Date().toISOString() });
    if (logBuffer.length > LOG_LIMIT)
        logBuffer.shift();
};
if (!g.__ccreatorLogHooked) {
    g.__ccreatorLogHooked = true;
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
                g.__ccreatorInConsole = true;
                try {
                    original(...parts);
                }
                finally {
                    g.__ccreatorInConsole = false;
                }
            };
        }
    }
    for (const [stream, type] of [[process.stdout, 'log'], [process.stderr, 'error']]) {
        const original = stream.write.bind(stream);
        stream.write = (chunk, ...rest) => {
            if (!g.__ccreatorInConsole)
                record(type, typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
            return original(chunk, ...rest);
        };
    }
}
const STACK_LINE = /^\s+at\s/;
const compact = (message, stack, maxChars) => {
    const text = stack ? message : message.split('\n').filter((line) => !STACK_LINE.test(line)).join('\n');
    return maxChars > 0 && text.length > maxChars ? `${text.slice(0, maxChars)}… [${text.length - maxChars} more chars]` : text;
};
/**
 * The level a line really has. Lines forwarded from the scene process keep it in their text ("Warn: [Scene] …") but
 * reach this process through console.error/stderr, so the channel alone over-reports errors. Decided when reading,
 * not when recording: the console hook is installed once per editor session and survives extension reloads.
 */
const levelOf = (type, message) => {
    if (type !== 'error')
        return type;
    if (/^\s*\[?warn(ing)?\b/i.test(message))
        return 'warn';
    if (/^\s*\[?(log|info)\b[:\]]/i.test(message))
        return 'log';
    return type;
};
exports.levelOf = levelOf;
/** Filter the captured log buffer. Default output is compact: no stack frames, long messages cut. */
const searchLogs = (query) => {
    const matcher = query.pattern ? new RegExp(query.pattern, 'i') : null;
    const oldest = query.withinMs === undefined ? 0 : Date.now() - query.withinMs;
    return logBuffer
        .map((line) => ({ ...line, type: (0, exports.levelOf)(line.type, line.message) }))
        .filter((line) => (!query.type || line.type === query.type) && (!matcher || matcher.test(line.message)) && Date.parse(line.time) >= oldest)
        .slice(-(query.limit ?? 100))
        .map((line) => ({ ...line, message: compact(line.message, query.stack === true, query.maxChars ?? 800) }));
};
exports.searchLogs = searchLogs;
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
        description: 'Read recent editor/console log lines (captured from the editor main process since the extension loaded). Compact by default: stack frames are dropped and long messages cut; filter with type/pattern.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max lines to return (default 100).' },
                type: { type: 'string', enum: ['log', 'info', 'warn', 'error'], description: 'Only lines of this type.' },
                pattern: { type: 'string', description: 'Case-insensitive regular expression the message must match.' },
                stack: { type: 'boolean', description: 'Keep stack frames (default false).' },
                maxChars: { type: 'number', description: 'Cut messages longer than this (default 800; 0 = no limit).' },
            },
            additionalProperties: false,
        },
        handler: async (args) => {
            const type = (0, types_js_1.optionalEnum)(args, 'type', ['log', 'info', 'warn', 'error']);
            let entries;
            try {
                entries = (0, exports.searchLogs)((0, types_js_1.defined)({ limit: (0, types_js_1.optionalNumber)(args, 'limit'), type, pattern: (0, types_js_1.optionalString)(args, 'pattern'), stack: (0, types_js_1.optionalBoolean)(args, 'stack'), maxChars: (0, types_js_1.optionalNumber)(args, 'maxChars') }));
            }
            catch (err) {
                throw new types_js_1.ToolInputError(`Bad "pattern": ${err instanceof Error ? err.message : String(err)}`);
            }
            return { entries, total: logBuffer.length, note: 'Captured since the extension loaded (console + stdout/stderr of the editor main process).' };
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
        name: 'editor_console_clear',
        description: 'Empty the log buffer read by editor_console_logs (does not touch the editor console panel).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
            logBuffer.length = 0;
            return { cleared: true };
        },
    },
    {
        name: 'editor_undo',
        description: 'Undo the last scene edit (same as Ctrl+Z in the editor).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => {
            await ctx.bridge.request('scene', 'undo');
            return { ok: true };
        },
    },
    {
        name: 'editor_redo',
        description: 'Redo the last undone scene edit.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => {
            await ctx.bridge.request('scene', 'redo');
            return { ok: true };
        },
    },
    {
        name: 'selection_get',
        description: 'Uuids of the nodes currently selected in the editor.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => ({ nodes: ctx.bridge.selection() }),
    },
    {
        name: 'selection_set',
        description: 'Select nodes in the editor by uuid (an empty list clears the selection).',
        inputSchema: {
            type: 'object',
            properties: { uuids: { type: 'array', items: { type: 'string' } } },
            required: ['uuids'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const uuids = ((0, types_js_1.optionalArray)(args, 'uuids') ?? []).filter((u) => typeof u === 'string');
            ctx.bridge.select(uuids);
            return { nodes: uuids };
        },
    },
    {
        name: 'project_setting_get',
        description: 'Read a project setting (experimental). `package` is the profile name, e.g. "project"; `key` a dotted path, e.g. "general.designResolution".',
        inputSchema: {
            type: 'object',
            properties: { package: { type: 'string' }, key: { type: 'string' } },
            required: ['package', 'key'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => ({ value: (await ctx.bridge.getProjectSetting((0, types_js_1.requireString)(args, 'package'), (0, types_js_1.requireString)(args, 'key'))) ?? null }),
    },
    {
        name: 'project_setting_list',
        description: 'List what a project setting profile holds: the keys at `key` (default: the whole profile) with their type and a short preview, so you know which keys project_setting_get/set accept.',
        inputSchema: {
            type: 'object',
            properties: {
                package: { type: 'string', description: 'Profile name, e.g. "project".' },
                key: { type: 'string', description: 'Dotted path to look inside, e.g. "general" (default: top level).' },
            },
            required: ['package'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const key = (0, types_js_1.optionalString)(args, 'key') ?? '';
            const value = await ctx.bridge.getProjectSetting((0, types_js_1.requireString)(args, 'package'), key);
            if (typeof value !== 'object' || value === null)
                return { key, type: typeof value, value: value ?? null };
            const entries = Object.entries(value).map(([name, inner]) => ({
                key: key ? `${key}.${name}` : name,
                type: Array.isArray(inner) ? 'array' : inner === null ? 'null' : typeof inner,
                preview: (JSON.stringify(inner) ?? '').slice(0, 80),
            }));
            return { key, entries };
        },
    },
    {
        name: 'project_setting_set',
        description: 'Write a project setting (experimental; verify with project_setting_get).',
        inputSchema: {
            type: 'object',
            properties: { package: { type: 'string' }, key: { type: 'string' }, value: types_js_1.JSON_VALUE },
            required: ['package', 'key', 'value'],
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            if (!('value' in args))
                throw new types_js_1.ToolInputError('Provide "value".');
            await ctx.bridge.setProjectSetting((0, types_js_1.requireString)(args, 'package'), (0, types_js_1.requireString)(args, 'key'), args['value']);
            return { ok: true };
        },
    },
];
//# sourceMappingURL=editor-tools.js.map