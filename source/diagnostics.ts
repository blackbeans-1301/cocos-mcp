/**
 * Type-check the project's scripts with the TypeScript that ships inside Creator.
 *
 * Creator itself only *transpiles* scripts: a type error never shows up, and a syntax error is
 * logged once with a long stack. Running the compiler over `assets/` with the project's own
 * `tsconfig.json` gives the same errors an IDE would, with file and line.
 */
import { isAbsolute, join, resolve, sep } from 'node:path'

export interface Diagnostic {
  file: string
  line: number
  column: number
  code: number
  severity: 'error' | 'warning'
  message: string
}

export interface DiagnosticsResult {
  filesChecked: number
  count: number
  truncated: boolean
  items: Diagnostic[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

// Reused between calls so a re-check after a small edit only redoes what changed.
let lastProgram: Any

const normal = (path: string): string => resolve(path).toLowerCase()

/** `db://assets/a/B.ts`, a project-relative path or an absolute one → absolute, comparable form. */
const toFile = (projectPath: string, ref: string): string =>
  normal(ref.startsWith('db://') ? join(projectPath, ref.slice('db://'.length)) : isAbsolute(ref) ? ref : join(projectPath, ref))

export const runDiagnostics = (projectPath: string, appPath: string, options: { files?: string[]; limit?: number } = {}): DiagnosticsResult => {
  const ts: Any = require(join(appPath, 'node_modules', 'typescript'))
  const configPath = join(projectPath, 'tsconfig.json')
  if (!ts.sys.fileExists(configPath)) throw new Error(`No tsconfig.json in ${projectPath} — open the project in Creator once so it generates one.`)
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) throw new Error(`Cannot read tsconfig.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, projectPath)
  const program: Any = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true }, oldProgram: lastProgram })
  lastProgram = program

  const assets = normal(join(projectPath, 'assets')) + sep
  const wanted = options.files?.length ? new Set(options.files.map((ref) => toFile(projectPath, ref))) : null
  const sources = (program.getSourceFiles() as Any[]).filter((file) => {
    const name = normal(file.fileName)
    return name.startsWith(assets) && (!wanted || wanted.has(name))
  })

  const items: Diagnostic[] = []
  for (const file of sources) {
    for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)] as Any[]) {
      const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
      items.push({
        file: file.fileName.slice(projectPath.length + 1).split(sep).join('/'),
        line: line + 1,
        column: character + 1,
        code: diagnostic.code,
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      })
    }
  }
  const limit = Math.max(1, options.limit ?? 50)
  return { filesChecked: sources.length, count: items.length, truncated: items.length > limit, items: items.slice(0, limit) }
}
