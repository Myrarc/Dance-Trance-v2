import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { evaluateMotionInterval } from '../src/pose/motionScore.ts'
import { advanceMotionRound, SCORING_VERSION } from '../src/pose/gameplay.ts'
import { decodeRecording, encodeRecording } from '../src/lib/scoringRecorder.ts'

const path = process.argv[2]
if (!path) throw new Error('Usage: node scripts/replay-scoring.mjs <recording.ndjson>')
let header
let checked = 0
let differences = 0
let ended = false
let expectedSequence = 0
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!line.trim()) continue
  const event = decodeRecording(line)
  if (event.sequence !== expectedSequence++) throw new Error('Missing or reordered recording events')
  if (event.type === 'header') {
    header = event.data
    if (header.scoringVersion !== undefined && header.scoringVersion !== SCORING_VERSION) {
      throw new Error(`Recording uses scoring v${header.scoringVersion}; this replay uses v${SCORING_VERSION}. Keep the original recording for comparison.`)
    }
  }
  if (event.type === 'end') ended = true
  if (event.type !== 'judgment') continue
  if (!header?.reference?.frames) throw new Error('Reference poses missing')
  const { interval, input, before, evidence, after } = event.data
  const actual = evaluateMotionInterval(interval, header.reference.frames, input.player, input.difficulty, input.previousLag, input.mirrored, input.lagLocked)
  const result = advanceMotionRound(before, actual, interval.kind)
  checked++
  if (encodeRecording(actual) !== encodeRecording(evidence) || encodeRecording(result) !== encodeRecording(after)) {
    differences++
    console.log(JSON.stringify({ player: event.data.player, interval, recorded: evidence, replayed: actual }))
  }
}
console.log(JSON.stringify({ checked, differences, completedCapture: ended, scorer: header?.scorer }))
if (!ended) console.warn('Capture was interrupted; only persisted events were replayed.')
if (differences || !checked) process.exitCode = 1
