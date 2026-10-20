"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnosticsTools = void 0;
const types_js_1 = require("./types.js");
const diagnostics_js_1 = require("../diagnostics.js");
const editor_tools_js_1 = require("./editor-tools.js");
exports.diagnosticsTools = [
    {
        name: 'script_diagnostics',
        description: 'Type-check the project scripts (under assets/) with the project tsconfig and return the errors with file, line and column. Run it after script_write. Also lists compile errors Creator logged in the last few minutes (an error from before your last fix can still be listed — check its time).',
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, description: 'Only these files (db:// urls or project-relative paths). Default: every script.' },
                limit: { type: 'number', description: 'Max diagnostics to return (default 50).' },
                sinceMinutes: { type: 'number', description: 'Only list Creator compile errors logged in the last N minutes (default 10).' },
            },
            additionalProperties: false,
        },
        handler: async (args, ctx) => {
            const files = ((0, types_js_1.optionalArray)(args, 'files') ?? []).filter((file) => typeof file === 'string');
            const limit = (0, types_js_1.optionalNumber)(args, 'limit');
            const result = (0, diagnostics_js_1.runDiagnostics)(ctx.bridge.projectPath(), ctx.bridge.appPath(), { files, ...(limit === undefined ? {} : { limit }) });
            const withinMs = ((0, types_js_1.optionalNumber)(args, 'sinceMinutes') ?? 10) * 60_000;
            const creatorErrors = (0, editor_tools_js_1.searchLogs)({ type: 'error', pattern: 'SyntaxError|ImportException|Cannot find module|compile', limit: 5, maxChars: 400, withinMs });
            return { ...result, recentCreatorErrors: creatorErrors };
        },
    },
];
//# sourceMappingURL=diagnostics-tools.js.map