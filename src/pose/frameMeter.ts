export interface FrameMetrics {
  cameraFps: number
  trackingFps: number
  droppedFrames: number
  inferenceP95Ms: number
}

/** Measures delivered camera frames separately from frames processed by pose inference. */
export class FrameMeter {
  private startedAt = -1
  private firstPresented = 0
  private lastPresented = 0
  private processed = 0
  private dropped = 0
  private inferenceMs: number[] = []

  recordInference(milliseconds: number): void {
    this.inferenceMs.push(milliseconds)
    if (this.inferenceMs.length > 60) this.inferenceMs.shift()
  }

  record(presentedFrames: number, nowMs: number): void {
    if (this.startedAt < 0) {
      this.startedAt = nowMs
      this.firstPresented = presentedFrames
    } else {
      this.dropped += Math.max(0, presentedFrames - this.lastPresented - 1)
    }
    this.lastPresented = presentedFrames
    this.processed++
  }

  snapshot(nowMs: number): FrameMetrics {
    if (this.startedAt < 0) return { cameraFps: 0, trackingFps: 0, droppedFrames: 0, inferenceP95Ms: 0 }
    const seconds = Math.max(0.001, (nowMs - this.startedAt) / 1000)
    const sorted = [...this.inferenceMs].sort((a, b) => a - b)
    return {
      cameraFps: Math.round((this.lastPresented - this.firstPresented) / seconds),
      trackingFps: Math.round(Math.max(0, this.processed - 1) / seconds),
      droppedFrames: this.dropped,
      inferenceP95Ms: sorted.length ? Math.round(sorted[Math.ceil(sorted.length * .95) - 1]) : 0,
    }
  }
}

export function frameTimestampMs(mediaTime: number, fallbackMs: number): number {
  return Number.isFinite(mediaTime) ? mediaTime * 1000 : fallbackMs
}
