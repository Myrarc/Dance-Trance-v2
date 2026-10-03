import type { PoseFeature } from './angles.ts'
import { evaluateMotionInterval, motionJudgmentTime, type MotionEvidence, type MotionFrame, type MotionInterval } from './motionScore.ts'
import type { CueEvent, Difficulty } from './hitTargets.ts'

export const SCORING_VERSION = 3

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'results'
export type HitGrade = 'perfect' | 'good' | 'miss'

export interface HitFeedback {
  id: number
  player: number
  grade: HitGrade
  cue: CueEvent
  /** Monotonic display time, independent of paused or ended media. */
  at: number
}
export type ScoredHit = Pick<HitFeedback, 'player' | 'grade' | 'cue'>

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

const newPlayerRound = (): PlayerRound => ({
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  good: 0,
  miss: 0,
  judged: 0,
  nextTarget: 0,
  lastGrade: null,
})

export interface MotionRound extends PlayerRound {
  scoringVersion: typeof SCORING_VERSION
  qualitySum: number
  coverageSum: number
  possibleIntervals: number
  expectedIntervals: number
  lag: number
}

export const newMotionRound = (expectedIntervals = 0): MotionRound => ({
  ...newPlayerRound(),
  scoringVersion: SCORING_VERSION,
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

/** Resolve every due target and retain each player's feedback, including misses. */
export function judgeMotionTargets(round: MotionRound, chart: { frames: MotionFrame[]; intervals: MotionInterval[] }, frames: MotionFrame[], difficulty: Difficulty, time: number, mirrored: boolean | 'auto', player: number) {
  const judgments = []
  const hits: ScoredHit[] = []
  while (round.nextTarget < chart.intervals.length) {
    const interval = chart.intervals[round.nextTarget]
    if (time < motionJudgmentTime(interval, difficulty)) break
    const before = round
    const evidence = evaluateMotionInterval(interval, chart.frames, frames, difficulty, before.lag, mirrored, before.judged > 0)
    round = advanceMotionRound(before, evidence, interval.kind)
    judgments.push({ interval, before, after: round, evidence })
    if (evidence.quality !== null && round.lastGrade && interval.cue) {
      hits.push({ player, grade: round.lastGrade, cue: interval.cue })
    }
  }
  return { round, judgments, hits }
}

const isMotionRound = (player: PlayerRound): player is MotionRound =>
  'scoringVersion' in player && player.scoringVersion === SCORING_VERSION

export const trackingCoverage = (player: PlayerRound) =>
  isMotionRound(player) && (player.expectedIntervals || player.possibleIntervals)
    ? Math.round(player.coverageSum / Math.max(player.expectedIntervals, player.possibleIntervals) * 100) : 0

export const movementResults = (player: PlayerRound) => {
  const total = isMotionRound(player) ? Math.max(player.expectedIntervals, player.possibleIntervals) : player.judged
  return { scored: player.judged, unscored: Math.max(0, total - player.judged), total }
}

export const recordEligible = (player: PlayerRound) =>
  isMotionRound(player) && player.judged > 0 && trackingCoverage(player) >= 70

/** The reference confirms a run only after its video has rewound and started. */
export const isGameRunReady = (referenceRun: number, gameRun: number) =>
  gameRun > 0 && referenceRun === gameRun

export const accuracy = (player: PlayerRound) =>
  player.judged ? Math.round(((isMotionRound(player)
    ? player.qualitySum : player.perfect + player.good * 0.6) / player.judged) * 100) : 0

/** Results must wait for every player, including movements judged after video end. */
export const roundScoringComplete = (ended: boolean, players: MotionRound[]) =>
  ended && players.length > 0 && players.every((player) => player.nextTarget >= player.expectedIntervals)
