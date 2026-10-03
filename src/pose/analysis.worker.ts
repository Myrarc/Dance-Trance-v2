/// <reference lib="webworker" />

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import { createPoseLandmarker } from './landmarker'
import { shouldInferFrame } from './adaptiveSampling'
import { frameTimestampMs } from './frameMeter'
import { analyseRhythm } from './rhythm'

const SAMPLE_FPS = 15
const VALUES_PER_LANDMARK = 6
const LANDMARK_COUNT = 33
const STRIDE = LANDMARK_COUNT * VALUES_PER_LANDMARK
const MAX_INPUT_WIDTH = 640
const MOTION_WIDTH = 32
const MOTION_HEIGHT = 18
const MOTION_THRESHOLD = 12

interface StartMessage {
  blob: Blob
}

const worker = self as unknown as DedicatedWorkerGlobalScope

function motionScore(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  previous: Uint8ClampedArray | null,
) {
  ctx.drawImage(source, 0, 0, MOTION_WIDTH, MOTION_HEIGHT)
  const pixels = ctx.getImageData(0, 0, MOTION_WIDTH, MOTION_HEIGHT).data
  const luma = new Uint8ClampedArray(MOTION_WIDTH * MOTION_HEIGHT)
  let difference = 0
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    luma[p] = (pixels[i] * 3 + pixels[i + 1] * 6 + pixels[i + 2]) / 10
    if (previous) difference += Math.abs(luma[p] - previous[p])
  }
  return { luma, score: previous ? difference / luma.length : 0 }
}

function fillCalmFrames(data: Float32Array, inferred: boolean[]) {
  const started = performance.now()
  for (let frame = 1; frame < inferred.length - 1; frame++) {
    if (inferred[frame]) continue
    const previous = frame - 1
    const next = frame + 1
    if (!inferred[previous] || !inferred[next]) continue
    const a = previous * STRIDE
    const b = next * STRIDE
    if (Number.isNaN(data[a]) || Number.isNaN(data[b])) continue
    const out = frame * STRIDE
    for (let value = 0; value < STRIDE; value++) {
      data[out + value] = (data[a + value] + data[b + value]) / 2
    }
  }
  return performance.now() - started
}

worker.onmessage = async (event: MessageEvent<StartMessage>) => {
  const started = performance.now()
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(event.data.blob) })
  let landmarker: Awaited<ReturnType<typeof createPoseLandmarker>> | null = null

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) throw new Error('Video codec is not available through WebCodecs')
    const [duration, sourceWidth] = await Promise.all([track.computeDuration(), track.getDisplayWidth()])
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video has no readable duration')

    const width = Math.max(1, Math.min(MAX_INPUT_WIDTH, sourceWidth))
    const sink = new CanvasSink(track, {
      width,
      poolSize: 2,
      decoderOptions: { hardwareAcceleration: 'prefer-hardware' },
    })
    const frames = Math.max(1, Math.ceil(duration * SAMPLE_FPS))
    const timestamps = Array.from({ length: frames }, (_, index) =>
      Math.min(duration - 1e-3, index / SAMPLE_FPS),
    )
    const data = new Float32Array(frames * STRIDE).fill(NaN)
    const inferred = new Array<boolean>(frames).fill(false)
    const motionCanvas = new OffscreenCanvas(MOTION_WIDTH, MOTION_HEIGHT)
    const motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true })!
    let previousLuma: Uint8ClampedArray | null = null
    const setupMs = performance.now() - started
    let modelMs = 0
    let decodeMs = 0
    let inferenceMs = 0
    let decodedFrames = 0
    let inferredFrames = 0
    const modelStarted = performance.now()
    landmarker = await createPoseLandmarker(1, 'full', { wasmLoaderPath, wasmBinaryPath })
    modelMs = performance.now() - modelStarted
    let frame = 0
    let decodeStarted = performance.now()
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      decodeMs += performance.now() - decodeStarted
      if (!wrapped) {
        frame++
        decodeStarted = performance.now()
        continue
      }
      decodedFrames++
      const motion = motionScore(motionCtx, wrapped.canvas, previousLuma)
      previousLuma = motion.luma
      // Two of every three frames gives 10 FPS. High-motion frames retain the
      // full 15 FPS; only deliberately skipped calm frames are interpolated.
      if (shouldInferFrame(frame, motion.score, MOTION_THRESHOLD)) {
        inferred[frame] = true
        inferredFrames++
        const inferenceStarted = performance.now()
        const result = landmarker.detectForVideo(
          wrapped.canvas,
          frameTimestampMs(timestamps[frame], frame + 1),
        )
        inferenceMs += performance.now() - inferenceStarted
        const landmarks = result.landmarks[0]
        const world = result.worldLandmarks[0]
        if (landmarks && world) {
          const base = frame * STRIDE
          for (let landmark = 0; landmark < LANDMARK_COUNT; landmark++) {
            const offset = base + landmark * VALUES_PER_LANDMARK
            data[offset] = landmarks[landmark].x
            data[offset + 1] = landmarks[landmark].y
            data[offset + 2] = landmarks[landmark].visibility ?? 1
            data[offset + 3] = world[landmark].x
            data[offset + 4] = world[landmark].y
            data[offset + 5] = world[landmark].z
          }
        }
      }
      if (frame % 8 === 0) {
        worker.postMessage({ type: 'progress', fraction: frame / frames })
      }
      frame++
      decodeStarted = performance.now()
    }

    const packMs = fillCalmFrames(data, inferred)
    const rhythm = await analyseRhythm(input).catch(() => null)
    const totalMs = performance.now() - started
    const metrics = {
      method: 'WebCodecs worker',
      totalMs,
      setupMs,
      modelMs,
      decodeMs,
      inferenceMs,
      packMs,
      decodedFrames,
      inferredFrames,
      inputWidth: width,
      model: 'GPU preferred',
    }
    worker.postMessage({
      type: 'complete',
      fps: SAMPLE_FPS,
      frames,
      buffer: data.buffer,
      bpm: rhythm?.bpm,
      beatConfidence: rhythm?.confidence,
      beats: rhythm?.beats.buffer,
      metrics,
    }, rhythm ? [data.buffer, rhythm.beats.buffer] : [data.buffer])
  } catch (error) {
    worker.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    landmarker?.close()
    input.dispose()
  }
}
