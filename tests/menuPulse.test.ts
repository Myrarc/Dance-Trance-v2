import test from 'node:test'
import assert from 'node:assert/strict'
import { beatPulseAt } from '../src/lib/menuPulse.ts'

test('visual beat accent follows playback time through pauses, seeks, and loops', () => {
  const beats = new Float32Array([0.5, 1, 1.5])
  assert.equal(beatPulseAt(beats, 0.4), 0)
  assert.equal(beatPulseAt(beats, 1), 1)
  assert.ok(beatPulseAt(beats, 1.17) > 0)
  assert.equal(beatPulseAt(beats, 1.4), 0)
  assert.equal(beatPulseAt(beats, 0.5), 1)
})
