import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoseTrack } from '../src/pose/track.ts'
import { buildCueChart, nearestVisibleCue, removeOverlappingLimbCues, upcomingCues, type CueEvent } from '../src/pose/hitTargets.ts'

const fps = 10
const frames = 40
const stride = 33 * 6

function makeTrack(update?: (data: Float32Array, frame: number) => void): PoseTrack {
  const data = new Float32Array(frames * stride)
  for (let frame = 0; frame < frames; frame++) {
    for (let index = 0; index < 33; index++) {
      setPoint(data, frame, index, 0.5, 0.5)
    }
    setPoint(data, frame, 11, 0.4, 0.35)
    setPoint(data, frame, 12, 0.6, 0.35)
    setPoint(data, frame, 23, 0.42, 0.65)
    setPoint(data, frame, 24, 0.58, 0.65)
    setPoint(data, frame, 15, 0.3, 0.45)
    setPoint(data, frame, 16, 0.7, 0.45)
    setPoint(data, frame, 27, 0.43, 0.9)
    setPoint(data, frame, 28, 0.57, 0.9)
    update?.(data, frame)
  }
  return { fps, frames, data }
}

function setPoint(
  data: Float32Array,
  frame: number,
  index: number,
  x: number,
  y: number,
  visibility = 1,
) {
  const offset = frame * stride + index * 6
  data[offset] = x
  data[offset + 1] = y
  data[offset + 2] = visibility
  data[offset + 3] = x
  data[offset + 4] = y
  data[offset + 5] = 0
}

test('score focus excludes unused limb markers from the chart that scoring receives', () => {
  const track = makeTrack((data, frame) => {
    const step = frame <= 6 ? frame : 12 - Math.min(frame, 12)
    setPoint(data, frame, 15, 0.3 + step * 0.035, 0.45)
    setPoint(data, frame, 27, 0.43 + step * 0.035, 0.9)
  })
  const full = buildCueChart(track, 'hard')
  assert.ok(full.some((cue) => cue.kind !== 'clap' && cue.joint === 'leftHand'))
  assert.ok(full.some((cue) => cue.kind !== 'clap' && cue.joint === 'leftFoot'))
  const arms = buildCueChart(track, 'hard', false, 'upper')
  const legs = buildCueChart(track, 'hard', false, 'lower')
  assert.ok(arms.length > 0)
  assert.ok(legs.length > 0)
  assert.ok(arms.every((cue) => cue.kind === 'clap' || cue.joint === 'leftHand' || cue.joint === 'rightHand'))
  assert.ok(legs.every((cue) => cue.kind !== 'clap' && (cue.joint === 'leftFoot' || cue.joint === 'rightFoot')))
})

test('turns a movement endpoint into a Spot cue', () => {
  const track = makeTrack((data, frame) => {
    const step = frame <= 6 ? frame : 12 - Math.min(frame, 12)
    setPoint(data, frame, 15, 0.3 + step * 0.035, 0.45)
  })
  const cue = buildCueChart(track, 'hard').find((value) => value.kind === 'spot' && value.joint === 'leftHand')
  assert.ok(cue)
  assert.ok(cue.confidence > 0)
})

test('moving across the frame with still limbs does not create hand hits', () => {
  const track = makeTrack((data, frame) => {
    const shift = Math.min(frame, 6) * 0.014
    for (let index = 0; index < 33; index++) {
      const offset = frame * stride + index * 6
      setPoint(data, frame, index, data[offset] + shift, data[offset + 1])
    }
  })
  assert.equal(buildCueChart(track, 'hard').some((cue) => cue.kind === 'spot' && (cue.joint === 'leftHand' || cue.joint === 'rightHand')), false)
})

test('turns a stable movement endpoint into a Hold cue', () => {
  const track = makeTrack((data, frame) => {
    const x = frame < 6 ? 0.3 + frame * 0.07 : frame < 24 ? 0.72 : 0.5
    setPoint(data, frame, 15, x, 0.45)
  })
  const cue = buildCueChart(track, 'hard').find((value) => value.kind === 'hold' && value.joint === 'leftHand')
  assert.ok(cue)
  assert.ok(cue.duration >= 0.6)
})

test('detects a closing and reopening hand pair as Clap', () => {
  const track = makeTrack((data, frame) => {
    const phase = Math.min(frame, 5)
    const left = frame <= 5 ? 0.3 + phase * 0.034 : 0.47 - Math.min(frame - 5, 5) * 0.034
    const right = 1 - left
    setPoint(data, frame, 15, left, 0.45)
    setPoint(data, frame, 16, right, 0.45)
  })
  const chart = buildCueChart(track, 'hard')
  const clap = chart.find((cue) => cue.kind === 'clap')
  assert.ok(clap)
  assert.ok(clap.expectedGap <= 0.4)
  assert.equal(
    chart.some((cue) => cue.kind === 'spot' && (cue.joint === 'leftHand' || cue.joint === 'rightHand') && Math.abs(cue.poseTime - clap.poseTime) <= 0.25),
    false,
  )
})

test('rejects Clap when either wrist is not confidently visible', () => {
  const track = makeTrack((data, frame) => {
    const left = frame <= 5 ? 0.3 + frame * 0.034 : 0.47
    setPoint(data, frame, 15, left, 0.45, 0.2)
    setPoint(data, frame, 16, 1 - left, 0.45)
  })
  assert.equal(buildCueChart(track, 'hard').some((cue) => cue.kind === 'clap'), false)
})

test('torso sway does not create a Body score note', () => {
  const track = makeTrack((data, frame) => {
    const shift = frame <= 6 ? frame * 0.014 : Math.max(0, 12 - frame) * 0.014
    for (const index of [11, 12, 23, 24]) {
      const offset = frame * stride + index * 6
      setPoint(data, frame, index, data[offset] + shift, data[offset + 1])
    }
  })
  assert.equal(buildCueChart(track, 'hard').length, 0)
})

test('a clap can happen beside the dancer or above their head', () => {
  for (const [label, centerX, centerY] of [
    ['left', 0.17, 0.45],
    ['right', 0.83, 0.45],
    ['overhead', 0.5, 0.12],
  ] as const) {
    const track = makeTrack((data, frame) => {
      const spread = frame <= 5
        ? 0.15 - frame * 0.024
        : 0.03 + Math.min(frame - 5, 5) * 0.024
      setPoint(data, frame, 15, centerX - spread, centerY)
      setPoint(data, frame, 16, centerX + spread, centerY)
    })
    const clap = buildCueChart(track, 'hard').find((cue) => cue.kind === 'clap')
    assert.ok(clap, `${label} clap should produce a note`)
    assert.ok(Math.abs(clap.x - centerX) < 0.01)
    assert.ok(Math.abs(clap.y - centerY) < 0.01)
  }
})

test('hands overlapping only in the camera projection during a spin do not create a clap', () => {
  const track = makeTrack((data, frame) => {
    const spread = frame <= 5
      ? 0.2 - frame * 0.034
      : 0.03 + Math.min(frame - 5, 5) * 0.034
    setPoint(data, frame, 15, 0.5 - spread, 0.45)
    setPoint(data, frame, 16, 0.5 + spread, 0.45)
    // Pose-world wrists stay far apart in depth even though their image points overlap.
    data[frame * stride + 15 * 6 + 5] = -0.3
    data[frame * stride + 16 * 6 + 5] = 0.3
  })
  assert.equal(buildCueChart(track, 'hard').some((cue) => cue.kind === 'clap'), false)
})

test('hands that come together but never separate do not create a clap', () => {
  const track = makeTrack((data, frame) => {
    const spread = 0.2 - Math.min(frame, 5) * 0.034
    setPoint(data, frame, 15, 0.5 - spread, 0.45)
    setPoint(data, frame, 16, 0.5 + spread, 0.45)
  })
  assert.equal(buildCueChart(track, 'hard').some((cue) => cue.kind === 'clap'), false)
})

test('hands passing across one another during a turn do not create a clap', () => {
  const track = makeTrack((data, frame) => {
    const offset = 0.2 - frame * 0.04
    setPoint(data, frame, 15, 0.5 - offset, 0.45)
    setPoint(data, frame, 16, 0.5 + offset, 0.45)
  })
  assert.equal(buildCueChart(track, 'hard').some((cue) => cue.kind === 'clap'), false)
})

test('notes on one limb cannot share visible time, including a hold and a clap', () => {
  const cues: CueEvent[] = [
    { kind: 'spot', time: 1.5, poseTime: 1.5, joint: 'rightFoot', x: 0.7, y: 0.8, feature: {}, confidence: 1 },
    { kind: 'hold', time: 2, poseTime: 1, duration: 1, joint: 'leftHand', x: 0.2, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'spot', time: 2.4, poseTime: 2.4, joint: 'leftHand', x: 0.3, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'clap', time: 2.6, poseTime: 2.6, x: 0.5, y: 0.4, expectedGap: 0.2, feature: {}, confidence: 1 },
    { kind: 'spot', time: 3.1, poseTime: 3.1, joint: 'rightHand', x: 0.8, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'spot', time: 3.6, poseTime: 3.6, joint: 'rightFoot', x: 0.7, y: 0.8, feature: {}, confidence: 1 },
  ]
  assert.deepEqual(removeOverlappingLimbCues(cues), [cues[0], cues[1], cues[4], cues[5]])
})

test('a clap reserves both hand lanes but not the head or feet', () => {
  const cues: CueEvent[] = [
    { kind: 'clap', time: 1, poseTime: 1, x: 0.5, y: 0.4, expectedGap: 0.2, feature: {}, confidence: 1 },
    { kind: 'spot', time: 1.4, poseTime: 1.4, joint: 'leftHand', x: 0.2, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'spot', time: 1.4, poseTime: 1.4, joint: 'rightHand', x: 0.8, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'spot', time: 1.4, poseTime: 1.4, joint: 'head', x: 0.5, y: 0.2, feature: {}, confidence: 1 },
    { kind: 'spot', time: 2.1, poseTime: 2.1, joint: 'rightHand', x: 0.8, y: 0.4, feature: {}, confidence: 1 },
  ]
  assert.deepEqual(removeOverlappingLimbCues(cues), [cues[0], cues[3], cues[4]])
})

test('snaps cue judgment time to the beat while preserving pose time', () => {
  const track = makeTrack((data, frame) => {
    const step = frame <= 6 ? frame : 12 - Math.min(frame, 12)
    setPoint(data, frame, 15, 0.3 + step * 0.035, 0.45)
  })
  track.beats = new Float32Array([0.65, 1.3, 1.95])
  const cue = buildCueChart(track, 'hard').find((value) => value.kind === 'spot')
  assert.ok(cue)
  assert.ok(Math.abs(cue.time - 0.65) < 1e-5)
  assert.notEqual(cue.poseTime, cue.time)
})

test('difficulty produces a nondecreasing number of cues', () => {
  const track = makeTrack((data, frame) => {
    const wave = Math.sin(frame * Math.PI / 5)
    setPoint(data, frame, 15, 0.3 + wave * 0.12, 0.45)
    setPoint(data, frame, 16, 0.7 - wave * 0.12, 0.45)
  })
  track.beats = new Float32Array(Array.from({ length: 8 }, (_, index) => 0.5 + index * 0.5))
  const easy = buildCueChart(track, 'easy').length
  const normal = buildCueChart(track, 'normal').length
  const hard = buildCueChart(track, 'hard').length
  assert.ok(easy <= normal)
  assert.ok(normal <= hard)
})

test('shows one upcoming cue per limb channel and keeps Hold visible for its duration', () => {
  const cues: CueEvent[] = [
    { kind: 'hold', time: 2, poseTime: 1, duration: 1, joint: 'leftHand', x: 0.2, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'spot', time: 1.2, poseTime: 1.2, joint: 'rightHand', x: 0.8, y: 0.4, feature: {}, confidence: 1 },
    { kind: 'spot', time: 1.3, poseTime: 1.3, joint: 'rightHand', x: 0.7, y: 0.4, feature: {}, confidence: 1 },
  ]
  const visible = upcomingCues(cues, 0.9, 0.8)
  assert.deepEqual(visible.map((cue) => cue.kind), ['hold', 'spot'])
})

test('phrase feedback anchors to the nearest visible hit circle', () => {
  const cues: CueEvent[] = [
    { kind: 'spot', time: 1.5, poseTime: 1.5, joint: 'leftHand', x: 0.2, y: 0.3, feature: {}, confidence: 1 },
    { kind: 'spot', time: 1.6, poseTime: 1.6, joint: 'rightFoot', x: 0.7, y: 0.8, feature: {}, confidence: 1 },
  ]
  assert.equal(nearestVisibleCue(cues, 1.4, 0.8), cues[0])
  assert.equal(nearestVisibleCue(cues, 1.59, 0.8), cues[1])
  assert.equal(nearestVisibleCue(cues, 1.59, 0.8, ['lUpperArm']), cues[0])
  assert.equal(nearestVisibleCue(cues, 1.59, 0.8, ['rForearm']), null)
  assert.equal(nearestVisibleCue(cues, 3, 0.8), null)
})
