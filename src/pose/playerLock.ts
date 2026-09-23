import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { inPlayerZone, isRightHandRaised, playerScreenX } from './gestures.ts'
import { LM } from './skeleton.ts'

interface Anchor {
  x: number
  y: number
  scale: number
}

export interface ColorSignature {
  r: number
  g: number
  b: number
}

export interface LockedPlayer extends Anchor {
  appearance: ColorSignature | null
  registeredScale: number
  velocityX: number
  velocityY: number
  lastSeenAt: number
  relockSince: number | null
  relockX: number | null
  relockY: number | null
}

export interface PlayerLock {
  slots: LockedPlayer[]
}

export type LockReason = 'matched' | 'no pose' | 'torso' | 'scale' | 'appearance' | 'relock gesture' | 'relock hold' | 'distance' | 'assigned elsewhere'

const LOST_AFTER_MS = 750
const RELOCK_HOLD_MS = 900

function anchor(pose: NormalizedLandmark[]): Anchor | null {
  const points = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].map((index) => pose[index])
  if (points.some((point) => !point || (point.visibility ?? 1) < 0.5)) return null
  const [ls, rs, lh, rh] = points
  const shoulderY = (ls.y + rs.y) / 2
  const hipY = (lh.y + rh.y) / 2
  const scale = Math.abs(hipY - shoulderY)
  if (scale < 0.06) return null
  return { x: (ls.x + rs.x + lh.x + rh.x) / 4, y: (shoulderY + hipY) / 2, scale }
}

/** Registration selects only intentional, in-zone dancers; extra detections never become slots. */
export function registrationCandidates(poses: NormalizedLandmark[][], playerCount: 1 | 2): (number | null)[] {
  return Array.from({ length: playerCount }, (_, slot) => {
    let best: number | null = null
    let bestScale = 0
    for (let index = 0; index < poses.length; index++) {
      const reading = anchor(poses[index])
      const screenX = playerScreenX(poses[index])
      if (!reading || screenX === null || !inPlayerZone(screenX, slot, playerCount)) continue
      if (reading.scale > bestScale) {
        best = index
        bestScale = reading.scale
      }
    }
    return best
  })
}

export function createPlayerLock(
  poses: NormalizedLandmark[][],
  nowMs: number,
  appearances: (ColorSignature | null)[] = [],
): PlayerLock {
  const slots = poses.map((pose, index) => {
    const reading = anchor(pose)
    if (!reading) throw new Error('Cannot lock a player without a visible torso')
    return { ...reading, appearance: appearances[index] ?? null, registeredScale: reading.scale, velocityX: 0, velocityY: 0,
      lastSeenAt: nowMs, relockSince: null, relockX: null, relockY: null }
  })
  return { slots }
}

/** Match at most one detection to each registered slot; unmatched people are ignored. */
export function matchPlayerLock(
  lock: PlayerLock,
  poses: NormalizedLandmark[][],
  nowMs: number,
  appearances: (ColorSignature | null)[] = [],
): { state: PlayerLock; indices: (number | null)[]; reasons: LockReason[] } {
  const readings = poses.map(anchor)
  const decisions = lock.slots.map((slot, slotIndex) => readings.map((reading, index): { cost: number; reason: LockReason } => {
    if (!reading) return { cost: Infinity, reason: 'torso' }
    const ratio = reading.scale / slot.registeredScale
    if (ratio < 0.7 || ratio > 1.5) return { cost: Infinity, reason: 'scale' }
    const appearance = appearances[index]
    if (slot.appearance && appearance &&
      Math.hypot(slot.appearance.r - appearance.r, slot.appearance.g - appearance.g, slot.appearance.b - appearance.b) / Math.hypot(255, 255, 255) > 0.32) {
      return { cost: Infinity, reason: 'appearance' }
    }
    const dt = Math.max(0, nowMs - slot.lastSeenAt) / 1000
    const longLoss = nowMs - slot.lastSeenAt > LOST_AFTER_MS
    if (longLoss && (!isRightHandRaised(poses[index]) || !inPlayerZone(playerScreenX(poses[index]) ?? -1, slotIndex, lock.slots.length))) {
      return { cost: Infinity, reason: 'relock gesture' }
    }
    const predictedX = slot.x + slot.velocityX * Math.min(dt, 0.2)
    const predictedY = slot.y + slot.velocityY * Math.min(dt, 0.2)
    const distance = Math.hypot(reading.x - predictedX, reading.y - predictedY)
    const limit = Math.min(0.34, 0.10 + dt * 0.6)
    if (distance > limit) return { cost: Infinity, reason: 'distance' }
    return { cost: distance / limit + Math.abs(Math.log(ratio)), reason: 'matched' }
  }))
  const costs = decisions.map((row) => row.map((decision) => decision.cost))

  let chosen: (number | null)[] = lock.slots.map(() => null)
  let lowest = Infinity
  const visit = (slot: number, used: Set<number>, picks: (number | null)[], score: number) => {
    if (slot === lock.slots.length) {
      if (score < lowest) { lowest = score; chosen = picks }
      return
    }
    visit(slot + 1, used, [...picks, null], score + 3)
    for (let index = 0; index < poses.length; index++) {
      if (used.has(index) || !Number.isFinite(costs[slot][index])) continue
      const nextUsed = new Set(used)
      nextUsed.add(index)
      visit(slot + 1, nextUsed, [...picks, index], score + costs[slot][index])
    }
  }
  visit(0, new Set(), [], 0)

  const indices: (number | null)[] = []
  const reasons: LockReason[] = []
  const slots = lock.slots.map((slot, index) => {
    const detectionIndex = chosen[index]
    const reading = detectionIndex === null ? null : readings[detectionIndex]
    if (!reading) {
      indices.push(null)
      const reason = decisions[index][0]?.reason ?? 'no pose'
      reasons.push(reason === 'matched' ? 'assigned elsewhere' : reason)
      return { ...slot, relockSince: null, relockX: null, relockY: null }
    }
    const longLoss = nowMs - slot.lastSeenAt > LOST_AFTER_MS
    if (longLoss) {
      const sameCandidate = slot.relockSince !== null && slot.relockX !== null && slot.relockY !== null &&
        Math.hypot(reading.x - slot.relockX, reading.y - slot.relockY) < 0.08
      const relockSince = sameCandidate ? slot.relockSince ?? nowMs : nowMs
      if (nowMs - relockSince < RELOCK_HOLD_MS) {
        indices.push(null)
        reasons.push('relock hold')
        return { ...slot, relockSince, relockX: reading.x, relockY: reading.y }
      }
    }
    const dt = Math.max(0.001, (nowMs - slot.lastSeenAt) / 1000)
    indices.push(detectionIndex)
    reasons.push('matched')
    return { ...slot, ...reading,
      velocityX: longLoss ? 0 : Math.max(-1.5, Math.min(1.5, slot.velocityX * 0.6 + (reading.x - slot.x) / dt * 0.4)),
      velocityY: longLoss ? 0 : Math.max(-1.5, Math.min(1.5, slot.velocityY * 0.6 + (reading.y - slot.y) / dt * 0.4)),
      lastSeenAt: nowMs, relockSince: null, relockX: null, relockY: null }
  })
  return { state: { slots }, indices, reasons }
}

/** Solo play follows the largest usable body, without retaining an identity lock. */
export function primarySoloCandidate(poses: NormalizedLandmark[][]): number | null {
  let best: number | null = null
  let bestScale = 0
  poses.forEach((pose, index) => {
    const reading = anchor(pose)
    if (reading && reading.scale > bestScale) {
      best = index
      bestScale = reading.scale
    }
  })
  return best
}
