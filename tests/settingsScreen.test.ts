import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { DEFAULT_GAME_SETTINGS } from '../src/lib/gameSettings.ts'

test('Settings starts with four short categories instead of a long flat gesture traversal', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { SettingsScreen } = await server.ssrLoadModule('/src/components/GameShell.tsx')
    const html = renderToStaticMarkup(createElement(SettingsScreen, {
      settings: DEFAULT_GAME_SETTINGS,
      onChange: () => {},
      onClose: () => {},
    }))
    assert.equal((html.match(/class="btn settings-category"/g) ?? []).length, 4)
    for (const category of ['Gameplay', 'Sound &amp; comfort', 'Language', 'Tools']) assert.ok(html.includes(category))
    assert.match(html, /data-menu-back/)
    assert.match(html, /select highlighted action/)
    assert.doesNotMatch(html, /type="checkbox"/)
  } finally {
    await server.close()
  }
})
