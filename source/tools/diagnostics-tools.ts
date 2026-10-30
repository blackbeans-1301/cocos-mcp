/**
 * Script diagnostics — see `source/diagnostics.ts`. Complements `script_write`, which cannot say
 * whether the script it just saved compiles.
 */
import type { ToolDef } from './types.js'
import { optionalArray, optionalNumber } from './types.js'
import { runDiagnostics } from '../diagnostics.js'
import { searchLogs } from './editor-tools.js'

export const diagnosticsTools: ToolDef[] = [
  {
    name: 'script_diagnostics',
    description:
      'Type-check the project scripts (under assets/) with the project tsconfig and return the errors with file, line and column. Run it after script_write. Also lists compile errors Creator logged in the last few minutes (an error from before your last fix can still be listed — check its time).',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Only these files (db:// urls or project-relative paths). Default: every script.' },
        limit: { type: 'number', description: 'Max diagnostics to return (default 50).' },
        sinceMinutes: { type: 'number', description: 'Only list Creator compile errors logged in the last N minutes (default 10).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const files = (optionalArray(args, 'files') ?? []).filter((file): file is string => typeof file === 'string')
      const limit = optionalNumber(args, 'limit')
      const result = runDiagnostics(ctx.bridge.projectPath(), ctx.bridge.appPath(), { files, ...(limit === undefined ? {} : { limit }) })
      const withinMs = (optionalNumber(args, 'sinceMinutes') ?? 10) * 60_000
      const creatorErrors = searchLogs({ type: 'error', pattern: 'SyntaxError|ImportException|Cannot find module|compile', limit: 5, maxChars: 400, withinMs })
      return { ...result, recentCreatorErrors: creatorErrors }
    },
  },
]
