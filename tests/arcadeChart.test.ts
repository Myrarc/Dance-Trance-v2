import assert from 'node:assert/strict'
import test from 'node:test'
import { buildArcadeChart } from '../src/pose/arcadeChart.ts'
import { upcomingCues, type CueEvent } from '../src/pose/hitTargets.ts'
import { evaluateMotionInterval, motionIntervalsForCues, motionJudgmentTime, motionLagLimit } from '../src/pose/motionScore.ts'
import { judgeMotionTargets, newMotionRound } from '../src/pose/gameplay.ts'
import { activeHitFeedback } from '../src/pose/arcade.ts'
import type { PoseTrack } from '../src/pose/track.ts'
import type { SongEdit } from '../src/lib/songEdits.ts'

const cue: CueEvent = { id: 'arm', kind: 'spot', joint: 'leftHand', time: .5, poseTime: .5,
  x: .3, y: .4, confidence: 1, feature: {} }
const frames = Array.from({ length: 61 }, (_, index) => {
  const angle = Math.min(index / 15, 1) * Math.PI / 2
  const arm = { x: Math.cos(angle), y: Math.sin(angle), z: 0 }
  return { t: index / 30, feature: { lUpperArm: arm, lForearm: arm } }
})
function track(): PoseTrack {
  const data = new Float32Array(40 * 33 * 6)
  for (let frame = 0; frame < 40; frame++) {
    for (let index = 0; index < 33; index++) data.set([.5, .5, 1, .5, .5, 0], (frame * 33 + index) * 6)
    for (const [index, x, y] of [[11, .4, .35], [12, .6, .35], [23, .42, .65], [24, .58, .65], [16, .7, .45]]) {
      data.set([x, y, 1, x, y, 0], (frame * 33 + index) * 6)
    }
    const step = frame <= 6 ? frame : 12 - Math.min(frame, 12)
    const x = .3 + step * .035
    data.set([x, .45, 1, x, .45, 0], (frame * 33 + 15) * 6)
  }
  return { fps: 10, frames: 40, data }
}

test('every displayed generated or authored target is scored exactly once, and empty charts cannot score hidden targets', () => {
  const reference = track()
  const generated = buildArcadeChart(reference, 'hard', 'upper', false)
  assert.ok(generated.cues.length > 0)
  assert.deepEqual(generated.intervals.map((interval) => interval.cue), generated.cues)
  assert.equal(new Set(generated.cues.map((target) => target.id)).size, generated.cues.length)
  const edit: SongEdit = { version: 1, duration: 4, start: 0, end: 4, lighting: null,
    charts: { hard: [{ id: 'authored', kind: 'spot', joint: 'leftHand', time: 1.25, duration: 0, x: .8, y: .2 }] } }
  const authored = buildArcadeChart(reference, 'hard', 'upper', false, edit)
  assert.deepEqual(authored.cues.map((target) => [target.id, target.time, target.x]), [['authored', 1.25, .8]])
  assert.equal(authored.intervals.length, 1)
  assert.equal(authored.intervals[0].cue, authored.cues[0])
  assert.deepEqual(buildArcadeChart(reference, 'hard', 'upper', false, { ...edit, charts: { hard: [] } }).intervals, [])
})

test('manual beats schedule the same events used by scoring, without dropping off-beat reference motion', () => {
  const reference = track()
  const chart = buildArcadeChart(reference, 'hard', 'upper', false, null, { bpm: 120, start: .65 })
  assert.ok(chart.cues.length > 0)
  assert.ok(Math.abs(chart.cues[0].time - .65) < .001)
  assert.equal(chart.intervals[0].cue?.time, chart.cues[0].time)
  const sparse = buildArcadeChart(reference, 'hard', 'upper', false, null, { marks: [{ time: 3.5, kind: 'burst' }] })
  assert.ok(sparse.cues.length > 0)
})

test('overlapping authored notes stay visible instead of being hidden while both score', () => {
  const edit: SongEdit = { version: 1, duration: 4, start: 0, end: 4, lighting: null,
    charts: { hard: [1, 1.2].map((time) => ({ id: `note-${time}`, kind: 'spot', joint: 'leftHand', time, duration: 0, x: .3, y: .4 })) } }
  const chart = buildArcadeChart(track(), 'hard', 'upper', false, edit)
  assert.equal(chart.intervals.length, 2)
  assert.deepEqual(upcomingCues(chart.cues, .9, .8, .34, true), chart.cues)
})

test('beat scheduling offsets the expected performance, not the reference pose samples', () => {
  const scheduled = { ...cue, time: .7 }
  const interval = motionIntervalsForCues([scheduled])[0]
  const player = frames.map((frame) => ({ ...frame, t: frame.t + .2 }))
  const evidence = evaluateMotionInterval(interval, frames, player, 'hard')
  assert.ok(evidence.quality! >= .8)
  assert.equal(evidence.lag, 0)
  assert.equal(interval.end, .5)
  assert.equal(motionJudgmentTime(interval, 'hard'), 1.02)
})

test('targets stay visible through their judgment window rather than disappearing before feedback', () => {
  const interval = motionIntervalsForCues([cue])[0]
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const due = motionJudgmentTime(interval, difficulty)
    assert.deepEqual(upcomingCues([cue], due, .8, motionLagLimit(difficulty) + .04), [cue])
  }
})

test('simultaneous Perfect and Miss judgments retain both players and each exact target', () => {
  const chart = { frames, intervals: motionIntervalsForCues([cue]) }
  const first = judgeMotionTargets(newMotionRound(1), chart, frames, 'hard', 2, false, 1)
  const still = frames.map((frame) => ({ ...frame, feature: frames[0].feature }))
  const second = judgeMotionTargets(newMotionRound(1), chart, still, 'hard', 2, false, 2)
  const hits = [...first.hits, ...second.hits]
  assert.deepEqual(hits.map((hit) => [hit.player, hit.grade]), [[1, 'perfect'], [2, 'miss']])
  assert.ok(hits.every((hit) => hit.cue === cue))
  assert.equal(judgeMotionTargets(first.round, chart, frames, 'hard', 2, false, 1).hits.length, 0)
})

test('a catch-up frame retains every due target rather than only its highest grade', () => {
  const secondCue = { ...cue, id: 'next', time: 1.25, poseTime: 1.25 }
  const chart = { frames, intervals: motionIntervalsForCues([cue, secondCue]) }
  const result = judgeMotionTargets(newMotionRound(2), chart, frames, 'hard', 2, false, 1)
  assert.equal(result.judgments.length, 2)
  assert.deepEqual(result.hits.map((hit) => hit.cue.id), ['arm', 'next'])
  assert.equal(result.round.nextTarget, 2)
})

test('feedback lifetime follows a monotonic clock and expires with stopped video playback', () => {
  const hit = { id: 1, player: 1, grade: 'perfect' as const, cue, at: 1000 }
  assert.deepEqual(activeHitFeedback([hit], 1100), [hit])
  assert.deepEqual(activeHitFeedback([hit], 1481), [])
  assert.deepEqual(activeHitFeedback([hit], 999), [])
})
