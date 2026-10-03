import assert from 'node:assert/strict'
import test from 'node:test'
import type { PoseFeature } from '../src/pose/angles.ts'

const scoring = await import('../src/pose/motionScore.ts').catch(() => null)

const pose = (degrees: number): PoseFeature => {
  const angle = degrees * Math.PI / 180
  const direction = { x: Math.cos(angle), y: Math.sin(angle), z: 0 }
  return { lUpperArm: direction, lForearm: direction }
}

const dance = (range = 90, delay = 0) => Array.from({ length: 31 }, (_, index) => {
  const t = index / 15
  return { t: t + delay, feature: pose(Math.min(1, t / 0.5) * range) }
})

const hit = () => scoring!.motionIntervalsForCues([{ kind: 'spot', joint: 'leftHand', time: .5,
  poseTime: .5, x: .3, y: .4, confidence: 1, feature: {} }])[0]

test('a close learned move beats standing still or moving in the wrong direction', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const learned = scoring.evaluateMotionInterval(interval, reference, dance(80), 'easy', 0, false)
  const still = scoring.evaluateMotionInterval(interval, reference, dance(0), 'easy', 0, false)
  const reversed = scoring.evaluateMotionInterval(interval, reference, dance(-90), 'easy', 0, false)
  assert.ok(learned.quality !== null && learned.quality >= 0.8)
  assert.ok(still.quality !== null && still.quality < 0.45)
  assert.ok(reversed.quality !== null && reversed.quality < 0.45)
})

test('auto scoring accepts identical video motion and its mirrored version', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const mirrored = reference.map((frame) => ({
    t: frame.t,
    feature: {
      rUpperArm: { ...frame.feature.lUpperArm!, x: -frame.feature.lUpperArm!.x },
      rForearm: { ...frame.feature.lForearm!, x: -frame.feature.lForearm!.x },
    },
  }))
  assert.ok(scoring.evaluateMotionInterval(interval, reference, reference, 'normal', 0, 'auto').quality! >= 0.8)
  assert.ok(scoring.evaluateMotionInterval(interval, reference, mirrored, 'normal', 0, 'auto').quality! >= 0.8)
  assert.ok(scoring.evaluateMotionInterval(interval, reference, dance(0), 'normal', 0, 'auto').quality! < 0.45)
})

test('the same late movement receives less credit on harder difficulties', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const late = dance(90, 0.25)
  const easy = scoring.evaluateMotionInterval(interval, reference, late, 'easy', 0, false)
  const hard = scoring.evaluateMotionInterval(interval, reference, late, 'hard', 0, false)
  assert.ok(easy.quality !== null && hard.quality !== null)
  assert.ok(easy.quality > hard.quality)
  assert.ok(easy.lag > 0)
})

test('Hard rewards on-time motion but a 600ms late correct move cannot earn Perfect', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const leadIn = Array.from({ length: 9 }, (_, index) => ({ t: index / 15, feature: pose(0) }))
  const right = scoring.evaluateMotionInterval(interval, reference, [...leadIn, ...dance(90, 0.6)], 'hard', 0, false, true)
  const wrong = scoring.evaluateMotionInterval(interval, reference, dance(-90), 'hard', 0, false, true)
  const onTime = scoring.evaluateMotionInterval(interval, reference, reference, 'hard')
  assert.ok(onTime.quality !== null && onTime.quality >= 0.8)
  assert.ok(right.quality !== null && right.quality < 0.45)
  assert.ok(wrong.quality !== null && wrong.quality < 0.45)
})

test('a correctly detected movement outside the Perfect window receives timing-limited credit', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const evidence = scoring.evaluateMotionInterval(interval, reference, dance(90, 0.15), 'hard')
  assert.ok(evidence.movement! > 0.95, 'movement remains accurate even when its timing is not Perfect')
  assert.ok(evidence.timing! < 0.8)
  assert.ok(evidence.quality! >= 0.45 && evidence.quality! < 0.8)
})

test('an established timing offset cannot jump to a lucky frame in one phrase', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const reading = scoring.evaluateMotionInterval(interval, reference, dance(90, 1), 'easy', 0, false, true)
  assert.ok(Math.abs(reading.lag) <= 0.6)
})

test('brief surrounded tracking gaps bridge, but long gaps do not become invented motion', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const brief = dance().filter((sample) => sample.t < 0.19 || sample.t > 0.32)
  const droppedFrames = dance().filter((sample) => sample.t <= 0.2 || sample.t >= 0.46)
  const long = dance().filter((sample) => sample.t < 0.12 || sample.t > 0.43)
  const lateGap = dance(90, 0.6).filter((sample) => sample.t < 0.72 || sample.t > 1.03)
  assert.ok(scoring.evaluateMotionInterval(interval, reference, brief, 'normal', 0, false).quality !== null)
  assert.ok(scoring.evaluateMotionInterval(interval, reference, droppedFrames, 'normal', 0, false).quality !== null)
  assert.equal(scoring.evaluateMotionInterval(interval, reference, long, 'normal', 0, false, true).quality, null)
  assert.equal(scoring.evaluateMotionInterval(interval, reference, lateGap, 'hard', 0, false, true).quality, null)
})

test('weak landmark visibility reduces evidence coverage without changing the movement direction', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = hit()
  const clear = scoring.evaluateMotionInterval(interval, reference, dance(), 'normal', 0, false)
  const weak = scoring.evaluateMotionInterval(interval, reference, dance().map((frame) => ({
    ...frame, visibility: { lUpperArm: 0.65, lForearm: 0.65 },
  })), 'normal', 0, false)
  assert.ok(weak.coverage < clear.coverage)
  assert.ok(weak.quality !== null)
})

test('preceding context distinguishes the right path from a reversed lead-in', () => {
  assert.ok(scoring)
  const reference = Array.from({ length: 16 }, (_, index) => {
    const t = index / 15
    const degrees = t < 0.3 ? 0 : t < 0.5 ? (t - 0.3) / 0.2 * 90
      : t < 0.8 ? 90 + (t - 0.5) / 0.3 * 90 : 180
    return { t, feature: pose(degrees) }
  })
  const reversed = reference.map((frame) => ({
    t: frame.t,
    feature: frame.t < 0.3 ? pose(180)
      : frame.t < 0.5 ? pose(180 - (frame.t - 0.3) / 0.2 * 90) : frame.feature,
  }))
  const interval = { start: 0.5, end: 1, kind: 'move' as const, keys: ['lUpperArm', 'lForearm'] }
  const right = scoring.evaluateMotionInterval(interval, reference, reference, 'normal', 0, false)
  const wrong = scoring.evaluateMotionInterval(interval, reference, reversed, 'normal', 0, false)
  assert.ok(right.quality !== null && wrong.quality !== null)
  assert.ok(right.quality > wrong.quality + 0.1)
})

test('the scoring clock allows a short finish after video end and resets on replay', () => {
  assert.ok(scoring)
  const ended = scoring.advanceScoringClock(10, true, 1000, 0)
  assert.equal(ended.time, 10)
  assert.equal(scoring.advanceScoringClock(10, true, 1500, ended.endedAt).time, 10.5)
  assert.deepEqual(scoring.advanceScoringClock(0, false, 1600, ended.endedAt), {
    time: 0, endedAt: 0,
  })
})
