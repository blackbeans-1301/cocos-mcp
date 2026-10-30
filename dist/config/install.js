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
const defaultSkillsSource = (0, node_path_1.join)(__dirname, '..', '..', 'skills');
/** Names of the skills we ship: every subfolder of the source that holds a SKILL.md. */
const shippedSkills = (ctx) => {
    const source = ctx.skillsSource ?? defaultSkillsSource;
    if (!(0, node_fs_1.existsSync)(source))
        return [];
    return (0, node_fs_1.readdirSync)(source, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && (0, node_fs_1.existsSync)((0, node_path_1.join)(source, entry.name, 'SKILL.md')))
        .map((entry) => entry.name);
};
const skillFolder = (spec, ctx, name) => spec.skills ? resolve(spec.skills.scope, (0, node_path_1.join)(spec.skills.dir, name), ctx) : undefined;
const skillsInstalled = (spec, ctx) => {
    if (!spec.skills)
        return false;
    const names = shippedSkills(ctx);
    return names.length > 0 && names.every((name) => (0, node_fs_1.existsSync)((0, node_path_1.join)(skillFolder(spec, ctx, name), 'SKILL.md')));
};
/** Copy our skills into the agent's skills folder (replacing our own copies, touching nothing else). */
const installSkills = (spec, ctx) => {
    if (!spec.skills)
        return;
    const source = ctx.skillsSource ?? defaultSkillsSource;
    for (const name of shippedSkills(ctx)) {
        const target = skillFolder(spec, ctx, name);
        (0, node_fs_1.rmSync)(target, { recursive: true, force: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
        (0, node_fs_1.cpSync)((0, node_path_1.join)(source, name), target, { recursive: true });
    }
};
/** Remove only the skill folders we ship, by name. */
const removeSkills = (spec, ctx) => {
    if (!spec.skills)
        return;
    for (const name of shippedSkills(ctx))
        (0, node_fs_1.rmSync)(skillFolder(spec, ctx, name), { recursive: true, force: true });
};
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
    return {
        id: spec.id,
        name: spec.name,
        file,
        scope: spec.scope,
        installed,
        configured,
        skillsSupported: Boolean(spec.skills),
        skills: skillsInstalled(spec, ctx),
        docs: spec.docs,
        error,
    };
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
    if (mode === 'add')
        installSkills(spec, ctx);
    else
        removeSkills(spec, ctx);
    const state = (0, exports.agentStates)(ctx).find((agent) => agent.id === id);
    if (!state)
        throw new Error(`Unknown agent: ${id}`);
    return state;
};
exports.configureAgent = configureAgent;
//# sourceMappingURL=install.js.map