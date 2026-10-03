import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { newMotionRound } from '../src/pose/gameplay.ts'
import { comboMilestone } from '../src/game/feedback.ts'

test('arcade rewards crossed combo milestones and keeps both players identifiable', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { ArcadeHud, RoundSignal } = await server.ssrLoadModule('/src/components/ArcadeFeedback.tsx')
    assert.equal(comboMilestone(0, 4), 0)
    assert.equal(comboMilestone(4, 5), 5)
    assert.equal(comboMilestone(4, 7), 5, 'batched scoring must not skip the reward')
    assert.equal(comboMilestone(5, 5), 0, 'repeated camera updates must not replay it')
    assert.equal(comboMilestone(9, 12), 10)
    assert.equal(comboMilestone(12, 0), 0, 'breaking a combo is not a reward')
    assert.equal(comboMilestone(0, 5), 5, 'a fresh streak can earn the reward again')
    const html = renderToStaticMarkup(createElement(ArcadeHud, {
      players: [{ ...newMotionRound(10), score: 12345, combo: 7 }, { ...newMotionRound(10), score: 900, combo: 0 }],
      playerCount: 2,
      phase: 'playing',
      soundMuted: true,
      scoreDebug: [],
      onPause: () => {},
    }))
    assert.match(html, /aria-label="Player 1"/)
    assert.match(html, /aria-label="Player 2"/)
    assert.match(html, /12,345/)
    assert.match(html, /7× combo/)
    assert.match(html, /aria-label="Pause"/)
    assert.doesNotMatch(html, /aria-live/, 'scores must not constantly interrupt screen reader speech')
    const countdown = renderToStaticMarkup(createElement(RoundSignal, { phase: 'countdown', countdown: 3 }))
    assert.match(countdown, /Ready/)
    assert.match(countdown, /<strong>3<\/strong>/)
    assert.equal(renderToStaticMarkup(createElement(RoundSignal, { phase: 'playing' })), '', 'loading or resuming gameplay must not fake a fresh GO')
  } finally {
    await server.close()
  }
})
