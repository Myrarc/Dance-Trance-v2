import { computeAngles, hitMovementDegrees, MIN_HIT_MOVEMENT_DEG, type Focus, type PoseFeature } from './angles.ts'
import type { PoseTrack } from './track'

export type Difficulty = 'easy' | 'normal' | 'hard'
export type HitJoint = 'head' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot'
export const HIT_LEAD_S = 0.8

interface CueBase {
  kind: 'spot' | 'hold' | 'clap'
  time: number
  poseTime: number
  x: number
  y: number
  confidence: number
}

export interface SpotCue extends CueBase {
  kind: 'spot'
  joint: HitJoint
  feature: PoseFeature
}

export interface HoldCue extends CueBase {
  kind: 'hold'
  joint: HitJoint
  feature: PoseFeature
  duration: number
}

export interface ClapCue extends CueBase {
  kind: 'clap'
  expectedGap: number
  feature: PoseFeature
}

export type CueEvent = SpotCue | HoldCue | ClapCue

interface Point {
  x: number
  y: number
}

interface LandmarkPoint extends Point {
  visibility: number
}

const VALUES_PER_LANDMARK = 6
const LANDMARK_COUNT = 33
const STRIDE = LANDMARK_COUNT * VALUES_PER_LANDMARK
const VISIBILITY_MIN = 0.5
const HOLD_DISTANCE = 0.18
const HOLD_MIN_S = 0.6
const HOLD_MAX_S = 1.6
const CLAP_GAP = 0.4
const CLAP_CLOSE = 0.25
const CLAP_LOOKBACK_S = 0.5
const CLAP_WORLD_GAP = 0.9
const CLAP_RELEASE = 0.25

const POINTS: Record<HitJoint, number[]> = {
  head: [7, 8],
  leftHand: [15],
  rightHand: [16],
  leftFoot: [27],
  rightFoot: [28],
}

const MOVE_THRESHOLD: Record<HitJoint, number> = {
  head: 0.04,
  leftHand: 0.08,
  rightHand: 0.08,
  leftFoot: 0.055,
  rightFoot: 0.055,
}

const KIND_PRIORITY: Record<CueEvent['kind'], number> = {
  clap: 4,
  hold: 3,
  spot: 1,
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

function landmark(track: PoseTrack, frame: number, index: number): LandmarkPoint | null {
  if (frame < 0 || frame >= track.frames) return null
  const offset = frame * STRIDE + index * VALUES_PER_LANDMARK
  const point = {
    x: track.data[offset],
    y: track.data[offset + 1],
    visibility: track.data[offset + 2],
  }
  return point.visibility >= VISIBILITY_MIN && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? point
    : null
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function point(track: PoseTrack, frame: number, joint: HitJoint): Point | null {
  const points = POINTS[joint].map((index) => landmark(track, frame, index)).filter((value) => value !== null)
  if (!points.length && joint === 'head') {
    const nose = landmark(track, frame, 0)
    return nose ? { x: nose.x, y: nose.y } : null
  }
  if (!points.length) return null
  return {
    x: points.reduce((sum, value) => sum + value.x, 0) / points.length,
    y: points.reduce((sum, value) => sum + value.y, 0) / points.length,
  }
}

function bodyScale(track: PoseTrack, frame: number): number | null {
  const leftShoulder = landmark(track, frame, 11)
  const rightShoulder = landmark(track, frame, 12)
  if (leftShoulder && rightShoulder) {
    const width = distance(leftShoulder, rightShoulder)
    if (width > 0.02) return width
  }
  const leftHip = landmark(track, frame, 23)
  const rightHip = landmark(track, frame, 24)
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null
  const height = distance(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip))
  return height > 0.02 ? height : null
}

function wristGap(track: PoseTrack, frame: number): { gap: number; midpoint: Point } | null {
  const left = landmark(track, frame, 15)
  const right = landmark(track, frame, 16)
  const scale = bodyScale(track, frame)
  if (!left || !right || !scale) return null
  return { gap: distance(left, right) / scale, midpoint: midpoint(left, right) }
}

function worldWristGap(track: PoseTrack, frame: number) {
  if (frame < 0 || frame >= track.frames) return null
  if (![11, 12, 15, 16].every((index) => landmark(track, frame, index))) return null
  const world = (index: number) => {
    const offset = frame * STRIDE + index * VALUES_PER_LANDMARK
    return [track.data[offset + 3], track.data[offset + 4], track.data[offset + 5]]
  }
  const left = world(15)
  const right = world(16)
  const leftShoulder = world(11)
  const rightShoulder = world(12)
  const vector = left.map((value, index) => value - right[index])
  const shoulder = leftShoulder.map((value, index) => value - rightShoulder[index])
  const scale = Math.hypot(...shoulder)
  return Number.isFinite(scale) && scale > 0.02 && vector.every(Number.isFinite)
    ? { gap: Math.hypot(...vector) / scale, vector }
    : null
}

function featureAt(track: PoseTrack, frame: number): PoseFeature {
  const world = Array.from({ length: LANDMARK_COUNT }, (_, index) => {
    const offset = frame * STRIDE + index * VALUES_PER_LANDMARK
    return {
      x: track.data[offset + 3],
      y: track.data[offset + 4],
      z: track.data[offset + 5],
      visibility: track.data[offset + 2],
    }
  })
  return computeAngles(world)
}

function buildSpots(track: PoseTrack): SpotCue[] {
  const targets: SpotCue[] = []
  const gap = Math.max(1, Math.round(track.fps * 0.45))
  const forceAfter = Math.max(gap, Math.round(track.fps * 1.2))

  for (const joint of Object.keys(POINTS) as HitJoint[]) {
    let lastFrame = 0
    let lastPoint = point(track, 0, joint)
    for (let frame = 2; frame < track.frames - 1; frame++) {
      if (!lastPoint) {
        const firstVisible = point(track, frame, joint)
        if (firstVisible) {
          lastPoint = firstVisible
          lastFrame = frame
        }
        continue
      }
      if (frame - lastFrame < gap) continue
      const before = point(track, frame - 1, joint)
      const current = point(track, frame, joint)
      const after = point(track, frame + 1, joint)
      if (!before || !current || !after) continue
      const travelled = distance(lastPoint, current)
      if (travelled < MOVE_THRESHOLD[joint]) continue
      const feature = featureAt(track, frame)
      const movement = hitMovementDegrees(featureAt(track, lastFrame), feature, joint, false)
      if (movement === null || movement < MIN_HIT_MOVEMENT_DEG) continue

      const into = { x: current.x - before.x, y: current.y - before.y }
      const out = { x: after.x - current.x, y: after.y - current.y }
      const speedIn = Math.hypot(into.x, into.y)
      const speedOut = Math.hypot(out.x, out.y)
      const reversed = speedIn > 0.002 && speedOut > 0.002 && into.x * out.x + into.y * out.y < 0
      const slowed = speedIn > 0.003 && speedOut < speedIn * 0.55
      if (!reversed && !slowed && frame - lastFrame < forceAfter) continue

      const time = frame / track.fps
      targets.push({
        kind: 'spot',
        time,
        poseTime: time,
        joint,
        x: current.x,
        y: current.y,
        feature,
        confidence: clamp01(travelled / (MOVE_THRESHOLD[joint] * 2)),
      })
      lastFrame = frame
      lastPoint = current
    }
  }
  return targets
}

function buildHolds(track: PoseTrack, spots: SpotCue[]): HoldCue[] {
  const holds: HoldCue[] = []
  const minFrames = Math.ceil(HOLD_MIN_S * track.fps)
  const maxFrames = Math.ceil(HOLD_MAX_S * track.fps)

  for (const spot of spots) {
    const start = Math.round(spot.poseTime * track.fps)
    const anchor = point(track, start, spot.joint)
    if (!anchor) continue
    let end = start
    for (let frame = start + 1; frame <= Math.min(track.frames - 1, start + maxFrames); frame++) {
      const current = point(track, frame, spot.joint)
      const scale = bodyScale(track, frame)
      if (!current || !scale || distance(anchor, current) / scale > HOLD_DISTANCE) break
      end = frame
    }
    if (end - start < minFrames) continue
    const duration = (end - start) / track.fps
    holds.push({
      kind: 'hold',
      time: end / track.fps,
      poseTime: spot.poseTime,
      joint: spot.joint,
      x: spot.x,
      y: spot.y,
      feature: spot.feature,
      duration,
      confidence: clamp01(duration / 1.2),
    })
  }
  return holds
}

function buildClaps(track: PoseTrack): ClapCue[] {
  const claps: ClapCue[] = []
  const lookback = Math.max(1, Math.round(CLAP_LOOKBACK_S * track.fps))
  const cooldown = Math.max(1, Math.round(0.5 * track.fps))
  let last = -cooldown

  for (let frame = lookback; frame < track.frames - 1; frame++) {
    if (frame - last < cooldown) continue
    const previous = wristGap(track, frame - 1)
    const current = wristGap(track, frame)
    const next = wristGap(track, frame + 1)
    const before = wristGap(track, frame - lookback)
    if (!previous || !current || !next || !before) continue
    const closing = before.gap - current.gap
    if (current.gap > CLAP_GAP || closing < CLAP_CLOSE) continue
    if (current.gap > previous.gap || current.gap > next.gap) continue
    const beforeWorld = worldWristGap(track, frame - lookback)
    const currentWorld = worldWristGap(track, frame)
    if (!beforeWorld || !currentWorld || currentWorld.gap > CLAP_WORLD_GAP
      || beforeWorld.gap - currentWorld.gap < CLAP_CLOSE) continue
    // A projected overlap is not enough: the estimated 3D hands must come
    // together, separate again, and not pass through one another.
    let released = false
    for (let afterFrame = frame + 1; afterFrame <= Math.min(track.frames - 1, frame + lookback); afterFrame++) {
      const after = wristGap(track, afterFrame)
      const afterWorld = worldWristGap(track, afterFrame)
      if (!after || !afterWorld) continue
      const sameSides = beforeWorld.vector.reduce(
        (sum, value, index) => sum + value * afterWorld.vector[index], 0,
      ) > 0
      if (sameSides && after.gap - current.gap >= CLAP_RELEASE
        && afterWorld.gap - currentWorld.gap >= CLAP_RELEASE) {
        released = true
        break
      }
    }
    if (!released) continue
    const time = frame / track.fps
    claps.push({
      kind: 'clap',
      time,
      poseTime: time,
      x: current.midpoint.x,
      y: current.midpoint.y,
      expectedGap: current.gap,
      feature: featureAt(track, frame),
      confidence: clamp01(((CLAP_GAP - current.gap) / CLAP_GAP + closing / 0.6) / 2),
    })
    last = frame
  }
  return claps
}

function snapToBeat(track: PoseTrack, cue: CueEvent): CueEvent | null {
  if (!track.beats?.length) return cue
  let nearest = 0
  while (
    nearest + 1 < track.beats.length
    && Math.abs(track.beats[nearest + 1] - cue.time) < Math.abs(track.beats[nearest] - cue.time)
  ) nearest++
  const beat = track.beats[nearest]
  const previousBeat = track.beats[Math.max(0, nearest - 1)]
  const nextBeat = track.beats[Math.min(track.beats.length - 1, nearest + 1)]
  const beatGap = Math.max(0.25, Math.min(beat - previousBeat || Infinity, nextBeat - beat || Infinity))
  return Math.abs(beat - cue.time) <= Math.min(0.2, beatGap * 0.4) ? { ...cue, time: beat } : null
}

function cueChannel(cue: CueEvent) {
  if (cue.kind === 'spot' || cue.kind === 'hold') return cue.joint
  return 'hands'
}

function rank(a: CueEvent, b: CueEvent) {
  return b.confidence - a.confidence || KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] || a.poseTime - b.poseTime
}

function filterDifficulty(track: PoseTrack, cues: CueEvent[], difficulty: Difficulty) {
  const maxPerBucket = difficulty === 'hard' ? 2 : 1
  const bucketSeconds = difficulty === 'easy' ? 1 : difficulty === 'normal' ? 0.5 : 0.25
  const buckets = new Map<number, CueEvent[]>()

  for (const cue of cues) {
    let bucket: number
    if (track.beats?.length) {
      let nearest = 0
      while (nearest + 1 < track.beats.length && Math.abs(track.beats[nearest + 1] - cue.time) < Math.abs(track.beats[nearest] - cue.time)) nearest++
      if (difficulty === 'easy' && nearest % 2 === 1) continue
      bucket = nearest
    } else {
      bucket = Math.floor(cue.time / bucketSeconds)
    }
    const values = buckets.get(bucket) ?? []
    values.push(cue)
    buckets.set(bucket, values)
  }

  const selected: CueEvent[] = []
  for (const values of buckets.values()) {
    const channels = new Set<string>()
    for (const cue of values.sort(rank)) {
      const channel = cueChannel(cue)
      if (channels.has(channel)) continue
      selected.push(cue)
      channels.add(channel)
      if (channels.size >= maxPerBucket) break
    }
  }
  return selected.sort((a, b) => a.time - b.time || rank(a, b))
}

/** A note owns each limb it uses for its full on-screen span. Charts arrive in time order. */
export function removeOverlappingLimbCues(cues: CueEvent[]): CueEvent[] {
  const busyUntil = new Map<HitJoint, number>()
  return cues.filter((cue) => {
    const limbs: HitJoint[] = cue.kind === 'clap' ? ['leftHand', 'rightHand'] : [cue.joint]
    const visibleFrom = cue.time - (cue.kind === 'hold' ? cue.duration : 0) - HIT_LEAD_S
    if (limbs.some((limb) => visibleFrom < (busyUntil.get(limb) ?? -Infinity))) return false
    for (const limb of limbs) busyUntil.set(limb, cue.time + 0.12)
    return true
  })
}

/** Build an in-memory gameplay chart from an already analysed pose track. */
export function buildCueChart(
  track: PoseTrack,
  difficulty: Difficulty = 'normal',
  trackHead = true,
  focus: Focus = 'full',
): CueEvent[] {
  const spots = buildSpots(track)
  const holds = buildHolds(track, spots)
  const claps = buildClaps(track)
  const withoutReplacedSpots = spots.filter((spot) => {
    if (holds.some((hold) => hold.joint === spot.joint && Math.abs(hold.poseTime - spot.poseTime) <= 0.12)) return false
    if (
      (spot.joint === 'leftHand' || spot.joint === 'rightHand')
      && claps.some((clap) => Math.abs(clap.poseTime - spot.poseTime) <= 0.25)
    ) return false
    return true
  })
  const snapped = [...withoutReplacedSpots, ...holds, ...claps]
    .map((cue) => snapToBeat(track, cue))
    .filter((cue) => cue !== null)
    .filter((cue) => trackHead || !('joint' in cue) || cue.joint !== 'head')
    .filter((cue) => focus === 'full' || (focus === 'upper'
      ? cue.kind === 'clap' || cue.joint === 'head' || cue.joint === 'leftHand' || cue.joint === 'rightHand'
      : cue.kind !== 'clap' && (cue.joint === 'leftFoot' || cue.joint === 'rightFoot')))
  return removeOverlappingLimbCues(filterDifficulty(track, snapped, difficulty))
}

/** One imminent cue per body channel keeps the playfield readable. */
export function upcomingCues(cues: CueEvent[], time: number, leadSeconds: number) {
  const upcoming = new Map<string, CueEvent>()
  for (const cue of cues) {
    const visibleFrom = cue.kind === 'hold' ? cue.time - cue.duration - leadSeconds : cue.time - leadSeconds
    if (time < visibleFrom || time > cue.time + 0.12) continue
    const channel = cueChannel(cue)
    if (!upcoming.has(channel)) upcoming.set(channel, cue)
  }
  return [...upcoming.values()]
}

/** Feedback belongs on a circle the player could see when the phrase was judged. */
export function nearestVisibleCue(cues: CueEvent[], time: number, leadSeconds: number, keys?: string[]): CueEvent | null {
  const visible = upcomingCues(cues, time, leadSeconds).filter((cue) => {
    if (!keys?.length) return true
    if (cue.kind === 'clap') return keys.some((key) => key.includes('UpperArm') || key.includes('Forearm'))
    const prefix = cue.joint === 'head' ? 'head'
      : cue.joint === 'leftHand' ? 'l' : cue.joint === 'rightHand' ? 'r'
        : cue.joint === 'leftFoot' ? 'l' : 'r'
    if (prefix === 'head') return keys.includes('head')
    const limb = cue.joint.endsWith('Hand') ? ['UpperArm', 'Forearm'] : ['Thigh', 'Shin']
    return limb.some((part) => keys.includes(`${prefix}${part}`))
  })
  return visible.reduce<CueEvent | null>((nearest, cue) =>
    !nearest || Math.abs(cue.time - time) < Math.abs(nearest.time - time) ? cue : nearest, null)
}
