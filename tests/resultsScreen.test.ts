import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { newMotionRound } from '../src/pose/gameplay.ts'

test('results offer a photo opt-out and explain when menu gestures become available', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { ResultsScreen } = await server.ssrLoadModule('/src/components/GameShell.tsx')
    const html = renderToStaticMarkup(createElement(ResultsScreen, {
      players: [newMotionRound(1)],
      difficulty: 'normal',
      records: [null],
      reducedEffects: true,
      photoRound: 0,
      photoPrompt: 'Strike a pose!',
      onCapture: async () => {},
      onReplay: () => {},
      onChooseSong: () => {},
      onHome: () => {},
    }))

    assert.match(html, /distance-menu-guide is-suspended/)
    assert.match(html, /Skip photo/)
    assert.match(html, /Menu gestures resume after the photo/)
    assert.match(html, /Right hand up: select highlighted action/)
    assert.match(html, /Left hand up.*Choose song/)
    assert.doesNotMatch(html, /Your next move/)
    assert.doesNotMatch(html, /R↑|L↑/)
    assert.doesNotMatch(html, /Compared with the reference dancer/)
  } finally {
    await server.close()
  }
})

test('turning photos off shows both player summaries immediately without a photo countdown', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { ResultsScreen } = await server.ssrLoadModule('/src/components/GameShell.tsx')
    const html = renderToStaticMarkup(createElement(ResultsScreen, {
      players: [newMotionRound(1), newMotionRound(1)], difficulty: 'normal', records: [null, null],
      reducedEffects: true, photoRound: 1, photoPrompt: 'Strike a pose!', takePhoto: false,
      onCapture: async () => {}, onReplay: () => {}, onChooseSong: () => {}, onHome: () => {},
    }))
    assert.match(html, /result-players is-multiplayer/)
    assert.equal((html.match(/class="result-summary"/g) ?? []).length, 2)
    assert.match(html, /class="result-breakdown" hidden=""/)
    assert.doesNotMatch(html, /Photo skipped/)
    assert.doesNotMatch(html, /is-photo-pending|Skip photo|is-suspended/)
  } finally { await server.close() }
})
