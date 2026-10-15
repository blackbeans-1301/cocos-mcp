"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unload = exports.load = exports.methods = void 0;
/**
 * Extension lifecycle: start the MCP server when the editor loads (if enabled),
 * expose the panel messages, stop the server on unload.
 *
 * The server starts by default: the whole point is that an AI client can attach
 * to a running editor without extra steps. It can be turned off in the panel,
 * and the choice is remembered per project.
 */
const bridge_js_1 = require("./bridge.js");
const session_js_1 = require("./mcp/session.js");
const index_js_1 = require("./tools/index.js");
const PROFILE_KEY = 'mcpEnabled';
const editor = () => globalThis.Editor;
const version = () => {
    try {
        // `../package.json` relative to `dist/main.js` (extension root). Kept as a
        // runtime read so the version has a single source: package.json.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('../package.json').version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
};
const ctx = { bridge: (0, bridge_js_1.createBridge)() };
const isEnabled = async () => (await editor().Profile.getProject(bridge_js_1.EXTENSION_NAME, PROFILE_KEY)) !== false;
const status = async () => ({
    ...(0, session_js_1.mcpStatus)(),
    enabled: await isEnabled(),
    toolCount: index_js_1.TOOLS.length,
    editorVersion: ctx.bridge.editorVersion(),
    port: (0, session_js_1.mcpStatus)().port || session_js_1.DEFAULT_MCP_PORT,
});
const start = async () => {
    try {
        await (0, session_js_1.startMcp)(ctx, { serverInfo: { name: bridge_js_1.EXTENSION_NAME, version: version() } });
        console.log(`[adscraft-mcp] listening on ${(0, session_js_1.mcpStatus)().url}`);
    }
    catch (err) {
        // Never let a failure here kill the extension — the panel still has to open
        // so the user can read the error and retry.
        console.error('[adscraft-mcp] failed to start:', err);
    }
};
exports.methods = {
    'open-panel': async () => {
        await editor().Panel.open(`${bridge_js_1.EXTENSION_NAME}.main`);
    },
    'mcp-status': () => status(),
    'mcp-set-enabled': async (enabled) => {
        await editor().Profile.setProject(bridge_js_1.EXTENSION_NAME, PROFILE_KEY, enabled === true);
        if (enabled === true)
            await start();
        else
            await (0, session_js_1.stopMcp)();
        return status();
    },
    'mcp-restart': async () => {
        await (0, session_js_1.stopMcp)();
        await start();
        return status();
    },
};
const load = () => {
    void isEnabled()
        .then((enabled) => (enabled ? start() : undefined))
        .catch((err) => console.error('[adscraft-mcp] load failed:', err));
};
exports.load = load;
const unload = () => {
    void (0, session_js_1.stopMcp)().catch(() => undefined);
};
exports.unload = unload;
//# sourceMappingURL=main.js.map