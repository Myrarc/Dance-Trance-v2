import type { Difficulty } from '../pose/hitTargets'

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface ArcadeRecord {
  scoringVersion?: 2
  id: string
  videoId: string
  difficulty: Difficulty
  playerSlot: 1 | 2
  bestScore: number
  bestAccuracy: number
  bestGrade: Grade
  maxCombo: number
  playCount: number
  updatedAt: number
}

export interface CloudArcadeRecord {
  scoringVersion?: 2
  videoId: string
  difficulty: Difficulty
  bestScore: number
  bestAccuracy: number
  bestGrade: Grade
  maxCombo: number
  updatedAt: number
}

export interface CompletedRound {
  videoId: string
  difficulty: Difficulty
  playerSlot: 1 | 2
  score: number
  accuracy: number
  maxCombo: number
  completedAt: number
}

export const arcadeRecordId = (videoId: string, difficulty: Difficulty, playerSlot: 1 | 2) =>
  `v2:${videoId}:${difficulty}:${playerSlot}`

export function gradeFromAccuracy(value: number): Grade {
  if (value >= 95) return 'S'
  if (value >= 85) return 'A'
  if (value >= 70) return 'B'
  if (value >= 55) return 'C'
  return 'D'
}

export function recordCompletedRound(existing: ArcadeRecord | null, round: CompletedRound) {
  if (existing?.scoringVersion !== 2) existing = null
  const accuracy = Math.max(0, Math.min(100, round.accuracy))
  const bestAccuracy = Math.max(existing?.bestAccuracy ?? 0, accuracy)
  const record: ArcadeRecord = {
    scoringVersion: 2,
    id: arcadeRecordId(round.videoId, round.difficulty, round.playerSlot),
    videoId: round.videoId,
    difficulty: round.difficulty,
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
    .filter((record) => record.scoringVersion === 2 && record.playerSlot === 1)
    .map(({ videoId, difficulty, bestScore, bestAccuracy, bestGrade, maxCombo, updatedAt }) => ({
      scoringVersion: 2,
      videoId,
      difficulty,
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
  const key = (record: CloudArcadeRecord) => `${record.videoId}:${record.difficulty}`
  const merged = new Map(existing.filter((record) => record.scoringVersion === 2).map((record) => [key(record), record]))
  for (const record of incoming) {
    if (record.scoringVersion !== 2) continue
    const current = merged.get(key(record))
    const bestAccuracy = Math.max(current?.bestAccuracy ?? 0, record.bestAccuracy)
    merged.set(key(record), {
      scoringVersion: 2,
      videoId: record.videoId,
      difficulty: record.difficulty,
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
  const merged = new Map(local.filter((record) => record.scoringVersion === 2).map((record) => [record.id, record]))
  for (const cloud of remote) {
    if (cloud.scoringVersion !== 2) continue
    const id = arcadeRecordId(cloud.videoId, cloud.difficulty, 1)
    const current = merged.get(id)
    const bestAccuracy = Math.max(current?.bestAccuracy ?? 0, cloud.bestAccuracy)
    merged.set(id, {
      scoringVersion: 2,
      id,
      videoId: cloud.videoId,
      difficulty: cloud.difficulty,
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
