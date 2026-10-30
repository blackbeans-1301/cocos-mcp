// Stages the store package (no node_modules, sources or tests) and zips it to
// build/ccreator-mcp-<version>.zip. Run via `npm run pack`.
import { cpSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const stage = join(root, 'build', pkg.name)
const zip = join(root, 'build', `${pkg.name}-${pkg.version}.zip`)

rmSync(join(root, 'build'), { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
for (const entry of ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'dist', 'i18n', 'static', 'skills']) {
  if (!existsSync(join(root, entry))) throw new Error(`missing ${entry}`)
  cpSync(join(root, entry), join(stage, entry), { recursive: true })
}

if (process.platform === 'win32') {
  // bsdtar (ships with Windows 10+) writes forward-slash zip entries; Compress-Archive in PS 5.1 does not
  execFileSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, pkg.name], { cwd: join(root, 'build'), stdio: 'inherit' })
} else {
  execFileSync('zip', ['-qr', zip, pkg.name], { cwd: join(root, 'build'), stdio: 'inherit' })
}
console.log(`packed ${zip}`)
