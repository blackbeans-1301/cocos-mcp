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
var types_js_2 = require("./types.js");
Object.defineProperty(exports, "ToolInputError", { enumerable: true, get: function () { return types_js_2.ToolInputError; } });
exports.TOOLS = [
    ...editor_tools_js_1.editorTools,
    ...scene_tools_js_1.sceneTools,
    ...node_tools_js_1.nodeTools,
    ...component_tools_js_1.componentTools,
    ...prefab_tools_js_1.prefabTools,
    ...asset_tools_js_1.assetTools,
    ...script_tools_js_1.scriptTools,
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