"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defined = exports.optionalEnum = exports.optionalObject = exports.optionalArray = exports.optionalBoolean = exports.optionalNumber = exports.optionalString = exports.requireString = exports.asObject = exports.ToolInputError = exports.JSON_VALUE = void 0;
/**
 * Schema of a free-form JSON value. The explicit type list matters: some clients treat a property with no `type`
 * as a string and send `null` or `[1, 2]` as text.
 */
exports.JSON_VALUE = {
    type: ['string', 'number', 'boolean', 'object', 'array', 'null'],
    description: 'JSON value.',
};
/** Bad tool input (missing field, wrong type) — mapped to JSON-RPC `-32602`. */
class ToolInputError extends Error {
}
exports.ToolInputError = ToolInputError;
const asObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
exports.asObject = asObject;
const requireString = (args, key) => {
    const value = args[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ToolInputError(`"${key}" must be a non-empty string.`);
    }
    return value;
};
exports.requireString = requireString;
const optionalString = (args, key) => {
    const value = args[key];
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string')
        throw new ToolInputError(`"${key}" must be a string.`);
    return value;
};
exports.optionalString = optionalString;
const optionalNumber = (args, key) => {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ToolInputError(`"${key}" must be a finite number.`);
    }
    return value;
};
exports.optionalNumber = optionalNumber;
const optionalBoolean = (args, key) => {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'boolean')
        throw new ToolInputError(`"${key}" must be a boolean.`);
    return value;
};
exports.optionalBoolean = optionalBoolean;
/** Array output arg — returns `undefined` when absent so callers can keep defaults. */
const optionalArray = (args, key) => {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value))
        throw new ToolInputError(`"${key}" must be an array.`);
    return value;
};
exports.optionalArray = optionalArray;
const optionalObject = (args, key) => {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw new ToolInputError(`"${key}" must be an object.`);
    return value;
};
exports.optionalObject = optionalObject;
/** Optional-enum guard; throws a readable error listing the allowed values. */
const optionalEnum = (args, key, allowed) => {
    const value = args[key];
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new ToolInputError(`"${key}" must be one of: ${allowed.join(', ')}.`);
    }
    return value;
};
exports.optionalEnum = optionalEnum;
/** Merge only the defined keys — `exactOptionalPropertyTypes` forbids explicit `undefined`. */
const defined = (input) => {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined)
            out[key] = value;
    }
    return out;
};
exports.defined = defined;
//# sourceMappingURL=types.js.map