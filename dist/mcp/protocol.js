"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidRequest = exports.parseError = exports.handleMessage = exports.LATEST_PROTOCOL_VERSION = exports.PROTOCOL_VERSIONS = void 0;
const index_js_1 = require("../tools/index.js");
exports.PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
exports.LATEST_PROTOCOL_VERSION = exports.PROTOCOL_VERSIONS[0];
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const failure = (id, code, message) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
});
const success = (id, result) => ({ jsonrpc: '2.0', id, result });
const idOf = (raw) => {
    const id = raw['id'];
    return typeof id === 'string' || typeof id === 'number' ? id : null;
};
const negotiateProtocolVersion = (params) => {
    const requested = isRecord(params) ? params['protocolVersion'] : undefined;
    return typeof requested === 'string' && exports.PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : exports.LATEST_PROTOCOL_VERSION;
};
const INSTRUCTIONS = 'AdsCraft MCP drives the open Cocos Creator project. Start with `editor_status` and `scene_info` ' +
    'to see what is open, `node_tree` to read the hierarchy, then use the node/component/prefab/asset tools. ' +
    '`scene_script` and `editor_script` are escape hatches that run arbitrary JavaScript inside the engine ' +
    'and the editor respectively — prefer the typed tools, they validate input and are safer.';
const handleMessage = async (raw, ctx, serverInfo, 
/** Session-id factory, injected so tests are deterministic. */
newSessionId) => {
    if (!isRecord(raw) || raw['jsonrpc'] !== '2.0' || typeof raw['method'] !== 'string') {
        return { body: failure(null, INVALID_REQUEST, 'Invalid JSON-RPC request.') };
    }
    const method = raw['method'];
    const id = idOf(raw);
    const isNotification = !('id' in raw);
    switch (method) {
        case 'initialize':
            return {
                body: success(id, {
                    protocolVersion: negotiateProtocolVersion(raw['params']),
                    capabilities: { tools: {} },
                    serverInfo,
                    instructions: INSTRUCTIONS,
                }),
                newSessionId: newSessionId(),
            };
        case 'ping':
            return { body: success(id, {}) };
        case 'tools/list':
            return {
                body: success(id, {
                    tools: index_js_1.TOOLS.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                    })),
                }),
            };
        case 'tools/call': {
            const params = isRecord(raw['params']) ? raw['params'] : {};
            const name = params['name'];
            if (typeof name !== 'string')
                return { body: failure(id, INVALID_PARAMS, '"name" is required.') };
            try {
                const called = await (0, index_js_1.callTool)(name, params['arguments'], ctx);
                if ('toolError' in called) {
                    return { body: success(id, { content: [{ type: 'text', text: called.toolError }], isError: true }) };
                }
                return { body: success(id, { content: [{ type: 'text', text: JSON.stringify(called.result, null, 2) }] }) };
            }
            catch (err) {
                if (err instanceof index_js_1.ToolInputError)
                    return { body: failure(id, INVALID_PARAMS, err.message) };
                throw err;
            }
        }
        case 'resources/list':
            return { body: success(id, { resources: [] }) };
        case 'resources/templates/list':
            return { body: success(id, { resourceTemplates: [] }) };
        case 'prompts/list':
            return { body: success(id, { prompts: [] }) };
        case 'logging/setLevel':
            return { body: success(id, {}) };
        default:
            return isNotification ? { body: null } : { body: failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`) };
    }
};
exports.handleMessage = handleMessage;
const parseError = () => failure(null, PARSE_ERROR, 'Parse error.');
exports.parseError = parseError;
const invalidRequest = (message) => failure(null, INVALID_REQUEST, message);
exports.invalidRequest = invalidRequest;
//# sourceMappingURL=protocol.js.map