import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

test('track picker implements the approved arcade stage without discarded slogans', async () => {
  const [app, css] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
  ])

  for (const className of [
    'picker-gesture-guide',
    'carousel-paddle-left',
    'carousel-paddle-right',
    'song-card-action',
  ]) {
    assert.match(app, new RegExp(className), `${className} belongs to the functional picker markup`)
    assert.match(css, new RegExp(`\\.${className}`), `${className} has production styling`)
  }
  assert.match(app, /PLAY THIS TRACK/)
  assert.match(css, /\/menu\/track-picker-stage\.webp/)
  assert.doesNotMatch(app, /picker-spectacle|picker-ribbon|picker-equalizer|picker-floor|picker-spotlight/)
  assert.ok((await stat(new URL('../public/menu/track-picker-stage.webp', import.meta.url))).size > 0)
  assert.doesNotMatch(`${app}\n${css}`, /music moves people|let'?s dance|good music brighter you/i)
})
