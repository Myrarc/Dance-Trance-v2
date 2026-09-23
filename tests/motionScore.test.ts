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

test('reference movement creates a scoring interval and a deliberate hold, without idle points', () => {
  assert.ok(scoring)
  const intervals = scoring.buildMotionIntervals(dance(), 'upper', false)
  assert.equal(intervals[0].kind, 'move')
  assert.equal(intervals.filter((interval) => interval.kind === 'move').length, 1)
  assert.ok(intervals.some((interval) => interval.kind === 'hold' && interval.end - interval.start >= 0.6))
  assert.ok(intervals.every((interval) => interval.start < 1.5))
  assert.equal(scoring.buildMotionIntervals(dance(), 'lower', false).length, 0)
})

test('a close learned move beats standing still or moving in the wrong direction', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = scoring.buildMotionIntervals(reference, 'upper', false)[0]
  const learned = scoring.evaluateMotionInterval(interval, reference, dance(80), 'easy', 0, false)
  const still = scoring.evaluateMotionInterval(interval, reference, dance(0), 'easy', 0, false)
  const reversed = scoring.evaluateMotionInterval(interval, reference, dance(-90), 'easy', 0, false)
  assert.ok(learned.quality !== null && learned.quality >= 0.8)
  assert.ok(still.quality !== null && still.quality < 0.45)
  assert.ok(reversed.quality !== null && reversed.quality < 0.45)
})

test('the same late movement receives less credit on harder difficulties', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = scoring.buildMotionIntervals(reference, 'upper', false)[0]
  const late = dance(90, 0.25)
  const easy = scoring.evaluateMotionInterval(interval, reference, late, 'easy', 0, false)
  const hard = scoring.evaluateMotionInterval(interval, reference, late, 'hard', 0, false)
  assert.ok(easy.quality !== null && hard.quality !== null)
  assert.ok(easy.quality > hard.quality)
  assert.ok(easy.lag > 0)
})

test('an established timing offset cannot jump to a lucky frame in one phrase', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = scoring.buildMotionIntervals(reference, 'upper', false)[0]
  const reading = scoring.evaluateMotionInterval(interval, reference, dance(90, 0.5), 'easy', 0, false, true)
  assert.ok(Math.abs(reading.lag) <= 0.15)
})

test('brief surrounded tracking gaps bridge, but long gaps do not become invented motion', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = scoring.buildMotionIntervals(reference, 'upper', false)[0]
  const brief = dance().filter((sample) => sample.t < 0.19 || sample.t > 0.32)
  const long = dance().filter((sample) => sample.t < 0.12 || sample.t > 0.43)
  assert.ok(scoring.evaluateMotionInterval(interval, reference, brief, 'normal', 0, false).quality !== null)
  assert.equal(scoring.evaluateMotionInterval(interval, reference, long, 'normal', 0, false).quality, null)
})

test('weak landmark visibility reduces evidence coverage without changing the movement direction', () => {
  assert.ok(scoring)
  const reference = dance()
  const interval = scoring.buildMotionIntervals(reference, 'upper', false)[0]
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
