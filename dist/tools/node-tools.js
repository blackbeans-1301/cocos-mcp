"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeTools = void 0;
const types_js_1 = require("./types.js");
const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' };
const ref = (args) => (0, types_js_1.defined)({ uuid: (0, types_js_1.optionalString)(args, 'uuid'), path: (0, types_js_1.optionalString)(args, 'path') });
const call = (ctx, method, arg) => ctx.bridge.scene(method, [arg]);
const REF_PROPS = {
    uuid: { type: 'string', description: 'Node uuid.' },
    path: { type: 'string', description: 'Scene-relative node path, e.g. Canvas/Player.' },
};
exports.nodeTools = [
    {
        name: 'node_tree',
        description: 'Read the scene hierarchy as a tree (name, path, transform, components). Pass uuid or path to read just one subtree.',
        inputSchema: {
            type: 'object',
            properties: {
                ...REF_PROPS,
                maxDepth: { type: 'number', description: 'How deep to descend (default 6).' },
                includeComponents: { type: 'boolean', description: 'Include component class names (default true).' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'nodeTree', {
            ...ref(args),
            ...(0, types_js_1.defined)({ maxDepth: (0, types_js_1.optionalNumber)(args, 'maxDepth'), includeComponents: (0, types_js_1.optionalBoolean)(args, 'includeComponents') }),
        }),
    },
    {
        name: 'node_get',
        description: 'Read one node: name, path, transform, active state and components.',
        inputSchema: { type: 'object', properties: { ...REF_PROPS }, additionalProperties: false },
        handler: (args, ctx) => call(ctx, 'getNode', ref(args)),
    },
    {
        name: 'node_find',
        description: 'Find nodes by name (exact or substring) and/or by component type.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name to match (exact or substring).' },
                component: { type: 'string', description: 'Component class name, e.g. cc.Sprite.' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'findNodes', (0, types_js_1.defined)({ name: (0, types_js_1.optionalString)(args, 'name'), component: (0, types_js_1.optionalString)(args, 'component') })),
    },
    {
        name: 'node_create',
        description: 'Create a node under a parent (defaults to the scene root). Returns the new node.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                parentUuid: { type: 'string', description: 'Parent node uuid (default: scene root).' },
                parentPath: { type: 'string', description: 'Parent node path (used when parentUuid is absent).' },
                position: VEC3,
                rotation: { ...VEC3, description: '[x, y, z] euler angles in degrees' },
                scale: VEC3,
                components: { type: 'array', items: { type: 'string' }, description: 'Component class names to add.' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'createNode', (0, types_js_1.defined)({
            name: (0, types_js_1.optionalString)(args, 'name'),
            parentUuid: (0, types_js_1.optionalString)(args, 'parentUuid'),
            parentPath: (0, types_js_1.optionalString)(args, 'parentPath'),
            position: (0, types_js_1.optionalArray)(args, 'position'),
            rotation: (0, types_js_1.optionalArray)(args, 'rotation'),
            scale: (0, types_js_1.optionalArray)(args, 'scale'),
            components: (0, types_js_1.optionalArray)(args, 'components'),
        })),
    },
    {
        name: 'node_delete',
        description: 'Delete a node (the scene root cannot be deleted).',
        inputSchema: { type: 'object', properties: { ...REF_PROPS }, additionalProperties: false },
        handler: (args, ctx) => call(ctx, 'deleteNode', ref(args)),
    },
    {
        name: 'node_duplicate',
        description: 'Duplicate a node (clone kept at the same parent).',
        inputSchema: {
            type: 'object',
            properties: { ...REF_PROPS, name: { type: 'string', description: 'Name for the clone.' } },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'duplicateNode', (0, types_js_1.defined)({ ...ref(args), name: (0, types_js_1.optionalString)(args, 'name') })),
    },
    {
        name: 'node_rename',
        description: 'Rename a node.',
        inputSchema: {
            type: 'object',
            properties: { ...REF_PROPS, name: { type: 'string', description: 'New name.' } },
            required: ['name'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'renameNode', { ...ref(args), name: (0, types_js_1.requireString)(args, 'name') }),
    },
    {
        name: 'node_set_transform',
        description: 'Set a node position/rotation(euler, deg)/scale, active state or layer.',
        inputSchema: {
            type: 'object',
            properties: {
                ...REF_PROPS,
                position: VEC3,
                rotation: { ...VEC3, description: '[x, y, z] euler angles in degrees' },
                scale: VEC3,
                active: { type: 'boolean' },
                layer: { type: 'number' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'setNodeTransform', (0, types_js_1.defined)({
            ...ref(args),
            position: (0, types_js_1.optionalArray)(args, 'position'),
            rotation: (0, types_js_1.optionalArray)(args, 'rotation'),
            scale: (0, types_js_1.optionalArray)(args, 'scale'),
            active: (0, types_js_1.optionalBoolean)(args, 'active'),
            layer: (0, types_js_1.optionalNumber)(args, 'layer'),
        })),
    },
    {
        name: 'node_set_parent',
        description: 'Reparent a node (defaults to the scene root).',
        inputSchema: {
            type: 'object',
            properties: {
                ...REF_PROPS,
                parentUuid: { type: 'string' },
                parentPath: { type: 'string' },
                keepWorldTransform: { type: 'boolean', description: 'Preserve world transform (default false).' },
            },
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'setNodeParent', (0, types_js_1.defined)({
            ...ref(args),
            parentUuid: (0, types_js_1.optionalString)(args, 'parentUuid'),
            parentPath: (0, types_js_1.optionalString)(args, 'parentPath'),
            keepWorldTransform: (0, types_js_1.optionalBoolean)(args, 'keepWorldTransform'),
        })),
    },
    {
        name: 'node_set_sibling_index',
        description: 'Move a node to a position among its siblings (render/layout order).',
        inputSchema: {
            type: 'object',
            properties: { ...REF_PROPS, index: { type: 'number', description: 'Target index; large values go last.' } },
            required: ['index'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'setSiblingIndex', { ...ref(args), index: (0, types_js_1.optionalNumber)(args, 'index') }),
    },
    {
        name: 'node_create_tree',
        description: 'Create a whole subtree in one call. `tree` is {name, position, rotation, scale, active, components: [classNames], children: [same shape]}. Created under a parent (default: scene root).',
        inputSchema: {
            type: 'object',
            properties: {
                tree: { type: 'object', description: 'Root spec of the subtree.' },
                parentUuid: { type: 'string' },
                parentPath: { type: 'string' },
            },
            required: ['tree'],
            additionalProperties: false,
        },
        handler: (args, ctx) => call(ctx, 'createNodeTree', (0, types_js_1.defined)({ tree: args['tree'], parentUuid: (0, types_js_1.optionalString)(args, 'parentUuid'), parentPath: (0, types_js_1.optionalString)(args, 'parentPath') })),
    },
    {
        name: 'node_set_property',
        description: 'Set any property on a node (e.g. layer, name) to a JSON value. Object references: {"$asset": uuid|db://url} (sub-assets like a SpriteFrame are "<imageUuid>@f9941"), {"$node": uuid|path}, {"$component": {"node": uuid|path, "type": "cc.Sprite"}} — also inside arrays.',
        inputSchema: {
            type: 'object',
            properties: { ...REF_PROPS, property: { type: 'string' }, value: { description: 'JSON value.' } },
            required: ['property', 'value'],
            additionalProperties: false,
        },
        handler: (args, ctx) => {
            if (!('value' in args))
                throw new types_js_1.ToolInputError('Provide "value".');
            return call(ctx, 'setNodeProperty', { ...ref(args), property: (0, types_js_1.requireString)(args, 'property'), value: args['value'] });
        },
    },
];
//# sourceMappingURL=node-tools.js.map