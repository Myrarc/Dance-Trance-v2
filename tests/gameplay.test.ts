import assert from 'node:assert/strict'
import test from 'node:test'
import { accuracy, isGameRunReady } from '../src/pose/gameplay.ts'
import { compareToHistory, hasHitMovement, type PoseFeature } from '../src/pose/angles.ts'
import * as gameplay from '../src/pose/gameplay.ts'
import { motionLagLimit, evaluateMotionInterval, advanceScoringClock } from '../src/pose/motionScore.ts'

test('natural and trimmed endings wait for final scoring evidence from both players', () => {
  const end = 2
  const interval = { start: 1.5, end, kind: 'move' as const, keys: ['lUpperArm'] }
  const frames = Array.from({ length: 61 }, (_, i) => {
    const t = i / 15
    const angle = Math.min(Math.max(t - 1.3, 0) / .7, 1) * Math.PI / 2
    return { t, feature: { lUpperArm: { x: Math.cos(angle), y: Math.sin(angle), z: 0 } } }
  })
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    let players = [gameplay.newMotionRound(1), gameplay.newMotionRound(1)]
    assert.equal(gameplay.roundScoringComplete(true, players), false)
    const ended = advanceScoringClock(end, true, 1000, 0)
    const tail = advanceScoringClock(end, true, 1000 + (motionLagLimit(difficulty) + .1) * 1000, ended.endedAt)
    assert.ok(tail.time >= interval.end + motionLagLimit(difficulty) + .02)
    const evidence = evaluateMotionInterval(interval, frames, frames, difficulty)
    assert.ok(evidence.quality !== null && evidence.quality >= .8)
    players[0] = gameplay.advanceMotionRound(players[0], evidence, interval.kind)
    assert.equal(gameplay.roundScoringComplete(true, players), false)
    players[1] = gameplay.advanceMotionRound(players[1], { quality: null, coverage: 0, lag: 0 }, interval.kind)
    assert.equal(gameplay.roundScoringComplete(false, players), false, 'a chart ending early cannot end the video')
    assert.equal(gameplay.roundScoringComplete(true, players), true)
    assert.ok(players[0].score > 0)
  }
  assert.equal(gameplay.roundScoringComplete(true, [gameplay.newMotionRound(0)]), true)
})

test('movement quality gives partial credit and tracking gaps cannot create a record', () => {
  assert.ok('newMotionRound' in gameplay && 'advanceMotionRound' in gameplay && 'trackingCoverage' in gameplay)
  let round = gameplay.newMotionRound()
  round = gameplay.advanceMotionRound(round, { quality: 0.88, coverage: 1, lag: 0 }, 'move')
  round = gameplay.advanceMotionRound(round, { quality: 0.58, coverage: 1, lag: 0 }, 'move')
  assert.equal(round.perfect, 1)
  assert.equal(round.good, 1)
  assert.ok(round.score > 1400)
  round = gameplay.advanceMotionRound(round, { quality: null, coverage: 0, lag: 0 }, 'move')
  assert.equal(round.combo, 2)
  assert.equal(gameplay.trackingCoverage(round), 67)
  assert.equal(gameplay.recordEligible(round), false)
  assert.equal(accuracy(round), 73)
})

test('an unfinished run cannot turn sparse tracked movement into a personal best', () => {
  const round = gameplay.advanceMotionRound(
    gameplay.newMotionRound(4),
    { quality: 0.92, coverage: 1, lag: 0 },
    'move',
  )
  assert.equal(gameplay.trackingCoverage(round), 25)
  assert.equal(gameplay.recordEligible(round), false)
})

test('results separate scored movement from intervals lost to tracking', () => {
  let round = gameplay.newMotionRound(3)
  round = gameplay.advanceMotionRound(round, { quality: 0.92, coverage: 1, lag: 0 }, 'move')
  round = gameplay.advanceMotionRound(round, { quality: null, coverage: 0, lag: 0 }, 'move')
  assert.deepEqual(gameplay.movementResults(round), { scored: 1, unscored: 2, total: 3 })
  assert.equal(round.miss, 0)
})

test('two players keep independent movement points, timing, and combo', () => {
  const first = gameplay.advanceMotionRound(
    gameplay.newMotionRound(1),
    { quality: 0.9, coverage: 1, lag: 0.1 },
    'move',
  )
  const second = gameplay.advanceMotionRound(
    gameplay.newMotionRound(1),
    { quality: 0.5, coverage: 1, lag: -0.2 },
    'move',
  )
  assert.equal(first.perfect, 1)
  assert.equal(second.good, 1)
  assert.ok(first.score > second.score)
  assert.equal(first.lag, 0.1)
  assert.equal(second.lag, -0.2)
})

test('each player keeps an independent timing estimate', () => {
  const early: PoseFeature = { lUpperArm: { x: 1, y: 0, z: 0 } }
  const current: PoseFeature = { lUpperArm: { x: 0, y: 1, z: 0 } }
  const history = [{ t: 0, feature: early }, { t: 1, feature: current }]
  const p1 = { lag: 0 }
  const p2 = { lag: 0 }

  compareToHistory(early, history, 1, false, p1)
  compareToHistory(current, history, 1, false, p2)

  assert.ok(p1.lag > 0)
  assert.equal(p2.lag, 0)
})

test('standing still cannot keep earning hit points', () => {
  const held: PoseFeature = {
    lUpperArm: { x: 1, y: 0, z: 0 },
    lForearm: { x: 1, y: 0, z: 0 },
  }
  const moved: PoseFeature = {
    lUpperArm: { x: 0, y: 1, z: 0 },
    lForearm: { x: 0, y: 1, z: 0 },
  }

  assert.equal(hasHitMovement(held, held, 'leftHand', false), false)
  assert.equal(hasHitMovement(held, moved, 'leftHand', false), true)
})

test('arms replay scoring from the reference run instead of a fragile time threshold', () => {
  assert.equal(isGameRunReady(1, 2), false)
  assert.equal(isGameRunReady(2, 2), true)
})
