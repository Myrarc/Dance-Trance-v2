import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { newMotionRound } from '../src/pose/gameplay.ts'

test('results make gesture choices prominent without the visual-guide explanation', async () => {
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

    assert.match(html, /class="result-gesture-banner"/)
    assert.match(html, /Right hand up - Replay/)
    assert.match(html, /Left hand up - Choose song/)
    assert.doesNotMatch(html, /Your next move/)
    assert.doesNotMatch(html, /R↑|L↑/)
    assert.doesNotMatch(html, /Compared with the reference dancer/)
  } finally {
    await server.close()
  }
})
