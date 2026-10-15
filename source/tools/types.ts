/**
 * Shared types for the MCP tool layer, plus the small argument helpers the tools
 * use. Kept dependency-free (no zod): the tool set is fixed and JSON Schema is
 * written by hand, so the extension ships with no runtime dependencies at all.
 */
import type { Bridge } from '../bridge.js'

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
}

export interface ToolContext {
  bridge: Bridge
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: JsonSchema
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
}

/** Bad tool input (missing field, wrong type) — mapped to JSON-RPC `-32602`. */
export class ToolInputError extends Error {}

export const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const requireString = (args: Record<string, unknown>, key: string): string => {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`"${key}" must be a non-empty string.`)
  }
  return value
}

export const optionalString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be a string.`)
  return value
}

export const optionalNumber = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(`"${key}" must be a finite number.`)
  }
  return value
}

export const optionalBoolean = (args: Record<string, unknown>, key: string): boolean | undefined => {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new ToolInputError(`"${key}" must be a boolean.`)
  return value
}

/** Array output arg — returns `undefined` when absent so callers can keep defaults. */
export const optionalArray = (args: Record<string, unknown>, key: string): unknown[] | undefined => {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new ToolInputError(`"${key}" must be an array.`)
  return value
}

export const optionalObject = (args: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError(`"${key}" must be an object.`)
  return value as Record<string, unknown>
}

/** Optional-enum guard; throws a readable error listing the allowed values. */
export const optionalEnum = <T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined => {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ToolInputError(`"${key}" must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/** Merge only the defined keys — `exactOptionalPropertyTypes` forbids explicit `undefined`. */
export const defined = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}
