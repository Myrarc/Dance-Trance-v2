import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayerLock, matchPlayerLock, primarySoloCandidate, registrationCandidates } from '../src/pose/playerLock.ts'

function pose(center: number, scale = 1, gesture: 'out' | 'down' | 'rightUp' = 'out') {
  const points = Array.from({ length: 33 }, () => ({ x: center, y: 0.5, z: 0, visibility: 1 }))
  const put = (index: number, dx: number, y: number) => { points[index] = { x: center + dx * scale, y: 0.5 + (y - 0.5) * scale, z: 0, visibility: 1 } }
  put(11, -0.07, 0.32)
  put(12, 0.07, 0.32)
  put(23, -0.05, 0.57)
  put(24, 0.05, 0.57)
  put(13, gesture === 'out' ? -0.16 : -0.07, gesture === 'out' ? 0.32 : 0.45)
  put(14, gesture === 'out' ? 0.16 : 0.07, gesture === 'out' ? 0.32 : gesture === 'rightUp' ? 0.18 : 0.45)
  put(15, gesture === 'out' ? -0.21 : -0.07, gesture === 'out' ? 0.32 : 0.6)
  put(16, gesture === 'out' ? 0.21 : 0.07, gesture === 'out' ? 0.32 : gesture === 'rightUp' ? 0.06 : 0.6)
  return points
}

test('solo registration selects the foreground dancer in the center zone', () => {
  assert.deepEqual(registrationCandidates([pose(0.52, 0.5), pose(0.48, 1)], 1), [1])
  assert.deepEqual(registrationCandidates([pose(0.1), pose(0.5)], 1), [1])
})

test('a background person cannot grow or take over a registered solo slot', () => {
  let lock = createPlayerLock([pose(0.5)], 0)
  let result = matchPlayerLock(lock, [pose(0.52), pose(0.8, 0.5)], 50)
  assert.deepEqual(result.indices, [0])
  lock = result.state
  result = matchPlayerLock(lock, [pose(0.8, 0.5)], 100)
  assert.deepEqual(result.indices, [null])
  assert.equal(result.state.slots.length, 1)
})

test('a different shirt color rejects a same-sized background person crossing the lock', () => {
  const red = { r: 220, g: 35, b: 35 }
  const blue = { r: 35, g: 45, b: 220 }
  const lock = createPlayerLock([pose(0.5)], 0, [red])
  const result = matchPlayerLock(lock, [pose(0.5)], 50, [blue])
  assert.deepEqual(result.indices, [null])
  assert.deepEqual(matchPlayerLock(result.state, [pose(0.52)], 100, [red]).indices, [0])
})

test('minor lighting changes and unavailable color samples do not break the lock', () => {
  const lock = createPlayerLock([pose(0.5)], 0, [{ r: 120, g: 90, b: 70 }])
  const dimmer = matchPlayerLock(lock, [pose(0.52)], 50, [{ r: 85, g: 65, b: 50 }])
  assert.deepEqual(dimmer.indices, [0])
  assert.deepEqual(matchPlayerLock(dimmer.state, [pose(0.54)], 100, [null]).indices, [0])
})

test('a lost player is not silently replaced after a long absence', () => {
  let lock = createPlayerLock([pose(0.5)], 0)
  lock = matchPlayerLock(lock, [], 900).state
  const stranger = matchPlayerLock(lock, [pose(0.5, 1, 'down')], 950)
  assert.deepEqual(stranger.indices, [null])
  assert.deepEqual(matchPlayerLock(stranger.state, [pose(0.5, 1, 'rightUp')], 1000).indices, [null])
})

test('only a sustained right-hand-up pose restores a lost player slot', () => {
  let lock = createPlayerLock([pose(0.5)], 0)
  lock = matchPlayerLock(lock, [], 900).state
  const oldPose = matchPlayerLock(lock, [pose(0.5)], 1000)
  assert.deepEqual(oldPose.indices, [null])
  assert.deepEqual(matchPlayerLock(oldPose.state, [pose(0.5)], 2100).indices, [null])
  lock = matchPlayerLock(lock, [pose(0.5, 1, 'rightUp')], 1100).state
  assert.deepEqual(matchPlayerLock(lock, [pose(0.5, 1, 'rightUp')], 1800).indices, [null])
  const restored = matchPlayerLock(lock, [pose(0.5, 1, 'rightUp')], 2100)
  assert.deepEqual(restored.indices, [0])
})

test('two registered players keep separate slots when one vanishes', () => {
  let lock = createPlayerLock([pose(0.75), pose(0.25)], 0)
  let result = matchPlayerLock(lock, [pose(0.25), pose(0.75)], 50)
  assert.deepEqual(result.indices, [1, 0])
  lock = result.state
  result = matchPlayerLock(lock, [pose(0.25)], 100)
  assert.deepEqual(result.indices, [null, 0])
})

test('continuous crossing preserves player slots instead of re-sorting left to right', () => {
  let lock = createPlayerLock([pose(0.75), pose(0.25)], 0)
  const positions = [[0.69, 0.31], [0.61, 0.39], [0.53, 0.47], [0.45, 0.55], [0.37, 0.63]]
  positions.forEach(([first, second], index) => {
    const detections = [pose(second), pose(first)]
    const result = matchPlayerLock(lock, detections, (index + 1) * 50)
    assert.deepEqual(result.indices, [1, 0])
    lock = result.state
  })
})

test('solo play follows the largest visible torso without a relock gesture', () => {
  assert.equal(primarySoloCandidate([pose(0.2, 0.5), pose(0.8, 1, 'down')]), 1)
  assert.equal(primarySoloCandidate([pose(0.8, 1, 'down')]), 0)
  assert.equal(primarySoloCandidate([]), null)
  const hidden = pose(0.5)
  hidden[11].visibility = 0.2
  assert.equal(primarySoloCandidate([hidden]), null)
})

test('lock diagnostics distinguish no model pose from an unusable torso', () => {
  const lock = createPlayerLock([pose(0.5)], 0)
  assert.deepEqual(matchPlayerLock(lock, [], 50).reasons, ['no pose'])
  const unclear = pose(0.5)
  unclear[23].visibility = 0.4
  assert.deepEqual(matchPlayerLock(lock, [unclear], 50).reasons, ['torso'])
})

test('lock diagnostics name appearance and scale rejection without changing matching', () => {
  const red = { r: 220, g: 35, b: 35 }
  const blue = { r: 35, g: 45, b: 220 }
  const lock = createPlayerLock([pose(0.5)], 0, [red])
  assert.deepEqual(matchPlayerLock(lock, [pose(0.5)], 50, [blue]).reasons, ['appearance'])
  assert.deepEqual(matchPlayerLock(lock, [pose(0.5, 0.5)], 50, [red]).reasons, ['scale'])
  assert.deepEqual(matchPlayerLock(lock, [pose(0.5)], 50, [red]).reasons, ['matched'])
})

test('lock diagnostics show the relock gate while the player remains unmatched', () => {
  const lock = createPlayerLock([pose(0.5)], 0)
  assert.deepEqual(matchPlayerLock(lock, [pose(0.5, 1, 'down')], 900).reasons, ['relock gesture'])
  assert.deepEqual(matchPlayerLock(lock, [pose(0.5, 1, 'rightUp')], 900).reasons, ['relock hold'])
})
