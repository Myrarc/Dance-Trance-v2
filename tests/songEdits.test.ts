import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { loadSongEdit, saveSongDraft, saveSongEdit, validateSongEdit, visualCues, withinTrim, type SongEdit } from '../src/lib/songEdits.ts'
import { forget } from '../src/lib/library.ts'
import { loadBeatMap, songBeatKey } from '../src/lib/beatMaps.ts'

const edit: SongEdit = { version: 1, duration: 60, start: 10, end: 40, lighting: { marks: [{ time: 12, kind: 'burst' }] }, charts: {
  normal: [{ id: 'a', time: 12, kind: 'hold', joint: 'leftHand', duration: 1, x: 0.3, y: 0.4 },
    { id: 'b', time: 15, kind: 'spot', joint: 'rightFoot', duration: 0, x: 0.6, y: 0.8 }],
} }
test('drafts stay private until an atomic save publishes cues and lights, and forget clears both', async () => {
  await saveSongDraft('editor-test', edit)
  assert.equal(await loadSongEdit('editor-test'), null)
  assert.deepEqual(await loadSongEdit('editor-test', true), edit)
  await saveSongEdit('editor-test', edit)
  assert.deepEqual(await loadSongEdit('editor-test'), edit)
  assert.equal(await loadSongEdit('editor-test', true), null)
  assert.deepEqual(await loadBeatMap(songBeatKey('editor-test')), edit.lighting)
  await forget('editor-test')
  assert.equal(await loadSongEdit('editor-test'), null)
  assert.equal(await loadSongEdit('editor-test', true), null)
})
test('visual edits respect focus and original timestamps, with an empty chart deliberately hiding cues', () => {
  const all = visualCues(edit, [], 'normal', 'full', true)
  assert.equal(all.length, 2)
  assert.equal(all[0].time, 12)
  assert.equal(visualCues(edit, [], 'normal', 'upper', true).length, 1)
  assert.equal(visualCues(edit, [], 'normal', 'lower', true)[0].time, 15)
  assert.deepEqual(visualCues({ ...edit, charts: { easy: [] } }, all, 'easy', 'full', true), [])
  assert.deepEqual(visualCues(edit, all, 'hard', 'full', true), all)
})
test('trimming excludes outside scoring intervals without changing their evidence or timestamps', () => {
  const intervals = [{ start: 9.5, end: 10 }, { start: 10, end: 10.5 }, { start: 40, end: 40.5 }]
  assert.deepEqual(withinTrim(intervals, edit), [intervals[1]])
  assert.equal(withinTrim(intervals, edit)[0], intervals[1])
  assert.throws(() => validateSongEdit({ ...edit, end: 9 }))
  assert.throws(() => validateSongEdit({ ...edit, charts: { normal: [{ ...edit.charts.normal![0], time: 60 }] } }))
})
