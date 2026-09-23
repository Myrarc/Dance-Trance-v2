import {
  compareHitAngles,
  hitMovementDegrees,
  MIN_HIT_MOVEMENT_DEG,
  type PoseFeature,
} from './angles.ts'
import type { CueEvent, Difficulty } from './hitTargets.ts'
import type { MotionEvidence, MotionInterval } from './motionScore.ts'

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'results'
export type HitGrade = 'perfect' | 'good' | 'miss'

export const HIT_WINDOW_S = 0.25
const HIT_WINDOW_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 0.4,
  normal: HIT_WINDOW_S,
  hard: 0.2,
}

// These mirror the green/yellow limb tolerances: about 20° and 42° off target.
const PERFECT_MATCH = 78
const GOOD_MATCH = 53

export interface PlayerRound {
  score: number
  combo: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
  judged: number
  nextTarget: number
  lastGrade: HitGrade | null
  pending: Record<number, { bestMatch: number | null; observedWindow: boolean }>
}

export interface CueLandmark {
  x: number
  y: number
  visibility?: number
}

export interface CueFrame {
  feature: PoseFeature
  landmarks: CueLandmark[]
}

export interface CueReading {
  match: number | null
  movement: number | null
}

export const newPlayerRound = (): PlayerRound => ({
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  good: 0,
  miss: 0,
  judged: 0,
  nextTarget: 0,
  lastGrade: null,
  pending: {},
})

export function gradeMatch(match: number | null): HitGrade {
  if (match !== null && match >= PERFECT_MATCH) return 'perfect'
  if (match !== null && match >= GOOD_MATCH) return 'good'
  return 'miss'
}

export function judgeDueCues(
  player: PlayerRound,
  match: number | null | ((cue: CueEvent) => number | null),
  time: number,
  cues: CueEvent[],
  posePresent?: boolean,
  difficulty: Difficulty = 'normal',
): PlayerRound {
  let next = player
  const hitWindow = HIT_WINDOW_BY_DIFFICULTY[difficulty]
  for (let index = next.nextTarget; index < cues.length; index++) {
    const cue = cues[index]
    if (time < cue.time - hitWindow) break
    if (time > cue.time + hitWindow) continue
    const previous = next.pending[index]
    const reading = posePresent !== false ? typeof match === 'function' ? match(cue) : match : null
    const bestMatch = reading !== null && (previous?.bestMatch == null || reading > previous.bestMatch)
      ? reading : previous?.bestMatch ?? null
    const observedWindow = posePresent !== false || previous?.observedWindow === true
    if (bestMatch !== previous?.bestMatch || observedWindow !== previous?.observedWindow) {
      next = { ...next, pending: { ...next.pending, [index]: { bestMatch, observedWindow } } }
    }
  }
  while (next.nextTarget < cues.length && time >= cues[next.nextTarget].time + hitWindow) {
    const pending = { ...next.pending }
    const reading = pending[next.nextTarget]
    delete pending[next.nextTarget]
    if (posePresent !== undefined && !reading?.observedWindow) {
      next = { ...next, nextTarget: next.nextTarget + 1, pending }
      continue
    }

    const grade = gradeMatch(reading?.bestMatch ?? null)
    const combo = grade === 'miss' ? 0 : next.combo + 1
    const base = grade === 'perfect' ? 1000 : grade === 'good' ? 600 : 0
    next = {
      ...next,
      score: next.score + Math.round(base * (1 + Math.min(combo, 20) * 0.025)),
      combo,
      maxCombo: Math.max(next.maxCombo, combo),
      perfect: next.perfect + (grade === 'perfect' ? 1 : 0),
      good: next.good + (grade === 'good' ? 1 : 0),
      miss: next.miss + (grade === 'miss' ? 1 : 0),
      judged: next.judged + 1,
      nextTarget: next.nextTarget + 1,
      lastGrade: grade,
      pending,
    }
  }
  return next
}

const visible = (point: CueLandmark | undefined) =>
  !!point && (point.visibility ?? 1) >= 0.5 && Number.isFinite(point.x) && Number.isFinite(point.y)

const distance = (a: CueLandmark, b: CueLandmark) => Math.hypot(a.x - b.x, a.y - b.y)

function bodyScale(landmarks: CueLandmark[]): number | null {
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  if (visible(leftShoulder) && visible(rightShoulder)) {
    const width = distance(leftShoulder, rightShoulder)
    if (width > 0.02) return width
  }
  const leftHip = landmarks[23]
  const rightHip = landmarks[24]
  if (!visible(leftShoulder) || !visible(rightShoulder) || !visible(leftHip) || !visible(rightHip)) return null
  const shoulder = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  }
  const hip = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
  const height = distance(shoulder, hip)
  return height > 0.02 ? height : null
}

function wristGap(landmarks: CueLandmark[]): number | null {
  const left = landmarks[15]
  const right = landmarks[16]
  const scale = bodyScale(landmarks)
  return visible(left) && visible(right) && scale ? distance(left, right) / scale : null
}

/** Score one cue from a short per-player pose history. */
export function scoreCue(
  cue: CueEvent,
  current: CueFrame | null,
  history: { t: number; value: CueFrame }[],
  now: number,
  mirrored: boolean,
  trackHead = true,
): CueReading {
  if (!current) return { match: null, movement: null }

  if (cue.kind === 'spot') {
    const previous = movementBaseline(history, now)
    const movement = previous
      ? hitMovementDegrees(previous.feature, current.feature, cue.joint, mirrored)
      : null
    const match = movement !== null && movement >= MIN_HIT_MOVEMENT_DEG
      ? compareHitAngles(current.feature, cue.feature, cue.joint, mirrored, trackHead).score
      : null
    return { match, movement }
  }

  if (cue.kind === 'hold') {
    const start = now - cue.duration
    const samples = history.filter((sample) => sample.t >= start && sample.t <= now)
    if (samples.length < 2) return { match: null, movement: null }
    const coverage = (samples[samples.length - 1].t - samples[0].t) / cue.duration
    if (coverage < 0.7) return { match: null, movement: coverage * 100 }
    const scores = samples.map((sample) =>
      compareHitAngles(sample.value.feature, cue.feature, cue.joint, mirrored, trackHead).score ?? 0,
    )
    return {
      match: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
      movement: coverage * 100,
    }
  }

  const previous = movementBaseline(history, now, 0.25, 0.7)
  const gap = wristGap(current.landmarks)
  const previousGap = previous ? wristGap(previous.landmarks) : null
  if (gap === null || previousGap === null) return { match: null, movement: null }
  const closing = previousGap - gap
  if (closing < 0.25) return { match: null, movement: closing }
  const proximity = clamp(
    100 - Math.max(0, gap - cue.expectedGap) / 0.4 * 100,
    0,
    100,
  )
  const left = compareHitAngles(current.feature, cue.feature, 'leftHand', mirrored, trackHead).score
  const right = compareHitAngles(current.feature, cue.feature, 'rightHand', mirrored, trackHead).score
  if (left === null && right === null) return { match: null, movement: closing }
  const armPose = left === null ? right! : right === null ? left : (left + right) / 2
  return { match: Math.round(proximity * 0.7 + armPose * 0.3), movement: closing }
}

export interface MotionRound extends PlayerRound {
  scoringVersion: 2
  qualitySum: number
  coverageSum: number
  possibleIntervals: number
  expectedIntervals: number
  lag: number
}

export const newMotionRound = (expectedIntervals = 0): MotionRound => ({
  ...newPlayerRound(),
  scoringVersion: 2,
  qualitySum: 0,
  coverageSum: 0,
  possibleIntervals: 0,
  expectedIntervals,
  lag: 0,
})

export function advanceMotionRound(
  player: MotionRound,
  evidence: MotionEvidence,
  kind: MotionInterval['kind'],
): MotionRound {
  const nextTarget = player.nextTarget + 1
  const possibleIntervals = player.possibleIntervals + 1
  const coverageSum = player.coverageSum + evidence.coverage
  if (evidence.quality === null) return { ...player, nextTarget, possibleIntervals, coverageSum }
  const grade: HitGrade = evidence.quality >= 0.8 ? 'perfect'
    : evidence.quality >= 0.45 ? 'good' : 'miss'
  const combo = grade === 'miss' ? 0 : player.combo + 1
  const base = grade === 'miss' ? 0 : Math.round(1000 * evidence.quality * (kind === 'hold' ? 0.5 : 1))
  return {
    ...player,
    nextTarget,
    possibleIntervals,
    coverageSum,
    qualitySum: player.qualitySum + evidence.quality,
    lag: evidence.lag,
    score: player.score + Math.round(base * (1 + Math.min(combo, 20) * 0.025)),
    combo,
    maxCombo: Math.max(player.maxCombo, combo),
    perfect: player.perfect + (grade === 'perfect' ? 1 : 0),
    good: player.good + (grade === 'good' ? 1 : 0),
    miss: player.miss + (grade === 'miss' ? 1 : 0),
    judged: player.judged + 1,
    lastGrade: grade,
  }
}

const isMotionRound = (player: PlayerRound): player is MotionRound =>
  'scoringVersion' in player && player.scoringVersion === 2

export const trackingCoverage = (player: PlayerRound) =>
  isMotionRound(player) && (player.expectedIntervals || player.possibleIntervals)
    ? Math.round(player.coverageSum / Math.max(player.expectedIntervals, player.possibleIntervals) * 100) : 0

export const recordEligible = (player: PlayerRound) =>
  isMotionRound(player) && player.judged > 0 && trackingCoverage(player) >= 70

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** The reference confirms a run only after its video has rewound and started. */
export const isGameRunReady = (referenceRun: number, gameRun: number) =>
  gameRun > 0 && referenceRun === gameRun

/** Find a real earlier camera sample even when pose inference only runs at 2 FPS. */
export function movementBaseline<T>(
  history: { t: number; value: T }[],
  now: number,
  minAge = 0.2,
  maxAge = 1,
): T | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const age = now - history[index].t
    if (age >= minAge && age <= maxAge) return history[index].value
  }
  return null
}

export const accuracy = (player: PlayerRound) =>
  player.judged ? Math.round(((isMotionRound(player)
    ? player.qualitySum : player.perfect + player.good * 0.6) / player.judged) * 100) : 0

/** Preserve player identity when two dancers cross left/right on camera. */
export function stablePlayerOrder<T extends { x: number }>(players: T[], previousX: number[]): T[] {
  if (players.length !== 2 || previousX.length !== 2) return [...players].sort((a, b) => a.x - b.x)
  const direct = Math.abs(players[0].x - previousX[0]) + Math.abs(players[1].x - previousX[1])
  const swapped = Math.abs(players[1].x - previousX[0]) + Math.abs(players[0].x - previousX[1])
  return direct <= swapped ? players : [players[1], players[0]]
}
