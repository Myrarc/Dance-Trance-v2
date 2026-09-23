import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { loadBeatMap, manualGlowAt, manualPulseAt, restoreAutomaticBeats, saveBeatMap, songBeatKey, themeBeatKey } from '../src/lib/beatMaps.ts'
import { forget } from '../src/lib/library.ts'

test('local beat maps stay attached to their theme or song and can restore automatic timing', async () => {
  const theme = themeBeatKey('theme1')
  const song = songBeatKey('local-song')
  await saveBeatMap(theme, [{ time: 2, kind: 'accent' }, { time: 1, kind: 'beat' }])
  await saveBeatMap(song, [{ time: 12.4, kind: 'beat' }, { time: 13, kind: 'burst' }])
  assert.deepEqual((await loadBeatMap(theme))?.marks, [
    { time: 1, kind: 'beat' }, { time: 2, kind: 'accent' },
  ])
  assert.deepEqual((await loadBeatMap(song))?.marks, [{ time: 12.4, kind: 'beat' }, { time: 13, kind: 'burst' }])
  await restoreAutomaticBeats(theme)
  assert.equal(await loadBeatMap(theme), null)
  assert.ok(await loadBeatMap(song))
  await forget('local-song')
  assert.equal(await loadBeatMap(song), null, 'forgetting a library song also removes its private timing map')
})

test('manual pulses follow playback time and the gold burst is stronger than an accent', () => {
  const marks = [{ time: 1, kind: 'beat' as const }, { time: 2, kind: 'accent' as const }, { time: 3, kind: 'burst' as const }]
  assert.equal(manualPulseAt(marks, .9), 0)
  assert.equal(manualPulseAt(marks, 1), .65)
  assert.equal(manualPulseAt(marks, 2), 1)
  assert.equal(manualPulseAt(marks, 3), 1.45)
  assert.equal(manualGlowAt(marks, 3.1)?.mark.kind, 'burst')
  assert.equal(manualGlowAt(marks, 3.5), null)
  assert.equal(manualPulseAt(marks, 2.5), 0)
  assert.equal(manualPulseAt(marks, .9), 0, 'looping before the first mark cannot retain the prior pulse')
  assert.equal(manualPulseAt(marks, 1), .65)
})
