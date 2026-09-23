import assert from 'node:assert/strict'
import test from 'node:test'
import { accuracy, gradeMatch, HIT_WINDOW_S, isGameRunReady, judgeDueCues, movementBaseline, newPlayerRound, scoreCue, stablePlayerOrder, type CueFrame } from '../src/pose/gameplay.ts'
import { compareHitAngles, compareToHistory, hasHitMovement, type PoseFeature } from '../src/pose/angles.ts'

const targets = [
  { kind: 'spot' as const, time: 1, poseTime: 1, joint: 'leftHand' as const, x: 0.2, y: 0.3, feature: {}, confidence: 1 },
  { kind: 'spot' as const, time: 2, poseTime: 2, joint: 'rightHand' as const, x: 0.8, y: 0.3, feature: {}, confidence: 1 },
]

test('scores each due marker once and resets combo on a miss', () => {
  let player = judgeDueCues(newPlayerRound(), 90, 1, targets)
  player = judgeDueCues(player, null, 1 + HIT_WINDOW_S, targets)
  assert.equal(player.perfect, 1)
  assert.equal(player.combo, 1)
  player = judgeDueCues(player, 40, 2, targets)
  player = judgeDueCues(player, null, 2 + HIT_WINDOW_S, targets)
  assert.equal(player.miss, 1)
  assert.equal(player.combo, 0)
  assert.equal(accuracy(player), 50)
})

test('a cue with no visible player frame is neutral and preserves the combo', () => {
  let player = { ...newPlayerRound(), combo: 2 }
  player = judgeDueCues(player, null, 1, targets, false)
  player = judgeDueCues(player, null, 1 + HIT_WINDOW_S, targets, false)
  assert.equal(player.nextTarget, 1)
  assert.equal(player.judged, 0)
  assert.equal(player.miss, 0)
  assert.equal(player.combo, 2)
  player = judgeDueCues(player, 90, 2, targets, true)
  player = judgeDueCues(player, null, 2 + HIT_WINDOW_S, targets, false)
  assert.equal(player.perfect, 1)
  assert.equal(player.combo, 3)
})

test('a visible but unscorable pose is still a miss, not a camera dropout', () => {
  let player = judgeDueCues(newPlayerRound(), null, 1, targets, true)
  player = judgeDueCues(player, null, 1 + HIT_WINDOW_S, targets, false)
  assert.equal(player.miss, 1)
})

test('grades match the green and yellow limb feedback players see', () => {
  assert.equal(gradeMatch(78), 'perfect')
  assert.equal(gradeMatch(53), 'good')
  assert.equal(gradeMatch(52), 'miss')
})

test('keeps player identity when their horizontal order crosses', () => {
  const ordered = stablePlayerOrder([{ x: 0.7 }, { x: 0.3 }], [0.25, 0.75])
  assert.deepEqual(ordered.map((player) => player.x), [0.3, 0.7])
})

test('a matching player decisively outscores a player whose marked limb is wrong', () => {
  const right = { x: 1, y: 0, z: 0 }
  const wrong = { x: -1, y: 0, z: 0 }
  const reference: PoseFeature = { lUpperArm: right, lForearm: right }
  const amateur: PoseFeature = { lUpperArm: wrong, lForearm: wrong }
  const matching: PoseFeature = { lUpperArm: right, lForearm: right }
  const handTargets = [{ kind: 'spot' as const, time: 1, poseTime: 1, joint: 'leftHand' as const, x: 0.2, y: 0.3, feature: reference, confidence: 1 }]

  const p1Pending = judgeDueCues(
    newPlayerRound(),
    (target) => compareHitAngles(amateur, target.feature, target.joint, false).score,
    1,
    handTargets,
  )
  const p2Pending = judgeDueCues(
    newPlayerRound(),
    (target) => compareHitAngles(matching, target.feature, target.joint, false).score,
    1,
    handTargets,
  )
  const p1 = judgeDueCues(p1Pending, null, 1 + HIT_WINDOW_S, handTargets)
  const p2 = judgeDueCues(p2Pending, null, 1 + HIT_WINDOW_S, handTargets)

  assert.equal(p1.score, 0)
  assert.equal(p2.score, 1025)
})

test('each player keeps an independent timing estimate', () => {
  const early: PoseFeature = { lUpperArm: { x: 1, y: 0, z: 0 } }
  const current: PoseFeature = { lUpperArm: { x: 0, y: 1, z: 0 } }
  const history = [{ t: 0, feature: early }, { t: 1, feature: current }]
  const p1 = { lag: 0 }
  const p2 = { lag: 0 }

  compareToHistory(early, history, 1, false, p1)
  compareToHistory(current, history, 1, false, p2)

  assert.ok(p1.lag > 0)
  assert.equal(p2.lag, 0)
})

test('standing still cannot keep earning hit points', () => {
  const held: PoseFeature = {
    lUpperArm: { x: 1, y: 0, z: 0 },
    lForearm: { x: 1, y: 0, z: 0 },
  }
  const moved: PoseFeature = {
    lUpperArm: { x: 0, y: 1, z: 0 },
    lForearm: { x: 0, y: 1, z: 0 },
  }

  assert.equal(hasHitMovement(held, held, 'leftHand', false), false)
  assert.equal(hasHitMovement(held, moved, 'leftHand', false), true)
})

test('keeps the best reading inside a hit window', () => {
  let player = judgeDueCues(newPlayerRound(), 55, 0.8, targets)
  player = judgeDueCues(player, 90, 1.1, targets)
  player = judgeDueCues(player, null, 1 + HIT_WINDOW_S, targets)

  assert.equal(player.perfect, 1)
})

test('does not reuse one late camera frame for several missed markers', () => {
  let calls = 0
  const crowded = [targets[0], { ...targets[1], time: 1.1, poseTime: 1.1 }]
  const player = judgeDueCues(newPlayerRound(), () => {
    calls++
    return 100
  }, 1.6, crowded)

  assert.equal(calls, 0)
  assert.equal(player.miss, 2)
})

test('arms replay scoring from the reference run instead of a fragile time threshold', () => {
  assert.equal(isGameRunReady(1, 2), false)
  assert.equal(isGameRunReady(2, 2), true)
})

test('finds a movement baseline when tracking only runs at 2 FPS', () => {
  const history = [{ t: 10, value: 'before' }, { t: 10.5, value: 'now' }]
  assert.equal(movementBaseline(history, 10.5), 'before')
})

const armPose: PoseFeature = {
  lUpperArm: { x: 1, y: 0, z: 0 },
  lForearm: { x: 1, y: 0, z: 0 },
  rUpperArm: { x: -1, y: 0, z: 0 },
  rForearm: { x: -1, y: 0, z: 0 },
}

function cueFrame(torsoX: number, leftWristX = torsoX - 0.25, rightWristX = torsoX + 0.25): CueFrame {
  const landmarks = Array.from({ length: 33 }, () => ({ x: torsoX, y: 0.5, visibility: 1 }))
  landmarks[11] = { x: torsoX - 0.1, y: 0.35, visibility: 1 }
  landmarks[12] = { x: torsoX + 0.1, y: 0.35, visibility: 1 }
  landmarks[23] = { x: torsoX - 0.08, y: 0.65, visibility: 1 }
  landmarks[24] = { x: torsoX + 0.08, y: 0.65, visibility: 1 }
  landmarks[15] = { x: leftWristX, y: 0.4, visibility: 1 }
  landmarks[16] = { x: rightWristX, y: 0.4, visibility: 1 }
  return { feature: armPose, landmarks }
}

test('a brief correct pose cannot pass a hold cue', () => {
  const cue = {
    kind: 'hold' as const,
    time: 1,
    poseTime: 0,
    duration: 1,
    joint: 'leftHand' as const,
    x: 0.3,
    y: 0.4,
    feature: armPose,
    confidence: 1,
  }
  const current = cueFrame(0.5)
  const reading = scoreCue(cue, current, [{ t: 0.8, value: current }, { t: 1, value: current }], 1, false)
  assert.equal(reading.match, null)
})

test('a sustained matching pose passes a hold cue', () => {
  const cue = {
    kind: 'hold' as const,
    time: 1,
    poseTime: 0,
    duration: 1,
    joint: 'leftHand' as const,
    x: 0.3,
    y: 0.4,
    feature: armPose,
    confidence: 1,
  }
  const current = cueFrame(0.5)
  const history = [0, 0.5, 1].map((t) => ({ t, value: current }))
  assert.equal(scoreCue(cue, current, history, 1, false).match, 100)
})

test('clap scoring requires the hands to close instead of merely staying together', () => {
  const apart = cueFrame(0.5)
  const together = cueFrame(0.5, 0.47, 0.53)
  const cue = {
    kind: 'clap' as const,
    time: 0.5,
    poseTime: 0.5,
    x: 0.5,
    y: 0.4,
    expectedGap: 0.3,
    feature: armPose,
    confidence: 1,
  }
  assert.ok((scoreCue(cue, together, [{ t: 0, value: apart }, { t: 0.5, value: together }], 0.5, false).match ?? 0) >= 78)
  assert.equal(scoreCue(cue, together, [{ t: 0, value: together }, { t: 0.5, value: together }], 0.5, false).match, null)
})

test('swing scoring rejects standing still and the wrong direction', () => {
  const start = cueFrame(0.5)
  const recent = cueFrame(0.59)
  const right = cueFrame(0.6)
  const left = cueFrame(0.4)
  const cue = {
    kind: 'swing' as const,
    time: 1,
    poseTime: 1,
    direction: 'right' as const,
    displacement: 0.5,
    duration: 1,
    x: 0.6,
    y: 0.5,
    confidence: 1,
  }
  const history = [{ t: 0, value: start }, { t: 0.75, value: recent }, { t: 1, value: right }]
  assert.ok((scoreCue(cue, right, history, 1, false).match ?? 0) >= 78)
  assert.ok((scoreCue(cue, right, [{ t: 0, value: start }, { t: 1, value: right }], 1, false).match ?? 0) >= 78)
  assert.equal(scoreCue(cue, left, [{ t: 0, value: start }, { t: 0.75, value: cueFrame(0.41) }, { t: 1, value: left }], 1, false).match, 0)
  assert.equal(scoreCue(cue, start, [{ t: 0, value: start }, { t: 0.75, value: start }, { t: 1, value: start }], 1, false).match, 0)
})

test('mirroring reverses the required swing direction', () => {
  const start = cueFrame(0.5)
  const recent = cueFrame(0.41)
  const left = cueFrame(0.4)
  const cue = {
    kind: 'swing' as const,
    time: 1,
    poseTime: 1,
    direction: 'right' as const,
    displacement: 0.5,
    duration: 1,
    x: 0.6,
    y: 0.5,
    confidence: 1,
  }
  const history = [{ t: 0, value: start }, { t: 0.75, value: recent }, { t: 1, value: left }]
  assert.ok((scoreCue(cue, left, history, 1, true).match ?? 0) >= 78)
})
