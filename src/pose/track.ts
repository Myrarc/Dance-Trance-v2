import { createPoseLandmarker } from './landmarker'
import type { Landmark3 } from './angles'
import { applyPoseCorrections, type PoseCorrection } from './poseCorrections'

/**
 * A pose track: the reference dancer's skeleton for a whole video, worked out
 * once and stored.
 *
 * Playback currently runs the pose model on the reference every frame, which is
 * half the compute in the app and the reason a phone cannot keep up. The
 * reference never changes, so paying for it repeatedly is waste. Analysing once
 * also lifts a constraint: nothing here is realtime, so the work can be slower
 * and steadier than live detection is allowed to be.
 */

const SAMPLE_FPS = 15
const TRACK_VERSION = 4
const MAX_INPUT_WIDTH = 640
/** x, y, visibility for the drawn skeleton; x, y, z for the maths. */
const VALUES_PER_LANDMARK = 6
const LANDMARK_COUNT = 33
const STRIDE = LANDMARK_COUNT * VALUES_PER_LANDMARK

export interface PoseTrack {
  fps: number
  frames: number
  /** Packed, `frames * STRIDE` long. NaN marks a frame with no dancer. */
  data: Float32Array
  bpm?: number
  beatConfidence?: number
  beats?: Float32Array
  /** False only for pre-BPM stored tracks that need one upgrade analysis. */
  rhythmAnalysed?: boolean
}

export interface TrackFrame {
  /** Normalised image coordinates, for drawing. */
  landmarks: { x: number; y: number; z: number; visibility: number }[]
  /** Metric 3D, for the comparison. */
  world: Landmark3[]
}

export interface AnalysisMetrics {
  method: string
  totalMs: number
  setupMs: number
  modelMs: number
  decodeMs: number
  inferenceMs: number
  packMs: number
  decodedFrames: number
  inferredFrames: number
  inputWidth: number
  model: string
}

/**
 * Walks the video and records the dancer.
 *
 * Seeking frame by frame is accurate but slow; playing the video and taking
 * whatever frames arrive is fast but skips. This plays at speed and samples on
 * a fixed grid of video time, which keeps the spacing predictable without
 * paying for thousands of seeks.
 */
export async function analyseVideo(
  blob: Blob,
  onProgress: (fraction: number) => void,
  shouldStop: () => boolean = () => false,
  onMetrics?: (metrics: AnalysisMetrics) => void,
  onFallback?: (reason: string) => void,
): Promise<PoseTrack | null> {
  if (typeof Worker !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      return await analyseVideoInWorker(blob, onProgress, shouldStop, onMetrics)
    } catch (error) {
      console.warn('WebCodecs analysis failed; using video seek fallback', error)
      onFallback?.(error instanceof Error ? error.message : String(error))
    }
  }
  return analyseVideoLegacy(blob, onProgress, shouldStop, onMetrics)
}

function analyseVideoInWorker(
  blob: Blob,
  onProgress: (fraction: number) => void,
  shouldStop: () => boolean,
  onMetrics?: (metrics: AnalysisMetrics) => void,
): Promise<PoseTrack | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    const cancel = window.setInterval(() => {
      if (!shouldStop()) return
      clearInterval(cancel)
      worker.terminate()
      resolve(null)
    }, 100)
    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'progress') onProgress(message.fraction)
      if (message.type === 'error') {
        clearInterval(cancel)
        worker.terminate()
        reject(new Error(message.message))
      }
      if (message.type === 'complete') {
        clearInterval(cancel)
        worker.terminate()
        onProgress(1)
        onMetrics?.(message.metrics)
        resolve({
          fps: message.fps,
          frames: message.frames,
          data: new Float32Array(message.buffer),
          bpm: message.bpm,
          beatConfidence: message.beatConfidence,
          beats: message.beats ? new Float32Array(message.beats) : undefined,
          rhythmAnalysed: true,
        })
      }
    }
    worker.onerror = (event) => {
      clearInterval(cancel)
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage({ blob })
  })
}

async function analyseVideoLegacy(
  blob: Blob,
  onProgress: (fraction: number) => void,
  shouldStop: () => boolean,
  onMetrics?: (metrics: AnalysisMetrics) => void,
): Promise<PoseTrack | null> {
  const started = performance.now()
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true

  const modelStarted = performance.now()
  const landmarker = await createPoseLandmarker(1)
  const modelMs = performance.now() - modelStarted
  const canvas = document.createElement('canvas')

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('cannot decode'))
    })
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0) return null

    const frames = Math.max(1, Math.ceil(duration * SAMPLE_FPS))
    const data = new Float32Array(frames * STRIDE).fill(NaN)
    const scale = Math.min(1, MAX_INPUT_WIDTH / video.videoWidth)
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')!

    let stamp = 0
    let decodeMs = 0
    let inferenceMs = 0
    for (let i = 0; i < frames; i++) {
      if (shouldStop()) return null
      const t = Math.min(duration - 1e-3, i / SAMPLE_FPS)
      const decodeStarted = performance.now()
      await seek(video, t)
      // Through a 2D canvas: a freshly seeked video can upload as an empty
      // frame to WebGL, which would silently record nothing.
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      decodeMs += performance.now() - decodeStarted
      const inferenceStarted = performance.now()
      const res = landmarker.detectForVideo(canvas, ++stamp)
      inferenceMs += performance.now() - inferenceStarted
      const lm = res.landmarks[0]
      const world = res.worldLandmarks[0]
      if (lm && world) {
        const base = i * STRIDE
        for (let k = 0; k < LANDMARK_COUNT; k++) {
          const o = base + k * VALUES_PER_LANDMARK
          data[o] = lm[k].x
          data[o + 1] = lm[k].y
          data[o + 2] = lm[k].visibility ?? 1
          data[o + 3] = world[k].x
          data[o + 4] = world[k].y
          data[o + 5] = world[k].z
        }
      }
      if (i % 8 === 0) {
        onProgress(i / frames)
        // Yield, or the page freezes for the whole analysis.
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    onProgress(1)
    const totalMs = performance.now() - started
    onMetrics?.({
      method: 'Video seek fallback',
      totalMs,
      setupMs: Math.max(0, totalMs - modelMs - decodeMs - inferenceMs),
      modelMs,
      decodeMs,
      inferenceMs,
      packMs: 0,
      decodedFrames: frames,
      inferredFrames: frames,
      inputWidth: canvas.width,
      model: 'gpu-or-cpu fallback',
    })
    const [{ ALL_FORMATS, BlobSource, Input }, { analyseRhythm }] = await Promise.all([
      import('mediabunny'),
      import('./rhythm'),
    ])
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
    const rhythm = await analyseRhythm(input).catch(() => null)
    input.dispose()
    return {
      fps: SAMPLE_FPS,
      frames,
      data,
      bpm: rhythm?.bpm,
      beatConfidence: rhythm?.confidence,
      beats: rhythm?.beats,
      rhythmAnalysed: true,
    }
  } finally {
    landmarker.close()
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
  }
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const frameVideo = video as unknown as {
      requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback']
      cancelVideoFrameCallback?: HTMLVideoElement['cancelVideoFrameCallback']
    }
    let done = false
    let timer = 0
    let frameCallback = 0
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeEventListener('seeked', paintedFallback)
      video.removeEventListener('loadeddata', finish)
      if (frameCallback) frameVideo.cancelVideoFrameCallback?.call(video, frameCallback)
      resolve()
    }

    const paintedFallback = () => requestAnimationFrame(() => requestAnimationFrame(finish))
    // Corrupt media must not stall the entire import.
    timer = window.setTimeout(finish, 1000)

    if (Math.abs(video.currentTime - t) < 1e-4) {
      if (video.readyState >= 2) finish()
      else video.addEventListener('loadeddata', finish, { once: true })
    } else if (frameVideo.requestVideoFrameCallback) {
      // Register before seeking. Registering from `seeked` is too late on
      // Chromium: the requested frame has already been presented, leaving the
      // callback waiting until the safety timeout.
      const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (Math.abs(metadata.mediaTime - t) <= 1 / SAMPLE_FPS) finish()
        else frameCallback = frameVideo.requestVideoFrameCallback!.call(video, onFrame)
      }
      frameCallback = frameVideo.requestVideoFrameCallback.call(video, onFrame)
      video.currentTime = t
    } else {
      video.addEventListener('seeked', paintedFallback, { once: true })
      video.currentTime = t
    }
  })
}

const has = (track: PoseTrack, i: number) => !Number.isNaN(track.data[i * STRIDE])

/**
 * The dancer at a moment, interpolated between samples so the skeleton moves as
 * smoothly as the video does rather than at the sampling rate.
 */
export function sampleTrack(track: PoseTrack, time: number): TrackFrame | null {
  const exact = time * track.fps
  const i = Math.floor(exact)
  const j = Math.min(track.frames - 1, i + 1)
  if (i < 0 || i >= track.frames) return null
  if (!has(track, i)) return has(track, j) ? read(track, j, j, 0) : null
  return read(track, i, has(track, j) ? j : i, exact - i)
}

function read(track: PoseTrack, i: number, j: number, f: number): TrackFrame {
  const landmarks = []
  const world = []
  const a = i * STRIDE
  const b = j * STRIDE
  for (let k = 0; k < LANDMARK_COUNT; k++) {
    const oa = a + k * VALUES_PER_LANDMARK
    const ob = b + k * VALUES_PER_LANDMARK
    const mix = (p: number) => track.data[oa + p] + (track.data[ob + p] - track.data[oa + p]) * f
    landmarks.push({ x: mix(0), y: mix(1), z: 0, visibility: mix(2) })
    world.push({ x: mix(3), y: mix(4), z: mix(5), visibility: mix(2) })
  }
  return { landmarks, world }
}

export const packTrack = (t: PoseTrack): {
  version: number
  fps: number
  frames: number
  buffer: ArrayBuffer
  bpm?: number
  beatConfidence?: number
  beats?: ArrayBuffer
} => ({
  version: TRACK_VERSION,
  fps: t.fps,
  frames: t.frames,
  buffer: t.data.buffer.slice(0) as ArrayBuffer,
  bpm: t.bpm,
  beatConfidence: t.beatConfidence,
  beats: t.beats?.buffer.slice(0) as ArrayBuffer | undefined,
})

export const unpackTrack = (p: {
  version?: number
  fps: number
  frames: number
  buffer: ArrayBuffer
  bpm?: number
  beatConfidence?: number
  beats?: ArrayBuffer
  corrections?: PoseCorrection[]
}): PoseTrack | null =>
  p.version === TRACK_VERSION || p.version === 3
    ? {
        fps: p.fps,
        frames: p.frames,
        data: applyPoseCorrections(new Float32Array(p.buffer), p.frames, p.corrections),
        bpm: p.bpm,
        beatConfidence: p.beatConfidence,
        beats: p.beats ? new Float32Array(p.beats) : undefined,
        rhythmAnalysed: p.version === TRACK_VERSION,
      }
    : null
