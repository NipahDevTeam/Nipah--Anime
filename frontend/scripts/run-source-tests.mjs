import { readdir } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const rootDir = resolve(import.meta.dirname, '..')
const repoRootDir = resolve(rootDir, '..')
const srcDir = resolve(rootDir, 'src')

process.chdir(repoRootDir)

async function collectTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectTests(fullPath))
      continue
    }
    if (/\.test\.(js|mjs)$/i.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

const tests = (await collectTests(srcDir)).sort((left, right) => left.localeCompare(right))
let failures = 0

for (const testPath of tests) {
  const label = relative(rootDir, testPath).split(sep).join('/')
  console.log(`RUN ${label}`)

  try {
    await import(`${pathToFileURL(testPath).href}?run=${Date.now()}-${failures}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}`)
    console.error(error?.stack || error)
  }
}

if (failures > 0) {
  console.error(`FAILED ${failures}/${tests.length}`)
  process.exitCode = 1
} else {
  console.log(`ALL_PASSED ${tests.length}`)
}
