"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callTool = exports.findTool = exports.TOOLS = exports.ToolInputError = void 0;
const types_js_1 = require("./types.js");
const editor_tools_js_1 = require("./editor-tools.js");
const scene_tools_js_1 = require("./scene-tools.js");
const node_tools_js_1 = require("./node-tools.js");
const component_tools_js_1 = require("./component-tools.js");
const prefab_tools_js_1 = require("./prefab-tools.js");
const asset_tools_js_1 = require("./asset-tools.js");
const script_tools_js_1 = require("./script-tools.js");
const build_tools_js_1 = require("./build-tools.js");
const diagnostics_tools_js_1 = require("./diagnostics-tools.js");
var types_js_2 = require("./types.js");
Object.defineProperty(exports, "ToolInputError", { enumerable: true, get: function () { return types_js_2.ToolInputError; } });
const MAX_BATCH = 50;
/**
 * Run several tools in one request — saves round trips when an edit is many small steps.
 * Defined here because it dispatches to the other tools (a separate file would import this one in a cycle).
 * Each call is still its own undo step.
 */
const batchTool = {
    name: 'batch',
    description: `Run up to ${MAX_BATCH} tool calls in order in one request. Returns one result per call; by default it stops at the first failure. Each call is still its own undo step.`,
    inputSchema: {
        type: 'object',
        properties: {
            calls: {
                type: 'array',
                description: 'Calls to run, in order.',
                items: {
                    type: 'object',
                    properties: { tool: { type: 'string', description: 'Tool name.' }, args: { type: 'object', description: 'Tool arguments.' } },
                    required: ['tool'],
                    additionalProperties: false,
                },
            },
            stopOnError: { type: 'boolean', description: 'Stop at the first failing call (default true).' },
        },
        required: ['calls'],
        additionalProperties: false,
    },
    handler: async (args, ctx) => {
        const calls = (0, types_js_1.optionalArray)(args, 'calls');
        if (!calls || calls.length === 0)
            throw new types_js_1.ToolInputError('"calls" must be a non-empty array.');
        if (calls.length > MAX_BATCH)
            throw new types_js_1.ToolInputError(`At most ${MAX_BATCH} calls per batch.`);
        const stopOnError = args['stopOnError'] !== false;
        const results = [];
        for (const raw of calls) {
            const call = (0, types_js_1.asObject)(raw);
            const tool = typeof call['tool'] === 'string' ? call['tool'] : '';
            if (tool === 'batch') {
                results.push({ tool, ok: false, error: 'batch cannot be nested.' });
            }
            else {
                try {
                    const outcome = await (0, exports.callTool)(tool, call['args'], ctx);
                    results.push('toolError' in outcome ? { tool, ok: false, error: outcome.toolError } : { tool, ok: true, result: outcome.result });
                }
                catch (err) {
                    results.push({ tool, ok: false, error: err instanceof Error ? err.message : String(err) });
                }
            }
            if (stopOnError && results[results.length - 1]?.['ok'] === false)
                break;
        }
        const failed = results.filter((entry) => entry['ok'] === false).length;
        return { ok: failed === 0, completed: results.length - failed, failed, remaining: calls.length - results.length, results };
    },
};
exports.TOOLS = [
    ...editor_tools_js_1.editorTools,
    ...scene_tools_js_1.sceneTools,
    ...node_tools_js_1.nodeTools,
    ...component_tools_js_1.componentTools,
    ...prefab_tools_js_1.prefabTools,
    ...asset_tools_js_1.assetTools,
    ...script_tools_js_1.scriptTools,
    ...build_tools_js_1.buildTools,
    ...diagnostics_tools_js_1.diagnosticsTools,
    batchTool,
];
// Duplicate names would make tools/list ambiguous and the bug hard to see; fail loud at load.
{
    const seen = new Set();
    for (const tool of exports.TOOLS) {
        if (seen.has(tool.name))
            throw new Error(`Duplicate MCP tool name: ${tool.name}`);
        seen.add(tool.name);
    }
}
const findTool = (name) => exports.TOOLS.find((tool) => tool.name === name);
exports.findTool = findTool;
/**
 * Run a tool. Bad input (`ToolInputError`) is thrown so the protocol layer can
 * answer `-32602`; a tool that fails while running (editor error, bad editor
 * build) is returned as `toolError` so it becomes a tool result with
 * `isError: true` — the MCP convention for business errors.
 */
const callTool = async (name, args, ctx) => {
    const tool = (0, exports.findTool)(name);
    if (!tool)
        throw new types_js_1.ToolInputError(`Unknown tool: ${name}`);
    try {
        return { result: await tool.handler((0, types_js_1.asObject)(args), ctx) };
    }
    catch (err) {
        if (err instanceof types_js_1.ToolInputError)
            throw err;
        return { toolError: err instanceof Error ? err.message : String(err) };
    }
};
exports.callTool = callTool;
//# sourceMappingURL=index.js.map