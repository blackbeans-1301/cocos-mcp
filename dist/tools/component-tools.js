"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.componentTools = void 0;
const types_js_1 = require("./types.js");
const ref = (args) => (0, types_js_1.defined)({
    uuid: (0, types_js_1.optionalString)(args, 'uuid'),
    path: (0, types_js_1.optionalString)(args, 'path'),
    type: (0, types_js_1.optionalString)(args, 'type'),
    index: (0, types_js_1.optionalNumber)(args, 'index'),
});
const call = (ctx, method, arg) => ctx.bridge.scene(method, [arg]);
const TARGET = {
    uuid: { type: 'string', description: 'Node uuid.' },
    path: { type: 'string', description: 'Scene-relative node path.' },
    type: { type: 'string', description: 'Component class name, e.g. cc.Sprite.' },
    index: { type: 'number', description: 'Index among components of the same type (default 0).' },
};
exports.componentTools = [
    {
        name: 'component_list',
        description: 'List the components on a node (class name + enabled).',
        inputSchema: {
            type: 'object',
            properties: { uuid: TARGET.uuid, path: TARGET.path },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'listComponents', (0, types_js_1.defined)({ uuid: (0, types_js_1.optionalString)(args, 'uuid'), path: (0, types_js_1.optionalString)(args, 'path') })),
    },
    {
        name: 'component_add',
        description: 'Add a component to a node by class name.',
        inputSchema: {
            type: 'object',
            properties: { uuid: TARGET.uuid, path: TARGET.path, type: { ...TARGET.type } },
            required: ['type'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'addComponent', (0, types_js_1.defined)({ uuid: (0, types_js_1.optionalString)(args, 'uuid'), path: (0, types_js_1.optionalString)(args, 'path'), type: (0, types_js_1.requireString)(args, 'type') })),
    },
    {
        name: 'component_remove',
        description: 'Remove a component from a node.',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET },
            required: ['type'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'removeComponent', { ...ref(args), type: (0, types_js_1.requireString)(args, 'type') }),
    },
    {
        name: 'component_get_property',
        description: 'Read one property of a component.',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET, property: { type: 'string' } },
            required: ['type', 'property'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'getComponentProperty', { ...ref(args), property: (0, types_js_1.requireString)(args, 'property') }),
    },
    {
        name: 'component_set_property',
        description: 'Set one property of a component. Engine value types are built from JSON: Vec3/Vec2/Quat from [x,y,z]/… or {x,y,z}; Color from "#rrggbb" or [r,g,b,a]; Size from [w,h]. Object references: {\"$asset\": uuid|db://url} (sub-assets like a SpriteFrame are \"<imageUuid>@f9941\"), {\"$node\": uuid|path}, {\"$component\": {\"node\": uuid|path, \"type\": \"cc.Sprite\"}} — also inside arrays.',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET, property: { type: 'string' }, value: { description: 'JSON value.' } },
            required: ['type', 'property', 'value'],
            additionalProperties: false,
        },
        handler: (args, ctx) => {
            const value = args['value'];
            return call(ctx, 'setComponentProperty', { ...ref(args), property: (0, types_js_1.requireString)(args, 'property'), value });
        },
    },
    {
        name: 'component_call_method',
        description: 'Call a method on a component with JSON arguments.',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET, method: { type: 'string' }, args: { type: 'array', items: {} } },
            required: ['type', 'method'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'callComponentMethod', {
            ...ref(args),
            method: (0, types_js_1.requireString)(args, 'method'),
            args: (0, types_js_1.optionalArray)(args, 'args') ?? [],
        }),
    },
    {
        name: 'component_types',
        description: 'List the component class names available in the running engine.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: (_args, ctx) => call(ctx, 'listComponentTypes', {}),
    },
];
//# sourceMappingURL=component-tools.js.map