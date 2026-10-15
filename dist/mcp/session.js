"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopMcp = exports.startMcp = exports.mcpStatus = exports.DEFAULT_MCP_PORT = void 0;
const server_js_1 = require("./server.js");
/** Default port. 3000 is the de-facto port for Cocos Creator MCP extensions. */
exports.DEFAULT_MCP_PORT = 3000;
let handle = null;
let starting = null;
let lastError = '';
let configuredPort = exports.DEFAULT_MCP_PORT;
const mcpStatus = () => ({
    running: handle !== null,
    url: handle?.url ?? '',
    port: handle?.port ?? configuredPort,
    error: lastError,
});
exports.mcpStatus = mcpStatus;
const startMcp = (ctx, options = {}) => {
    if (handle)
        return Promise.resolve();
    if (starting)
        return starting;
    configuredPort = options.port ?? configuredPort;
    const serverInfo = options.serverInfo ?? { name: 'ads-craft-mcp', version: '0.0.0' };
    const attempt = (async () => {
        try {
            handle = await (0, server_js_1.startMcpHttp)(ctx, { port: configuredPort, serverInfo });
            lastError = '';
        }
        catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            throw err;
        }
        finally {
            starting = null;
        }
    })();
    starting = attempt;
    return attempt;
};
exports.startMcp = startMcp;
const stopMcp = async () => {
    const current = handle;
    handle = null;
    if (current)
        await current.close();
};
exports.stopMcp = stopMcp;
//# sourceMappingURL=session.js.map