import assert from 'node:assert/strict'
import test from 'node:test'
import { FrameMeter, frameTimestampMs } from '../src/pose/frameMeter.ts'

test('counts camera frames skipped while pose inference was busy', () => {
  const meter = new FrameMeter()

  meter.record(1, 0)
  meter.record(2, 250)
  meter.record(5, 500)
  meter.recordInference(34)
  meter.recordInference(47)

  assert.deepEqual(meter.snapshot(1000), {
    cameraFps: 4,
    trackingFps: 2,
    droppedFrames: 2,
    inferenceP95Ms: 47,
  })
})

test('uses video media time for monotonically meaningful inference timestamps', () => {
  assert.equal(frameTimestampMs(1.25, 9000), 1250)
  assert.equal(frameTimestampMs(Number.NaN, 9000), 9000)
})
