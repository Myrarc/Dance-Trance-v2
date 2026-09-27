import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package exposes a Windows installer command with the Electron entry point', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.main, 'electron/main.mjs')
  assert.equal(pkg.scripts['package:win'], 'npm run build && electron-builder --win nsis')
  assert.equal(pkg.build.appId, 'com.dancetrance.arcade')
  assert.deepEqual(pkg.build.files, ['dist/**/*', 'electron/**/*', 'package.json'])
  assert.equal(pkg.build.win.target, 'nsis')
  assert.equal(pkg.build.win.icon, 'build/icon.png')
  assert.match(pkg.description, /dance game/i)
  assert.ok(pkg.author)
  const main = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')
  assert.match(main, /preload\.cjs/)
})
