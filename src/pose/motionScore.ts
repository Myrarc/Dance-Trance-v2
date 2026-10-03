import { BONES, HEAD, computeAngles, type PoseFeature, type Vec } from './angles.ts'
import type { CueEvent, Difficulty } from './hitTargets.ts'
import type { PoseTrack } from './track.ts'

export interface MotionFrame {
  t: number
  feature: PoseFeature
  visibility?: Record<string, number>
}

export interface MotionInterval {
  start: number
  end: number
  kind: 'move' | 'hold'
  keys: string[]
  /** The exact displayed target, including its scheduled beat time. */
  cue?: CueEvent
}

export interface MotionEvidence {
  quality: number | null
  coverage: number
  lag: number
  movement?: number
  timing?: number
}

export const motionLagLimit = (difficulty: Difficulty) => SETTINGS[difficulty].lag

/** Let the last phrase finish its timing window after the media reaches its end. */
export function advanceScoringClock(mediaTime: number, ended: boolean, nowMs: number, endedAt: number) {
  if (!ended) return { time: mediaTime, endedAt: 0 }
  if (!endedAt) return { time: mediaTime, endedAt: nowMs }
  return { time: mediaTime + (nowMs - endedAt) / 1000, endedAt }
}

export const MOTION_SETTINGS: Record<Difficulty, { lag: number; sigma: number; perfect: number }> = {
  easy: { lag: 0.55, sigma: 35, perfect: 0.25 },
  normal: { lag: 0.4, sigma: 27, perfect: 0.18 },
  hard: { lag: 0.3, sigma: 20, perfect: 0.12 },
}
const SETTINGS = MOTION_SETTINGS
const STEP_S = 0.5
const GAP_GRACE_S = 0.3
const LAG_CHANGE_S = 0.6
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const norm = (value: Vec) => Math.hypot(value.x, value.y, value.z)
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z
const delta = (a: Vec, b: Vec): Vec => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z })
const angle = (a: Vec, b: Vec) => Math.acos(clamp(dot(a, b), -1, 1)) * 180 / Math.PI

export function liveMotionFrame(
  t: number,
  feature: PoseFeature,
  landmarks: { visibility?: number }[],
): MotionFrame {
  const visibility: Record<string, number> = {}
  for (const bone of BONES) {
    visibility[bone.name] = Math.min(
      landmarks[bone.from]?.visibility ?? 0,
      landmarks[bone.to]?.visibility ?? 0,
    )
  }
  visibility[HEAD] = Math.min(
    landmarks[0]?.visibility ?? 0,
    landmarks[7]?.visibility ?? 0,
    landmarks[8]?.visibility ?? 0,
  )
  return { t, feature, visibility }
}

/** The reference track stays on device; build only the features scoring needs. */
export function referenceMotionFrames(track: PoseTrack): MotionFrame[] {
  return Array.from({ length: track.frames }, (_, index) => {
    const t = index / track.fps
    const world = Array.from({ length: 33 }, (_, landmark) => {
      const offset = index * 33 * 6 + landmark * 6
      return {
        x: track.data[offset + 3],
        y: track.data[offset + 4],
        z: track.data[offset + 5],
        visibility: track.data[offset + 2],
      }
    })
    const visibility: Record<string, number> = {}
    for (const bone of BONES) {
      visibility[bone.name] = Math.min(
        world[bone.from]?.visibility ?? 0,
        world[bone.to]?.visibility ?? 0,
      )
    }
    visibility[HEAD] = Math.min(
      world[0]?.visibility ?? 0,
      world[7]?.visibility ?? 0,
      world[8]?.visibility ?? 0,
    )
    return { t, feature: computeAngles(world), visibility }
  })
}

function available(frame: MotionFrame, key: string) {
  return (frame.visibility?.[key] ?? 1) >= 0.5 ? frame.feature[key] ?? null : null
}

/** Score each displayed target once, using its own reference movement span. */
export function motionIntervalsForCues(cues: CueEvent[], start = 0): MotionInterval[] {
  return cues.map((cue) => {
    const keys = cue.kind === 'clap' ? ['lUpperArm', 'lForearm', 'rUpperArm', 'rForearm']
      : cue.joint === 'head' ? [HEAD]
        : cue.joint === 'leftHand' ? ['lUpperArm', 'lForearm']
          : cue.joint === 'rightHand' ? ['rUpperArm', 'rForearm']
            : cue.joint === 'leftFoot' ? ['lThigh', 'lShin'] : ['rThigh', 'rShin']
    return { start: cue.kind === 'hold' ? cue.poseTime : Math.max(start, cue.poseTime - STEP_S),
      end: cue.poseTime + (cue.kind === 'hold' ? cue.duration : 0),
      kind: cue.kind === 'hold' ? 'hold' as const : 'move' as const, keys, cue }
  }).filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.cue!.time - b.cue!.time)
}

export const motionJudgmentTime = (interval: MotionInterval, difficulty: Difficulty) =>
  (interval.cue?.time ?? interval.end) + motionLagLimit(difficulty) + 0.02

function interpolate(frames: MotionFrame[], time: number): MotionFrame | null {
  let after = frames.findIndex((frame) => frame.t >= time - 0.001)
  if (after < 0) return null
  if (Math.abs(frames[after].t - time) <= 0.025) return frames[after]
  if (after === 0) return null
  const before = frames[after - 1]
  const next = frames[after]
  const gap = next.t - before.t
  if (gap > GAP_GRACE_S + 0.001 || gap <= 0) return null
  const fraction = (time - before.t) / gap
  const feature: PoseFeature = {}
  const visibility: Record<string, number> = {}
  for (const key of new Set([...Object.keys(before.feature), ...Object.keys(next.feature)])) {
    const a = available(before, key)
    const b = available(next, key)
    if (!a || !b) continue
    const vector = {
      x: a.x + (b.x - a.x) * fraction,
      y: a.y + (b.y - a.y) * fraction,
      z: a.z + (b.z - a.z) * fraction,
    }
    const length = norm(vector)
    if (length < 1e-6) continue
    feature[key] = { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    visibility[key] = Math.min(before.visibility?.[key] ?? 1, next.visibility?.[key] ?? 1)
  }
  return { t: time, feature, visibility }
}

const mirroredKey = (key: string) => BONES.find((bone) => bone.name === key)?.mirror ?? key
const reflected = (vector: Vec, mirrored: boolean): Vec => mirrored
  ? { x: -vector.x, y: vector.y, z: vector.z } : vector

function hasLongGap(frames: MotionFrame[], start: number, end: number) {
  for (let index = 1; index < frames.length; index++) {
    if (frames[index].t - frames[index - 1].t > GAP_GRACE_S + 0.001
      && frames[index - 1].t < end && frames[index].t > start) return true
  }
  return false
}

/** One offset must explain the whole movement, so a lucky still frame cannot win. */
export function evaluateMotionInterval(
  interval: MotionInterval,
  reference: MotionFrame[],
  player: MotionFrame[],
  difficulty: Difficulty,
  previousLag = 0,
  mirrored: boolean | 'auto' = false,
  lagLocked = false,
): MotionEvidence {
  if (mirrored === 'auto') {
    const direct = evaluateMotionInterval(interval, reference, player, difficulty, previousLag, false, lagLocked)
    const mirror = evaluateMotionInterval(interval, reference, player, difficulty, previousLag, true, lagLocked)
    return (mirror.quality ?? -1) > (direct.quality ?? -1) ? mirror : direct
  }
  const sampleStart = interval.kind === 'move' ? Math.max(0, interval.start - 0.2) : interval.start
  const cueOffset = (interval.cue?.time ?? interval.end) - interval.end
  if (lagLocked && hasLongGap(player, sampleStart + cueOffset + previousLag, interval.end + cueOffset + previousLag)) {
    return { quality: null, coverage: 0, lag: previousLag }
  }
  const settings = SETTINGS[difficulty]
  let best: MotionEvidence = { quality: null, coverage: 0, lag: previousLag }
  let bestRank = -Infinity
  const referencePoints = Array.from({ length: 5 }, (_, index) =>
    interpolate(reference, sampleStart + (interval.end - sampleStart) * index / 4))
  for (let offset = -settings.lag; offset <= settings.lag + 0.001; offset += 0.05) {
    const lag = Math.round(offset * 100) / 100 || 0
    if (lagLocked && Math.abs(lag - previousLag) > LAG_CHANGE_S + 0.001) continue
    if (hasLongGap(player, sampleStart + cueOffset + lag, interval.end + cueOffset + lag)) continue
    const playerPoints = Array.from({ length: 5 }, (_, index) =>
      interpolate(player, sampleStart + (interval.end - sampleStart) * index / 4 + cueOffset + lag))
    let poseSum = 0
    let motionSum = 0
    let motionWeight = 0
    let covered = 0
    const possible = interval.keys.length * 5
    for (const key of interval.keys) {
      const userKey = mirrored ? mirroredKey(key) : key
      const pairs = referencePoints.map((frame, index) => {
        const source = frame && available(frame, key)
        const actual = playerPoints[index] && available(playerPoints[index], userKey)
        const weight = Math.min(frame?.visibility?.[key] ?? 1,
          playerPoints[index]?.visibility?.[userKey] ?? 1)
        return source && actual ? { target: reflected(source, mirrored), actual, weight } : null
      })
      for (const pair of pairs) {
        if (!pair) continue
        covered += pair.weight
        const error = angle(pair.actual, pair.target)
        poseSum += Math.exp(-0.5 * (error / settings.sigma) ** 2) * pair.weight
      }
      for (let index = 1; index < pairs.length; index++) {
        const before = pairs[index - 1]
        const after = pairs[index]
        if (!before || !after) continue
        const targetMove = delta(before.target, after.target)
        const userMove = delta(before.actual, after.actual)
        const expected = norm(targetMove)
        const actual = norm(userMove)
        if (expected < 0.01) continue
        const direction = actual < 0.01 ? 0 : clamp(dot(targetMove, userMove) / (expected * actual))
        const range = actual < 0.01 ? 0 : Math.min(expected, actual) / Math.max(expected, actual)
        const weight = Math.min(before.weight, after.weight)
        motionSum += direction * range * expected * weight
        motionWeight += expected * weight
      }
    }
    const coverage = possible ? covered / possible : 0
    if (coverage < 0.6) continue
    const pose = poseSum / covered
    const motion = interval.kind === 'hold' ? pose : motionWeight ? motionSum / motionWeight : 0
    let movement = interval.kind === 'hold' ? pose : (motion * 0.5 + pose * 0.35) / 0.85
    if (interval.kind === 'move' && motion < 0.1) movement = Math.min(movement, 0.4)
    const timing = Math.abs(lag) <= settings.perfect + 0.001 ? 1
      : clamp(0.79 * (settings.lag - Math.abs(lag)) / (settings.lag - settings.perfect))
    const quality = movement * timing
    // Select the best movement alignment first, then grade its timing. Otherwise
    // an incorrect on-time pose can conceal a correctly detected late movement.
    const rank = movement - 0.08 * Math.abs(lag - previousLag) / settings.lag
    if (rank > bestRank) {
      bestRank = rank
      best = { quality, coverage, lag, movement, timing }
    }
  }
  return best
}
