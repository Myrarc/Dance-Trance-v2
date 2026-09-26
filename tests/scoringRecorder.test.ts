import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { armRecorder, beginRecording, captureScoring, finishRecording, listRecordings, exportRecording, deleteRecording, recorderSnapshot, encodeRecording, decodeRecording } from '../src/lib/scoringRecorder.ts'
import { evaluateMotionInterval } from '../src/pose/motionScore.ts'
import { advanceMotionRound, newMotionRound } from '../src/pose/gameplay.ts'

 test('opt-in capture preserves raw evidence and reproduces judgments across pause, then isolates the next round', async () => {
  beginRecording('off', {})
  assert.equal((await listRecordings()).length, 0)
  const frames = Array.from({ length: 31 }, (_, i) => ({ t: i / 15, feature: { lUpperArm: { x: Math.sin(i / 20), y: Math.cos(i / 20), z: 0 } } }))
  const interval = { start: 0.5, end: 1, kind: 'move' as const, keys: ['lUpperArm'] }
  armRecorder(true)
  beginRecording('test song', { reference: { frames } })
  const raw = { data: new Float32Array([1, NaN]), absent: null }
  captureScoring('frame', raw)
  raw.data[0] = 999
  captureScoring('phase', { phase: 'paused' })
  captureScoring('phase', { phase: 'playing' })
  const input = { player: frames, difficulty: 'normal' as const, previousLag: 0, mirrored: false, lagLocked: false }
  const before = newMotionRound(1)
  const evidence = evaluateMotionInterval(interval, frames, frames, 'normal')
  const after = advanceMotionRound(before, evidence, 'move')
  captureScoring('judgment', { interval, input, before, evidence, after })
  finishRecording('completed', [after])
  const [info] = await listRecordings()
  const exported = await (await exportRecording(info)).text()
  const events = exported.trim().split('\n').map(decodeRecording)
  assert.deepEqual(events.map((e) => e.type), ['header', 'frame', 'phase', 'phase', 'judgment', 'end'])
  assert.deepEqual(events.map((e) => e.sequence), [0, 1, 2, 3, 4, 5])
  assert.equal(events[1].data.data[0], 1)
  assert.ok(Number.isNaN(events[1].data.data[1]))
  const saved = events[4].data
  const replay = evaluateMotionInterval(saved.interval, events[0].data.reference.frames, saved.input.player, saved.input.difficulty)
  assert.deepEqual(replay, saved.evidence)
  assert.deepEqual(advanceMotionRound(saved.before, replay, 'move'), saved.after)
  const folder = mkdtempSync(join(tmpdir(), 'dance-recorder-test-'))
  try {
    const path = join(folder, 'recording.ndjson')
    writeFileSync(path, exported)
    const output = execFileSync(process.execPath, ['scripts/replay-scoring.mjs', path], { encoding: 'utf8' })
    assert.equal(JSON.parse(output).differences, 0)
    assert.equal(JSON.parse(output).checked, 1)
  } finally { rmSync(folder, { recursive: true, force: true }) }
  beginRecording('not armed again', {})
  assert.equal(recorderSnapshot().active, false)
  armRecorder(true)
  beginRecording('second', {})
  armRecorder(false)
  assert.equal((await listRecordings()).length, 2)
  for (const item of await listRecordings()) await deleteRecording(item.id)
  assert.equal((await listRecordings()).length, 0)
})

test('non-finite missing pose values survive export without becoming measured zeros', () => {
  assert.deepEqual(decodeRecording(encodeRecording([NaN, Infinity, -Infinity, null, 0])), [NaN, Infinity, -Infinity, null, 0])
})

test('storage failure stops capture visibly and retains previously committed chunks', async () => {
  armRecorder(true)
  beginRecording('storage failure', {})
  const [info] = await listRecordings()
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function () { throw new Error('Quota exceeded') }
  try {
    finishRecording('completed')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(recorderSnapshot().active, false)
    assert.match(recorderSnapshot().message, /Quota exceeded/)
  } finally { IDBDatabase.prototype.transaction = original }
  const events = (await (await exportRecording(info)).text()).trim().split('\n').map(decodeRecording)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'header')
  await deleteRecording(info.id)
})
