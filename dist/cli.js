#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Standalone coding-agent configurator — same writer as the panel, usable from a
 * shell so it can be dropped into a dotfiles / onboarding script.
 *
 *   node dist/cli.js                 # add to every detected agent
 *   node dist/cli.js --list          # show agents and their state, write nothing
 *   node dist/cli.js --remove        # remove from every agent
 *   node dist/cli.js --agent cursor  # only these agents (repeatable)
 *   node dist/cli.js --url http://127.0.0.1:4000/mcp
 */
const node_os_1 = require("node:os");
const install_js_1 = require("./config/install.js");
const session_js_1 = require("./mcp/session.js");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
};
const allValues = (flag) => args.reduce((out, arg, index) => (arg === flag && args[index + 1] ? [...out, args[index + 1]] : out), []);
const port = valueOf('--port') ?? process.env['ADSCRAFT_MCP_PORT'] ?? String(session_js_1.DEFAULT_MCP_PORT);
const url = valueOf('--url') ?? `http://127.0.0.1:${port}/mcp`;
const wanted = allValues('--agent');
const mode = has('--remove') ? 'remove' : 'add';
const ctx = { home: (0, node_os_1.homedir)(), projectPath: process.cwd(), url };
const format = (state) => {
    const mark = state.configured ? '✓ configured' : state.installed ? '· detected' : '  not found';
    return `  ${mark.padEnd(13)} ${state.name.padEnd(20)} ${state.file}`;
};
if (has('--help') || has('-h')) {
    console.log('usage: node dist/cli.js [--list] [--remove] [--agent <id>]... [--url <endpoint>] [--port <n>]');
    process.exit(0);
}
const selected = (states) => wanted.length === 0 ? states : states.filter((state) => wanted.includes(state.id));
if (has('--list')) {
    console.log(`Endpoint: ${url}\n`);
    for (const state of (0, install_js_1.agentStates)(ctx))
        console.log(format(state));
    process.exit(0);
}
let touched = 0;
for (const state of selected((0, install_js_1.agentStates)(ctx))) {
    if (mode === 'add' && !state.installed && wanted.length === 0)
        continue;
    try {
        const next = (0, install_js_1.configureAgent)(ctx, state.id, mode);
        console.log(`${mode === 'add' ? '✓' : '−'} ${next.name} → ${next.file}`);
        touched += 1;
    }
    catch (err) {
        console.error(`✗ ${state.name}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
if (touched === 0)
    console.log('Nothing to do. Use --list to see the agents found on this machine.');
//# sourceMappingURL=cli.js.map