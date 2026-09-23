import assert from 'node:assert/strict'
import test from 'node:test'
import {
  gradeFromAccuracy,
  mergeCloudRecordSets,
  mergeCloudRecords,
  recordCompletedRound,
  recordsForCloud,
  type ArcadeRecord,
} from '../src/game/records.ts'

test('grades use the published accuracy boundaries', () => {
  assert.equal(gradeFromAccuracy(100), 'S')
  assert.equal(gradeFromAccuracy(95), 'S')
  assert.equal(gradeFromAccuracy(94.99), 'A')
  assert.equal(gradeFromAccuracy(85), 'A')
  assert.equal(gradeFromAccuracy(70), 'B')
  assert.equal(gradeFromAccuracy(55), 'C')
  assert.equal(gradeFromAccuracy(54.99), 'D')
})

test('new scoring bests use a fresh key and ignore legacy cloud scores', () => {
  const legacy = {
    videoId: 'song', difficulty: 'easy' as const, bestScore: 90000,
    bestAccuracy: 99, bestGrade: 'S' as const, maxCombo: 90, updatedAt: 1,
  }
  const next = recordCompletedRound(null, {
    videoId: 'song', difficulty: 'easy', playerSlot: 1,
    score: 800, accuracy: 80, maxCombo: 1, completedAt: 2,
  }).record
  assert.equal(next.id, 'v2:song:easy:1')
  assert.equal(next.scoringVersion, 2)
  assert.deepEqual(mergeCloudRecords([], [legacy]), [])
  assert.deepEqual(mergeCloudRecordSets([legacy], recordsForCloud([next])), recordsForCloud([next]))
})

test('cloud-to-cloud merge is idempotent and keeps the newest timestamp', () => {
  const older = {
    scoringVersion: 2 as const,
    videoId: 'song', difficulty: 'easy' as const, bestScore: 700,
    bestAccuracy: 92, bestGrade: 'A' as const, maxCombo: 6, updatedAt: 100,
  }
  const newer = {
    scoringVersion: 2 as const,
    videoId: 'song', difficulty: 'easy' as const, bestScore: 800,
    bestAccuracy: 80, bestGrade: 'B' as const, maxCombo: 9, updatedAt: 200,
  }
  assert.deepEqual(mergeCloudRecordSets([older], [newer]), [{
    scoringVersion: 2,
    videoId: 'song', difficulty: 'easy', bestScore: 800,
    bestAccuracy: 92, bestGrade: 'A', maxCombo: 9, updatedAt: 200,
  }])
})

test('a completed round keeps independent bests and reports a score record', () => {
  const first = recordCompletedRound(null, {
    videoId: 'song', difficulty: 'normal', playerSlot: 1,
    score: 1200, accuracy: 84, maxCombo: 8, completedAt: 100,
  })
  assert.equal(first.isNewBest, true)
  assert.equal(first.record.bestGrade, 'B')
  assert.equal(first.record.playCount, 1)

  const second = recordCompletedRound(first.record, {
    videoId: 'song', difficulty: 'normal', playerSlot: 1,
    score: 1100, accuracy: 96, maxCombo: 12, completedAt: 200,
  })
  assert.equal(second.isNewBest, false)
  assert.equal(second.record.bestScore, 1200)
  assert.equal(second.record.bestAccuracy, 96)
  assert.equal(second.record.bestGrade, 'S')
  assert.equal(second.record.maxCombo, 12)
  assert.equal(second.record.playCount, 2)
})

test('only player one records are prepared for cloud sync', () => {
  const base: ArcadeRecord = {
    scoringVersion: 2,
    id: 'v2:song:normal:1', videoId: 'song', difficulty: 'normal', playerSlot: 1,
    bestScore: 100, bestAccuracy: 80, bestGrade: 'B', maxCombo: 4,
    playCount: 2, updatedAt: 50,
  }
  const cloud = recordsForCloud([base, { ...base, id: 'v2:song:normal:2', playerSlot: 2 }])
  assert.deepEqual(cloud, [{
    scoringVersion: 2,
    videoId: 'song', difficulty: 'normal', bestScore: 100,
    bestAccuracy: 80, bestGrade: 'B', maxCombo: 4, updatedAt: 50,
  }])
})

test('cloud merge takes independent maxima without inflating local play count', () => {
  const local: ArcadeRecord = {
    scoringVersion: 2,
    id: 'v2:song:hard:1', videoId: 'song', difficulty: 'hard', playerSlot: 1,
    bestScore: 900, bestAccuracy: 88, bestGrade: 'A', maxCombo: 7,
    playCount: 3, updatedAt: 100,
  }
  const [merged] = mergeCloudRecords([local], [{
    scoringVersion: 2,
    videoId: 'song', difficulty: 'hard', bestScore: 1000,
    bestAccuracy: 82, bestGrade: 'B', maxCombo: 10, updatedAt: 200,
  }])
  assert.equal(merged.bestScore, 1000)
  assert.equal(merged.bestAccuracy, 88)
  assert.equal(merged.bestGrade, 'A')
  assert.equal(merged.maxCombo, 10)
  assert.equal(merged.playCount, 3)
  assert.equal(merged.updatedAt, 200)
})
