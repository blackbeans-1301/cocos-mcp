"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMcpHttp = exports.MCP_PATH = void 0;
/**
 * Streamable HTTP transport for the MCP server, bound to `127.0.0.1`.
 *
 * HTTP (not stdio) because the server lives **inside the editor process**: an AI
 * client connects to a local port it does not spawn. This is the shape every
 * other Cocos Creator MCP extension uses, and it is what lets a client attach to
 * a running editor.
 *
 * Only the loopback interface is bound, and non-loopback `Origin`/`Host` headers
 * are rejected: this port can create/delete assets and run scripts in the open
 * project, so a random web page on the machine must not be able to reach it
 * (MCP's DNS-rebinding guidance). `GET /mcp` returns `405` — no server-initiated
 * SSE stream, every request answers with a single JSON body.
 */
const node_crypto_1 = require("node:crypto");
const node_http_1 = require("node:http");
const protocol_js_1 = require("./protocol.js");
exports.MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 1 << 20;
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1']);
const hostNameOf = (value) => {
    if (!value)
        return '';
    if (value.startsWith('[')) {
        const end = value.indexOf(']');
        return (end === -1 ? value : value.slice(1, end)).toLowerCase();
    }
    const colon = value.indexOf(':');
    return (colon === -1 ? value : value.slice(0, colon)).toLowerCase();
};
/** No `Origin` = not a browser (CLI/AI client) → allow. Present → must be loopback. */
const originAllowed = (origin) => {
    if (origin === undefined)
        return true;
    try {
        return LOOPBACK_NAMES.has(new URL(origin).hostname);
    }
    catch {
        return false;
    }
};
const sendJson = (res, status, body, headers = {}) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(payload.length),
        ...headers,
    });
    res.end(payload);
};
/** Reads the request body; `null` once it exceeds the cap (socket destroyed). */
const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            resolve(null);
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});
const startMcpHttp = async (ctx, options) => {
    const sessions = new Set();
    const serverInfo = options.serverInfo;
    const handle = async (req, res) => {
        if (!LOOPBACK_NAMES.has(hostNameOf(req.headers.host))) {
            sendJson(res, 403, (0, protocol_js_1.invalidRequest)('Forbidden host.'));
            return;
        }
        if (!originAllowed(req.headers.origin)) {
            sendJson(res, 403, (0, protocol_js_1.invalidRequest)('Forbidden origin.'));
            return;
        }
        const path = (req.url ?? '').split('?')[0];
        if (path !== exports.MCP_PATH) {
            sendJson(res, 404, (0, protocol_js_1.invalidRequest)(`Not found: ${path}`));
            return;
        }
        const header = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(header) ? header[0] : header;
        if (sessionId !== undefined && !sessions.has(sessionId)) {
            sendJson(res, 404, (0, protocol_js_1.invalidRequest)('Unknown session.'));
            return;
        }
        if (req.method === 'DELETE') {
            if (sessionId !== undefined)
                sessions.delete(sessionId);
            res.writeHead(204).end();
            return;
        }
        if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST, DELETE' }).end();
            return;
        }
        const raw = await readBody(req);
        if (raw === null) {
            sendJson(res, 413, (0, protocol_js_1.invalidRequest)('Request body too large.'));
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            sendJson(res, 400, (0, protocol_js_1.parseError)());
            return;
        }
        const result = await (0, protocol_js_1.handleMessage)(parsed, ctx, serverInfo, node_crypto_1.randomUUID);
        const headers = {};
        if (result.newSessionId !== undefined) {
            sessions.add(result.newSessionId);
            headers['mcp-session-id'] = result.newSessionId;
        }
        if (result.body === null) {
            res.writeHead(202, headers).end();
            return;
        }
        sendJson(res, 200, result.body, headers);
    };
    const server = (0, node_http_1.createServer)((req, res) => {
        void handle(req, res).catch((err) => {
            const detail = err instanceof Error ? err.message : String(err);
            if (res.headersSent)
                res.end();
            else
                sendJson(res, 500, (0, protocol_js_1.invalidRequest)(`Internal error: ${detail}`));
        });
    });
    const listen = (port) => new Promise((resolve, reject) => {
        const onError = (err) => {
            server.removeListener('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve(server.address().port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
    let boundPort;
    try {
        boundPort = await listen(options.port);
    }
    catch (err) {
        // Configured port taken (a second editor, another tool): fall back to a free
        // one rather than refusing to start; the panel shows the real port.
        if (err.code === 'EADDRINUSE')
            boundPort = await listen(0);
        else
            throw err;
    }
    return {
        url: `http://127.0.0.1:${boundPort}${exports.MCP_PATH}`,
        port: boundPort,
        close: () => new Promise((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections?.();
        }),
    };
};
exports.startMcpHttp = startMcpHttp;
//# sourceMappingURL=server.js.map