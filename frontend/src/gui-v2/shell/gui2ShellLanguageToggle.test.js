import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'Gui2Shell.jsx'), 'utf8')

assert.ok(
  source.includes("const { lang, setLang } = useI18n()"),
  'GUI v2 shell should read language state from the i18n provider',
)

assert.ok(
  source.includes('const handleLanguageToggle = () => {'),
  'GUI v2 shell should provide a concrete language toggle handler',
)

assert.ok(
  source.includes('onClick={handleLanguageToggle}'),
  'GUI v2 shell language button should trigger the language toggle handler',
)

assert.ok(
  !source.includes('aria-label="Language">ES</button>'),
  'GUI v2 shell should not keep a dead hardcoded ES language button',
)

console.log('gui2 shell language toggle tests passed')
