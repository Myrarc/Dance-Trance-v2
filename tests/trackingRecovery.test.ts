import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceRoundRecovery, advanceTrackingRecovery, effectiveTrackingPhase, initialTrackingRecovery, recoveryCountdown } from '../src/game/trackingRecovery.ts'

test('brief absence keeps the song playing, but one second pauses it', () => {
  const missing = advanceTrackingRecovery(initialTrackingRecovery, false, 0)
  assert.equal(advanceTrackingRecovery(missing, false, 999).mode, 'playing')
  const finding = advanceTrackingRecovery(missing, false, 1000)
  assert.equal(finding.mode, 'finding')
  assert.equal(advanceTrackingRecovery(missing, true, 999).mode, 'playing')
  assert.equal(advanceTrackingRecovery(finding, false, 2000).mode, 'finding')
})

test('stable return starts 3-2-1 while the song remains paused', () => {
  let state = advanceTrackingRecovery(advanceTrackingRecovery(initialTrackingRecovery, false, 0), false, 1000)
  state = advanceTrackingRecovery(state, true, 1100)
  assert.equal(advanceTrackingRecovery(state, true, 1599).mode, 'finding')
  state = advanceTrackingRecovery(state, true, 1600)
  assert.equal(state.mode, 'countdown')
  assert.equal(recoveryCountdown(state, 1600), 3)
  assert.equal(recoveryCountdown(state, 2600), 2)
  assert.equal(recoveryCountdown(state, 3600), 1)
  assert.equal(effectiveTrackingPhase('playing', state), 'paused')
  assert.equal(advanceTrackingRecovery(state, true, 4599).mode, 'countdown')
  assert.equal(advanceTrackingRecovery(state, true, 4600).mode, 'playing')
})

test('renewed loss cancels countdown and requires a fresh visible hold', () => {
  const finding = advanceTrackingRecovery(advanceTrackingRecovery(initialTrackingRecovery, false, 0), false, 1000)
  const counting = advanceTrackingRecovery(advanceTrackingRecovery(finding, true, 1100), true, 1600)
  const lost = advanceTrackingRecovery(counting, false, 2000)
  assert.equal(lost.mode, 'finding')
  assert.equal(advanceTrackingRecovery(lost, true, 2100).mode, 'finding')
  assert.equal(advanceTrackingRecovery(lost, true, 2600).mode, 'finding')
})

test('manual pause stays manual, regardless of tracking recovery', () => {
  const finding = { ...initialTrackingRecovery, mode: 'finding' as const }
  assert.equal(effectiveTrackingPhase('paused', finding), 'paused')
  assert.equal(effectiveTrackingPhase('playing', finding), 'paused')
})

test('leaving play clears a pending automatic recovery', () => {
  const finding = advanceTrackingRecovery(advanceTrackingRecovery(initialTrackingRecovery, false, 0), false, 1000)
  assert.deepEqual(advanceRoundRecovery(finding, 'paused', false, 1100), initialTrackingRecovery)
  assert.deepEqual(advanceRoundRecovery(finding, 'lobby', false, 1100), initialTrackingRecovery)
  assert.deepEqual(advanceRoundRecovery(finding, 'results', false, 1100), initialTrackingRecovery)
})
