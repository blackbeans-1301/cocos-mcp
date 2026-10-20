"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureAgent = exports.agentStates = void 0;
/**
 * Filesystem side of the coding-agent config writer: detect which agents are
 * installed, read their config, write the merged result back.
 *
 * Only the file of the selected agent is written, and only via `upsertServer` /
 * `removeServer` — other keys in that file stay untouched.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const agents_js_1 = require("./agents.js");
const resolve = (scope, path, ctx) => scope === 'home' ? (0, node_path_1.join)(ctx.home, path) : (0, node_path_1.join)(ctx.projectPath, path);
const fileFor = (spec, ctx) => resolve(spec.scope, spec.file, ctx);
const agentStates = (ctx) => agents_js_1.AGENTS.map((spec) => {
    const file = fileFor(spec, ctx);
    let configured = false;
    let error = '';
    if ((0, node_fs_1.existsSync)(file)) {
        try {
            const text = (0, node_fs_1.readFileSync)(file, 'utf8');
            configured = (0, agents_js_1.hasServer)(text, spec.kind);
            // `hasServer` treats an unparsable file as "not configured"; a dry-run upsert (nothing is written)
            // surfaces the real problem so the panel can show it instead of offering a button that will fail.
            if (!configured && text.trim() !== '')
                (0, agents_js_1.upsertServer)(text, spec.kind, ctx.url);
        }
        catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
    }
    const installed = spec.detect.some((probe) => (0, node_fs_1.existsSync)(resolve(probe.scope, probe.path, ctx)));
    return { id: spec.id, name: spec.name, file, scope: spec.scope, installed, configured, docs: spec.docs, error };
});
exports.agentStates = agentStates;
/** Add or remove our entry for one agent. Returns the agent's new state. */
const configureAgent = (ctx, id, mode) => {
    const spec = agents_js_1.AGENTS.find((agent) => agent.id === id);
    if (!spec)
        throw new Error(`Unknown agent: ${id}`);
    const file = fileFor(spec, ctx);
    const current = (0, node_fs_1.existsSync)(file) ? (0, node_fs_1.readFileSync)(file, 'utf8') : '';
    const next = mode === 'add' ? (0, agents_js_1.upsertServer)(current, spec.kind, ctx.url) : (0, agents_js_1.removeServer)(current, spec.kind);
    if (next !== current) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(file), { recursive: true });
        (0, node_fs_1.writeFileSync)(file, next, 'utf8');
    }
    const state = (0, exports.agentStates)(ctx).find((agent) => agent.id === id);
    if (!state)
        throw new Error(`Unknown agent: ${id}`);
    return state;
};
exports.configureAgent = configureAgent;
//# sourceMappingURL=install.js.map