import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const violations = []

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolutePath)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) inspect(absolutePath)
  }
}

const inspect = (absolutePath) => {
  const relativePath = path.relative(root, absolutePath)
  const source = fs.readFileSync(absolutePath, 'utf8')

  if (source.includes("from '@services/") || source.includes("from 'src/services/")) {
    violations.push(`${relativePath}: imports removed src/services layer`)
  }

  if (!relativePath.includes('.test.') && /\b(TODO|FIXME)\b/.test(source)) {
    violations.push(`${relativePath}: production TODO/FIXME must be documented in ../docs/WALLET.md`)
  }

  if (relativePath.startsWith(`src${path.sep}domain${path.sep}`)) {
    for (const forbidden of ['@infrastructure/', '@app/', '@features/']) {
      if (source.includes(forbidden)) {
        violations.push(`${relativePath}: domain imports ${forbidden}`)
      }
    }
  }
}

if (fs.existsSync(path.join(sourceRoot, 'services'))) {
  violations.push('src/services still exists')
}

walk(sourceRoot)

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log('Architecture boundaries are valid.')
