import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { DEFAULT_GAME_SETTINGS } from '../src/lib/gameSettings.ts'

test('camera skeleton is controlled alongside reference skeleton in Settings', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { SettingsScreen } = await server.ssrLoadModule('/src/components/GameShell.tsx')
    const html = renderToStaticMarkup(createElement(SettingsScreen, {
      settings: { ...DEFAULT_GAME_SETTINGS, showSkeletons: false, showCameraSkeletons: true },
      onChange: () => {},
      onClose: () => {},
    }))
    assert.match(html, /Show reference skeleton/)
    const cameraSetting = html.match(/<label class="setting-row"><span><strong>Show camera skeleton<\/strong>.*?<\/label>/)?.[0]
    assert.ok(cameraSetting, 'the camera skeleton control belongs in Settings')
    assert.match(cameraSetting, /<input type="checkbox" checked=""/)
  } finally {
    await server.close()
  }
})
