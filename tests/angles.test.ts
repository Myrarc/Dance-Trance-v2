import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAngles, compareToHistoryEither, computeAngles, HEAD } from '../src/pose/angles.ts'

test('screen position does not change torso-relative limb directions', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  for (const [index, x, y] of [[11, -0.2, 0.3], [12, 0.2, 0.3], [23, -0.2, -0.3], [24, 0.2, -0.3], [13, -0.5, 0.3], [15, -0.8, 0.3]]) {
    landmarks[index] = { x, y, z: 0, visibility: 1 }
  }
  const shifted = landmarks.map((point) => ({ ...point, x: point.x + 2, y: point.y - 1 }))
  assert.deepEqual(computeAngles(landmarks).lUpperArm, computeAngles(shifted).lUpperArm)
})

test('excludes head from score and problems when trackHead is false', () => {
  // A pose where head differs completely:
  // user head points (0, 1, 0), target head points (0, -1, 0)
  // arm matches
  const user = {
    [HEAD]: { x: 0, y: 1, z: 0 },
    lUpperArm: { x: 1, y: 0, z: 0 },
  }
  const target = {
    [HEAD]: { x: 0, y: -1, z: 0 },
    lUpperArm: { x: 1, y: 0, z: 0 },
  }

  const withHead = compareAngles(user, target, false, 'upper', true)
  assert.equal(withHead.levels[HEAD], 'bad')
  assert.ok(withHead.problems.includes('head'))

  const withoutHead = compareAngles(user, target, false, 'upper', false)
  assert.equal(withoutHead.levels[HEAD], 'na')
  assert.ok(!withoutHead.problems.includes('head'))
  assert.equal(withoutHead.score, 100)
})

test('auto alignment keeps identical one-sided poses green and accepts their mirror', () => {
  const target = {
    lUpperArm: { x: 1, y: 0, z: 0 },
    rUpperArm: { x: 0, y: -1, z: 0 },
  }
  const reflected = {
    lUpperArm: { x: 0, y: -1, z: 0 },
    rUpperArm: { x: -1, y: 0, z: 0 },
  }
  const history = [{ t: 1, feature: target }]
  const direct = compareToHistoryEither(target, history, 1, { lag: 0 }, 'upper', false)
  const mirror = compareToHistoryEither(reflected, history, 1, { lag: 0 }, 'upper', false)
  assert.equal(direct.score, 100)
  assert.equal(direct.mirrored, false)
  assert.equal(direct.levels.lUpperArm, 'ok')
  assert.equal(mirror.score, 100)
  assert.equal(mirror.mirrored, true)
  assert.equal(mirror.levels.rUpperArm, 'ok')
})
