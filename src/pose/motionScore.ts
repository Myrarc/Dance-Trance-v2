import { BONES, HEAD, computeAngles, inFocus, type Focus, type PoseFeature, type Vec } from './angles.ts'
import type { Difficulty } from './hitTargets.ts'
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
}

export interface MotionEvidence {
  quality: number | null
  coverage: number
  lag: number
}

export const motionLagLimit = (difficulty: Difficulty) => SETTINGS[difficulty].lag

/** Let the last phrase finish its timing window after the media reaches its end. */
export function advanceScoringClock(mediaTime: number, ended: boolean, nowMs: number, endedAt: number) {
  if (!ended) return { time: mediaTime, endedAt: 0 }
  if (!endedAt) return { time: mediaTime, endedAt: nowMs }
  return { time: mediaTime + (nowMs - endedAt) / 1000, endedAt }
}

const SETTINGS: Record<Difficulty, { lag: number; sigma: number; penalty: number }> = {
  easy: { lag: 1.5, sigma: 35, penalty: 0.25 },
  normal: { lag: 1.1, sigma: 27, penalty: 0.5 },
  hard: { lag: 0.8, sigma: 20, penalty: 0.75 },
}
const STEP_S = 0.5
const GAP_GRACE_S = 0.3
const LAG_CHANGE_S = 0.6
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const norm = (value: Vec) => Math.hypot(value.x, value.y, value.z)
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z
const delta = (a: Vec, b: Vec): Vec => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z })
const angle = (a: Vec, b: Vec) => Math.acos(clamp(dot(a, b), -1, 1)) * 180 / Math.PI
const keysFor = (focus: Focus, trackHead: boolean) => [
  ...BONES.map((bone) => bone.name),
  ...(trackHead ? [HEAD] : []),
].filter((key) => inFocus(key, focus))

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

/** Every active half-second is judged once; only a stable pose after motion makes a hold. */
export function buildMotionIntervals(frames: MotionFrame[], focus: Focus, trackHead = true): MotionInterval[] {
  if (frames.length < 2) return []
  const intervals: MotionInterval[] = []
  const keys = keysFor(focus, trackHead)
  const end = frames[frames.length - 1].t
  for (let start = 0; start + STEP_S <= end + 0.001; start += STEP_S) {
    const relevant = frames.filter((frame) => frame.t >= start - 0.001
      && frame.t <= start + STEP_S + 0.001)
    const moving = keys.filter((key) => {
      const visible = relevant.map((frame) => available(frame, key)).filter((value) => value !== null)
      if (visible.length < 3) return false
      const first = visible[0]
      let departure = 0
      let travel = 0
      for (let index = 1; index < visible.length; index++) {
        departure = Math.max(departure, angle(first, visible[index]))
        travel += angle(visible[index - 1], visible[index])
      }
      return departure >= 8 && travel >= 10
    })
    if (!moving.length) continue
    intervals.push({ start, end: start + STEP_S, kind: 'move', keys: moving })

    const holdStart = start + STEP_S
    const holdEnd = holdStart + 0.6
    if (holdEnd > end + 0.001) continue
    const holdFrames = frames.filter((frame) => frame.t >= holdStart - 0.001 && frame.t <= holdEnd + 0.001)
    const held = moving.filter((key) => {
      const visible = holdFrames.map((frame) => available(frame, key)).filter((value) => value !== null)
      return visible.length >= 7 && visible.every((value) => angle(visible[0], value) <= 8)
    })
    if (held.length) intervals.push({ start: holdStart, end: holdEnd, kind: 'hold', keys: held })
  }
  return intervals.sort((a, b) => a.end - b.end || a.start - b.start)
}

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
  if (lagLocked && hasLongGap(player, sampleStart + previousLag, interval.end + previousLag)) {
    return { quality: null, coverage: 0, lag: previousLag }
  }
  const settings = SETTINGS[difficulty]
  let best: MotionEvidence = { quality: null, coverage: 0, lag: previousLag }
  let bestRank = -Infinity
  const referencePoints = Array.from({ length: 5 }, (_, index) =>
    interpolate(reference, sampleStart + (interval.end - sampleStart) * index / 4))
  for (let offset = -settings.lag; offset <= settings.lag + 0.001; offset += 0.05) {
    const lag = Math.round(offset * 100) / 100
    if (lagLocked && Math.abs(lag - previousLag) > LAG_CHANGE_S + 0.001) continue
    if (hasLongGap(player, sampleStart + lag, interval.end + lag)) continue
    const playerPoints = Array.from({ length: 5 }, (_, index) =>
      interpolate(player, sampleStart + (interval.end - sampleStart) * index / 4 + lag))
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
    const timing = clamp(1 - settings.penalty * Math.abs(lag) / settings.lag)
    let quality = interval.kind === 'hold' ? pose * 0.85 + timing * 0.15
      : motion * 0.5 + pose * 0.35 + timing * 0.15
    if (interval.kind === 'move' && motion < 0.1) quality = Math.min(quality, 0.4)
    const rank = quality - 0.08 * Math.abs(lag - previousLag) / settings.lag
    if (rank > bestRank) {
      bestRank = rank
      best = { quality, coverage, lag }
    }
  }
  return best
}
