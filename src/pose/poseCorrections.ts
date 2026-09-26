export interface PoseCorrection {
  frame: number
  landmark: number
  x: number
  y: number
  worldX: number
  worldY: number
}

interface CorrectableTrack {
  frames: number
  data: Float32Array
}

const STRIDE = 33 * 6
const offset = (frame: number, landmark: number) => frame * STRIDE + landmark * 6
const distance = (data: Float32Array, frame: number, a: number, b: number, world: boolean) => {
  const first = offset(frame, a) + (world ? 3 : 0)
  const second = offset(frame, b) + (world ? 3 : 0)
  return Math.hypot(data[first] - data[second], data[first + 1] - data[second + 1])
}

export function brushPoseCorrection(
  track: CorrectableTrack,
  existing: PoseCorrection[],
  frame: number,
  landmarks: number[],
  targetX: number,
  targetY: number,
  radiusFrames = 3,
) {
  if (!landmarks.length || frame < 0 || frame >= track.frames) return existing
  const anchor = offset(frame, landmarks[0])
  const dx = targetX - track.data[anchor]
  const dy = targetY - track.data[anchor + 1]
  const merged = new Map(existing.map((item) => [`${item.frame}:${item.landmark}`, item]))
  for (let nextFrame = Math.max(0, frame - radiusFrames); nextFrame <= Math.min(track.frames - 1, frame + radiusFrames); nextFrame++) {
    const weight = 1 - Math.abs(nextFrame - frame) / (radiusFrames + 1)
    const imageWidth = distance(track.data, nextFrame, 11, 12, false)
    const worldWidth = distance(track.data, nextFrame, 11, 12, true)
    const xScale = imageWidth > 1e-4 && worldWidth > 1e-4 ? worldWidth / imageWidth : 1
    const imageHeight = (distance(track.data, nextFrame, 11, 23, false) + distance(track.data, nextFrame, 12, 24, false)) / 2
    const worldHeight = (distance(track.data, nextFrame, 11, 23, true) + distance(track.data, nextFrame, 12, 24, true)) / 2
    const yScale = imageHeight > 1e-4 && worldHeight > 1e-4 ? worldHeight / imageHeight : xScale
    for (const landmark of landmarks) {
      const at = offset(nextFrame, landmark)
      merged.set(`${nextFrame}:${landmark}`, {
        frame: nextFrame,
        landmark,
        x: Math.max(0, Math.min(1, track.data[at] + dx * weight)),
        y: Math.max(0, Math.min(1, track.data[at + 1] + dy * weight)),
        worldX: track.data[at + 3] + dx * weight * xScale,
        worldY: track.data[at + 4] + dy * weight * yScale,
      })
    }
  }
  return [...merged.values()].sort((a, b) => a.frame - b.frame || a.landmark - b.landmark)
}

export function applyPoseCorrections(data: Float32Array, _frames: number, _corrections: PoseCorrection[] = []) {
  const corrected = new Float32Array(data)
  for (const correction of _corrections) {
    if (correction.frame < 0 || correction.frame >= _frames || correction.landmark < 0 || correction.landmark >= 33) continue
    const offset = correction.frame * 33 * 6 + correction.landmark * 6
    corrected[offset] = correction.x
    corrected[offset + 1] = correction.y
    corrected[offset + 3] = correction.worldX
    corrected[offset + 4] = correction.worldY
  }
  return corrected
}
