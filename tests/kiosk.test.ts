import assert from 'node:assert/strict'
import test from 'node:test'
import { kioskFrame } from '../src/game/kiosk.ts'
import type { CueEvent } from '../src/pose/hitTargets.ts'

const cues: CueEvent[] = [2, 10, 11, 12].map((time) => ({
  kind: 'spot', joint: 'rightHand', feature: {}, time, poseTime: time,
  x: 0.5, y: 0.4, confidence: 1,
}))

test('kiosk hits each reached marker and keeps Perfect feedback at its original circle', () => {
  const state = kioskFrame(cues, 11.2, 10)
  assert.equal(state.hits, 2)
  assert.deepEqual(state.visible.map((cue) => cue.time), [11, 12])
  assert.equal(state.visible[0], cues[2])
  assert.equal(kioskFrame(cues, 10.1, 10).hits, 1)
})

test('looping back removes expired feedback and does not carry hits from a later time', () => {
  assert.equal(kioskFrame(cues, 12.6, 0).visible.length, 0)
  assert.equal(kioskFrame(cues, 1, 0).hits, 0)
  assert.deepEqual(kioskFrame([], 20, 0), { hits: 0, visible: [] })
})
