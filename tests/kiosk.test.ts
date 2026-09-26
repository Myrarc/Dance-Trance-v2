import assert from 'node:assert/strict'
import test from 'node:test'
import { kioskFrame, kioskSongOrder } from '../src/game/kiosk.ts'
import type { CueEvent } from '../src/pose/hitTargets.ts'

const cues: CueEvent[] = [2, 10, 11, 12].map((time) => ({
  kind: 'spot', joint: 'rightHand', feature: {}, time, poseTime: time,
  x: 0.5, y: 0.4, confidence: 1,
}))

test('demo selection shuffles upload order without losing fallback candidates', () => {
  const songs = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
  assert.deepEqual(kioskSongOrder(songs, null, () => 0).map((song) => song.id), ['second', 'third', 'first'])
  assert.deepEqual(songs.map((song) => song.id), ['first', 'second', 'third'])
  assert.equal(kioskSongOrder(songs, null, () => 0.5)[0].id, 'first')
  const draws = [0, 0.9]
  assert.equal(kioskSongOrder(songs, null, () => draws.shift()!)[0].id, 'third')
})

test('the previous demo is tried only after every alternative, even when some songs are unavailable', () => {
  const songs = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
  const order = kioskSongOrder(songs, 'second', () => 0)
  assert.equal(order.at(-1)?.id, 'second')
  assert.equal(order.find((song) => song.id !== 'third')?.id, 'first')
  assert.deepEqual(kioskSongOrder([{ id: 'only' }], 'only'), [{ id: 'only' }])
  assert.deepEqual(kioskSongOrder([], null), [])
})

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
