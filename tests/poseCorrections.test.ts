import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { applyPoseCorrections, brushPoseCorrection } from '../src/pose/poseCorrections.ts'
import { getTrack, saveTrack, saveTrackCorrections } from '../src/lib/library.ts'
import { referenceMotionFrames } from '../src/pose/motionScore.ts'

const STRIDE = 33 * 6

test('stored pose corrections change the loaded reference without mutating its original analysis', () => {
  const base = new Float32Array(STRIDE)
  base.fill(0)
  base[15 * 6] = 0.25
  base[15 * 6 + 1] = 0.4
  base[15 * 6 + 3] = -0.2
  base[15 * 6 + 4] = 0.1
  const corrected = applyPoseCorrections(base, 1, [{ frame: 0, landmark: 15, x: 0.7, y: 0.3, worldX: 0.5, worldY: -0.1 }])
  assert.ok(Math.abs(corrected[15 * 6] - 0.7) < 1e-6)
  assert.ok(Math.abs(corrected[15 * 6 + 1] - 0.3) < 1e-6)
  assert.ok(Math.abs(corrected[15 * 6 + 3] - 0.5) < 1e-6)
  assert.ok(Math.abs(corrected[15 * 6 + 4] + 0.1) < 1e-6)
  assert.equal(base[15 * 6], 0.25, 'the analysed pose remains available for reset')
})

test('dragging a joint corrects the current frame and feathers the scoring coordinates nearby', () => {
  const frames = 9
  const data = new Float32Array(frames * STRIDE)
  for (let frame = 0; frame < frames; frame++) {
    for (let landmark = 0; landmark < 33; landmark++) {
      const offset = frame * STRIDE + landmark * 6
      data[offset] = 0.5
      data[offset + 1] = 0.5
      data[offset + 2] = 1
    }
    data[frame * STRIDE + 11 * 6] = 0.4
    data[frame * STRIDE + 11 * 6 + 3] = -0.2
    data[frame * STRIDE + 12 * 6] = 0.6
    data[frame * STRIDE + 12 * 6 + 3] = 0.2
  }

  const corrections = brushPoseCorrection({ frames, data }, [], 4, [15], 0.7, 0.4, 3)
  const corrected = applyPoseCorrections(data, frames, corrections)
  assert.ok(Math.abs(corrected[4 * STRIDE + 15 * 6] - 0.7) < 1e-6)
  assert.ok(Math.abs(corrected[3 * STRIDE + 15 * 6] - 0.65) < 1e-6, 'the neighbouring frame receives a smaller correction')
  assert.equal(corrected[15 * 6], 0.5, 'frames outside the brush remain analysed data')
  assert.ok(Math.abs(corrected[4 * STRIDE + 15 * 6 + 3] - 0.4) < 1e-6, 'screen-space movement updates scoring-space x')
})

test('pose corrections persist beside the original track buffer', async () => {
  const id = 'pose-correction-storage-test'
  const buffer = new Float32Array(STRIDE).buffer
  await saveTrack(id, { version: 4, fps: 15, frames: 1, buffer })
  const corrections = [{ frame: 0, landmark: 15, x: 0.7, y: 0.3, worldX: 0.5, worldY: -0.1 }]
  await saveTrackCorrections(id, corrections)
  const stored = await getTrack(id)
  assert.deepEqual(stored?.corrections, corrections)
  assert.equal(stored?.buffer.byteLength, buffer.byteLength)
})

test('corrected world landmarks change the reference features used by scoring', () => {
  const data = new Float32Array(STRIDE)
  for (let landmark = 0; landmark < 33; landmark++) data[landmark * 6 + 2] = 1
  const world = (landmark: number, x: number, y: number) => {
    data[landmark * 6 + 3] = x
    data[landmark * 6 + 4] = y
  }
  world(11, -1, 1)
  world(12, 1, 1)
  world(23, -1, 0)
  world(24, 1, 0)
  world(13, -1, .5)
  world(15, -1, 0)
  const base = referenceMotionFrames({ fps: 15, frames: 1, data })[0].feature.lForearm
  const corrected = applyPoseCorrections(data, 1, [{ frame: 0, landmark: 15, x: .5, y: .5, worldX: 0, worldY: 0 }])
  const adjusted = referenceMotionFrames({ fps: 15, frames: 1, data: corrected })[0].feature.lForearm
  assert.notDeepEqual(adjusted, base, 'gameplay scoring must use the manually corrected limb direction')
})
