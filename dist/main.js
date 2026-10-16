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
const node_os_1 = require("node:os");
const bridge_js_1 = require("./bridge.js");
const install_js_1 = require("./config/install.js");
const session_js_1 = require("./mcp/session.js");
const index_js_1 = require("./tools/index.js");
const PROFILE_KEY = 'mcpEnabled';
const PROFILE_PORT_KEY = 'mcpPort';
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
const PORT_MIN = 1024;
const PORT_MAX = 65535;
/** Accept only an integer in the unprivileged range (below 1024 needs root on Unix). */
const validPort = (value) => {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= PORT_MIN && parsed <= PORT_MAX ? parsed : undefined;
};
/** `ADSCRAFT_MCP_PORT=4000` — for cases where even the default clashes. Invalid values are ignored. */
const envPort = () => validPort(process.env['ADSCRAFT_MCP_PORT']);
/** Port the user chose in the panel (remembered per project). */
const profilePort = async () => validPort(await editor().Profile.getProject(bridge_js_1.EXTENSION_NAME, PROFILE_PORT_KEY));
/** Precedence: panel setting → environment variable → default. */
const desiredPort = async () => (await profilePort()) ?? envPort() ?? session_js_1.DEFAULT_MCP_PORT;
const isEnabled = async () => (await editor().Profile.getProject(bridge_js_1.EXTENSION_NAME, PROFILE_KEY)) !== false;
const status = async () => {
    const desired = await desiredPort();
    const session = (0, session_js_1.mcpStatus)();
    return {
        ...session,
        // `port` is the port actually bound (or the desired one when stopped);
        // `configuredPort` is what the panel shows in the input.
        port: session.port || desired,
        configuredPort: desired,
        enabled: await isEnabled(),
        toolCount: index_js_1.TOOLS.length,
        editorVersion: ctx.bridge.editorVersion(),
    };
};
const start = async () => {
    try {
        await (0, session_js_1.startMcp)(ctx, { port: await desiredPort(), serverInfo: { name: bridge_js_1.EXTENSION_NAME, version: version() } });
        console.log(`[adscraft-mcp] listening on ${(0, session_js_1.mcpStatus)().url}`);
    }
    catch (err) {
        // Never let a failure here kill the extension — the panel still has to open
        // so the user can read the error and retry.
        console.error('[adscraft-mcp] failed to start:', err);
    }
};
/** Where the coding-agent installer reads/writes: the user's home and the open project. */
const installContext = async () => {
    const desired = await desiredPort();
    return {
        home: (0, node_os_1.homedir)(),
        projectPath: editor().Project.path,
        url: (0, session_js_1.mcpStatus)().url || `http://127.0.0.1:${desired}/mcp`,
    };
};
exports.methods = {
    'open-panel': async () => {
        await editor().Panel.open(`${bridge_js_1.EXTENSION_NAME}.main`);
    },
    'mcp-status': () => status(),
    /** Which coding agents were found on this machine and whether we are configured in them. */
    'mcp-agents': async () => (0, install_js_1.agentStates)(await installContext()),
    /** Add or remove our MCP server in one agent's config. */
    'mcp-configure-agent': async (id, mode) => (0, install_js_1.configureAgent)(await installContext(), id, mode === 'remove' ? 'remove' : 'add'),
    'mcp-set-enabled': async (enabled) => {
        await editor().Profile.setProject(bridge_js_1.EXTENSION_NAME, PROFILE_KEY, enabled === true);
        if (enabled === true)
            await start();
        else
            await (0, session_js_1.stopMcp)();
        return status();
    },
    /** Save a new port and restart the server on it. Rejects on an invalid port. */
    'mcp-set-port': async (port) => {
        const value = validPort(port);
        if (value === undefined) {
            throw new Error(`Port must be an integer between ${PORT_MIN} and ${PORT_MAX}.`);
        }
        await editor().Profile.setProject(bridge_js_1.EXTENSION_NAME, PROFILE_PORT_KEY, value);
        await (0, session_js_1.stopMcp)();
        await start();
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