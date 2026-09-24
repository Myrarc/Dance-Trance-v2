import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { beatGlowAt, loadBeatMap, manualGlowAt, manualPulseAt, restoreAutomaticBeats, saveBeatMap, songBeatKey, tapTempo, themeBeatKey } from '../src/lib/beatMaps.ts'
import { forget, writeBeatMap } from '../src/lib/library.ts'

test('local beat maps stay attached to their theme or song and can restore automatic timing', async () => {
  const theme = themeBeatKey('theme1')
  const song = songBeatKey('local-song')
  await writeBeatMap(theme, { marks: [{ time: 2, kind: 'accent' }, { time: 1, kind: 'beat' }] })
  await saveBeatMap(song, { bpm: 120, start: 12.4 })
  const oldMap = await loadBeatMap(theme)
  assert.ok(oldMap && 'marks' in oldMap)
  assert.deepEqual(oldMap.marks, [
    { time: 1, kind: 'beat' }, { time: 2, kind: 'accent' },
  ])
  assert.deepEqual(await loadBeatMap(song), { bpm: 120, start: 12.4 })
  await restoreAutomaticBeats(theme)
  assert.equal(await loadBeatMap(theme), null)
  assert.ok(await loadBeatMap(song))
  await forget('local-song')
  assert.equal(await loadBeatMap(song), null, 'forgetting a library song also removes its private timing map')
})

test('BPM lighting starts at the chosen beat and stays aligned through seeks and loops', async () => {
  const map = { bpm: 120, start: 1.25 }
  assert.equal(beatGlowAt(map, 1.24), null)
  assert.equal(beatGlowAt(map, 1.25)?.pulse, 1)
  assert.equal(beatGlowAt(map, 1.75)?.mark.time, 1.75)
  assert.equal(beatGlowAt(map, 2.25)?.mark.time, 2.25)
  assert.equal(beatGlowAt(map, 2.1), null, 'the light fades between beats')
  assert.equal(beatGlowAt(map, 1.24), null, 'seeking before the first beat clears the pulse')
  await assert.rejects(saveBeatMap(songBeatKey('invalid'), { bpm: 0, start: 0 }))
})

test('tap tempo averages recent beats, ignores accidental double taps, and restarts after a pause', () => {
  let sample = tapTempo([], 1000)
  assert.equal(sample.bpm, null)
  sample = tapTempo(sample.taps, 1500)
  assert.equal(sample.bpm, 120)
  sample = tapTempo(sample.taps, 1550)
  assert.deepEqual(sample.taps, [1000, 1500])
  sample = tapTempo(sample.taps, 2010)
  assert.equal(sample.bpm, 119)
  sample = tapTempo(sample.taps, 5000)
  assert.equal(sample.bpm, null)
  assert.deepEqual(sample.taps, [5000])
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
