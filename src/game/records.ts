import type { Difficulty } from '../pose/hitTargets'
import type { Focus } from '../pose/angles'
import { SCORING_VERSION } from '../pose/gameplay.ts'
export { SCORING_VERSION } from '../pose/gameplay.ts'

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface ArcadeRecord {
  scoringVersion?: 2 | 3
  id: string
  videoId: string
  difficulty: Difficulty
  focus?: Focus
  trackHead?: boolean
  playerSlot: 1 | 2
  bestScore: number
  bestAccuracy: number
  bestGrade: Grade
  maxCombo: number
  playCount: number
  updatedAt: number
}

export interface CloudArcadeRecord {
  scoringVersion?: 2 | 3
  videoId: string
  difficulty: Difficulty
  focus?: Focus
  trackHead?: boolean
  bestScore: number
  bestAccuracy: number
  bestGrade: Grade
  maxCombo: number
  updatedAt: number
}

export interface CompletedRound {
  videoId: string
  difficulty: Difficulty
  focus: Focus
  trackHead: boolean
  playerSlot: 1 | 2
  score: number
  accuracy: number
  maxCombo: number
  completedAt: number
}

export const arcadeRecordId = (videoId: string, difficulty: Difficulty, playerSlot: 1 | 2, focus: Focus, trackHead: boolean) =>
  `v${SCORING_VERSION}:${videoId}:${difficulty}:${focus}:${trackHead ? 'head' : 'body'}:${playerSlot}`

/** Older bests have an unknown scoring configuration; preserve them without comparing. */
export function hasScoringConfig(record: { focus?: Focus; trackHead?: boolean }): record is { focus: Focus; trackHead: boolean } {
  return ['full', 'upper', 'lower'].includes(record.focus ?? '') && typeof record.trackHead === 'boolean'
}

export function gradeFromAccuracy(value: number): Grade {
  if (value >= 95) return 'S'
  if (value >= 85) return 'A'
  if (value >= 70) return 'B'
  if (value >= 55) return 'C'
  return 'D'
}

export function recordCompletedRound(existing: ArcadeRecord | null, round: CompletedRound) {
  const id = arcadeRecordId(round.videoId, round.difficulty, round.playerSlot, round.focus, round.trackHead)
  if (existing?.scoringVersion !== SCORING_VERSION || existing.id !== id || !hasScoringConfig(existing)) existing = null
  const accuracy = Math.max(0, Math.min(100, round.accuracy))
  const bestAccuracy = Math.max(existing?.bestAccuracy ?? 0, accuracy)
  const record: ArcadeRecord = {
    scoringVersion: SCORING_VERSION,
    id,
    videoId: round.videoId,
    difficulty: round.difficulty,
    focus: round.focus,
    trackHead: round.trackHead,
    playerSlot: round.playerSlot,
    bestScore: Math.max(existing?.bestScore ?? 0, round.score),
    bestAccuracy,
    bestGrade: gradeFromAccuracy(bestAccuracy),
    maxCombo: Math.max(existing?.maxCombo ?? 0, round.maxCombo),
    playCount: (existing?.playCount ?? 0) + 1,
    updatedAt: round.completedAt,
  }
  return { record, isNewBest: existing === null || round.score > existing.bestScore }
}

export function recordsForCloud(records: ArcadeRecord[]): CloudArcadeRecord[] {
  return records
    .filter((record) => record.scoringVersion === SCORING_VERSION && record.playerSlot === 1 && hasScoringConfig(record))
    .map(({ videoId, difficulty, focus, trackHead, bestScore, bestAccuracy, bestGrade, maxCombo, updatedAt }) => ({
      scoringVersion: SCORING_VERSION,
      videoId,
      difficulty,
      focus,
      trackHead,
      bestScore,
      bestAccuracy,
      bestGrade,
      maxCombo,
      updatedAt,
    }))
}

export function mergeCloudRecordSets(
  existing: CloudArcadeRecord[],
  incoming: CloudArcadeRecord[],
): CloudArcadeRecord[] {
  const key = (record: CloudArcadeRecord) => `${record.scoringVersion ?? 'legacy'}:${record.videoId}:${record.difficulty}:${record.focus ?? 'legacy'}:${record.trackHead ?? 'legacy'}`
  const merged = new Map(existing.map((record) => [key(record), record]))
  for (const record of incoming) {
    if (record.scoringVersion !== SCORING_VERSION || !hasScoringConfig(record)) continue
    const current = merged.get(key(record))
    const bestAccuracy = Math.max(current?.bestAccuracy ?? 0, record.bestAccuracy)
    merged.set(key(record), {
      scoringVersion: SCORING_VERSION,
      videoId: record.videoId,
      difficulty: record.difficulty,
      focus: record.focus,
      trackHead: record.trackHead,
      bestScore: Math.max(current?.bestScore ?? 0, record.bestScore),
      bestAccuracy,
      bestGrade: gradeFromAccuracy(bestAccuracy),
      maxCombo: Math.max(current?.maxCombo ?? 0, record.maxCombo),
      updatedAt: Math.max(current?.updatedAt ?? 0, record.updatedAt),
    })
  }
  return [...merged.values()]
}

export function mergeCloudRecords(local: ArcadeRecord[], remote: CloudArcadeRecord[]): ArcadeRecord[] {
  const merged = new Map(local.map((record) => [record.id, record]))
  for (const cloud of remote) {
    if (cloud.scoringVersion !== SCORING_VERSION || !hasScoringConfig(cloud)) continue
    const id = arcadeRecordId(cloud.videoId, cloud.difficulty, 1, cloud.focus, cloud.trackHead)
    const current = merged.get(id)
    const bestAccuracy = Math.max(current?.bestAccuracy ?? 0, cloud.bestAccuracy)
    merged.set(id, {
      scoringVersion: SCORING_VERSION,
      id,
      videoId: cloud.videoId,
      difficulty: cloud.difficulty,
      focus: cloud.focus,
      trackHead: cloud.trackHead,
      playerSlot: 1,
      bestScore: Math.max(current?.bestScore ?? 0, cloud.bestScore),
      bestAccuracy,
      bestGrade: gradeFromAccuracy(bestAccuracy),
      maxCombo: Math.max(current?.maxCombo ?? 0, cloud.maxCombo),
      playCount: current?.playCount ?? 0,
      updatedAt: Math.max(current?.updatedAt ?? 0, cloud.updatedAt),
    })
  }
  return [...merged.values()]
}
