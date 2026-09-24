import { advanceMotionRound, newMotionRound, trackingCoverage, type CueLandmark, type MotionRound } from './gameplay.ts'
import { evaluateMotionInterval, type MotionFrame, type MotionInterval } from './motionScore.ts'
import type { PoseFeature, Vec } from './angles.ts'

export const DIAGNOSTIC_STEPS = [
  { id: 'right-arm', label: 'Raise your right arm', start: 1.5, end: 2.1, keys: ['rUpperArm', 'rForearm'] },
  { id: 'both-arms', label: 'Stretch both arms out', start: 3.6, end: 4.2, keys: ['lUpperArm', 'lForearm', 'rUpperArm', 'rForearm'] },
  { id: 'side-step', label: 'Tap your right foot out', start: 5.7, end: 6.3, keys: ['rThigh', 'rShin'] },
] as const
export const DIAGNOSTIC_DURATION = 7.2

export function diagnosticTargetPoints(landmarks: CueLandmark[] | null | undefined, step: string): { x: number; y: number }[] {
  if (!landmarks) return []
  const left = landmarks[11]
  const right = landmarks[12]
  const hip = landmarks[24]
  const ankle = landmarks[28]
  if (!left || !right || !hip) return []
  const spread = (left.x >= right.x ? 1 : -1) * Math.max(0.1, Math.abs(left.x - right.x))
  const height = Math.max(0.15, hip.y - right.y)
  if (step === 'right-arm') return [{ x: right.x, y: right.y - height * 0.95 }]
  if (step === 'both-arms') return [
    { x: left.x + spread * 0.95, y: left.y },
    { x: right.x - spread * 0.95, y: right.y },
  ]
  return ankle ? [{ x: hip.x - spread * 1.25, y: ankle.y }] : []
}

const normalized = (x: number, y: number): Vec => {
  const length = Math.hypot(x, y)
  return { x: x / length, y: y / length, z: 0 }
}
const rest: PoseFeature = {
  lUpperArm: normalized(0.1, -1), lForearm: normalized(0.1, -1),
  rUpperArm: normalized(-0.1, -1), rForearm: normalized(-0.1, -1),
  lThigh: normalized(0.05, -1), lShin: normalized(0.02, -1),
  rThigh: normalized(-0.05, -1), rShin: normalized(-0.02, -1),
}
const out: PoseFeature = {
  ...rest,
  lUpperArm: normalized(1, 0), lForearm: normalized(1, 0),
  rUpperArm: normalized(-1, 0), rForearm: normalized(-1, 0),
}
const overhead: PoseFeature = {
  ...rest,
  rUpperArm: normalized(-0.1, 1), rForearm: normalized(-0.1, 1),
}
const blend = (from: Vec | null | undefined, to: Vec | null | undefined, progress: number) => {
  if (!from || !to) return null
  return normalized(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress)
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** A small, fixed reference dance with the same torso-relative features as Arcade. */
export function diagnosticReference(): MotionFrame[] {
  return Array.from({ length: Math.round(DIAGNOSTIC_DURATION * 15) + 1 }, (_, index) => {
    const t = index / 15
    const feature: PoseFeature = { ...rest }
    const arm = smooth((t - 1.5) / 0.6) * (1 - smooth((t - 2.55) / 0.45))
    for (const key of DIAGNOSTIC_STEPS[0].keys) feature[key] = blend(rest[key], overhead[key], arm)
    const spread = smooth((t - 3.6) / 0.6) * (1 - smooth((t - 4.65) / 0.45))
    for (const key of DIAGNOSTIC_STEPS[1].keys) feature[key] = blend(feature[key], out[key], spread)
    const step = smooth((t - 5.7) / 0.6) * (1 - smooth((t - 6.75) / 0.45))
    feature.rThigh = blend(rest.rThigh, normalized(-0.7, -0.7), step)
    feature.rShin = blend(rest.rShin, normalized(-0.2, -0.98), step)
    return { t, feature }
  })
}

export const DIAGNOSTIC_REFERENCE = diagnosticReference()
export const DIAGNOSTIC_INTERVALS: MotionInterval[] = DIAGNOSTIC_STEPS.map((step) => ({
  start: step.start,
  end: step.end,
  kind: 'move',
  keys: [...step.keys],
}))

export interface DiagnosticResult {
  round: MotionRound
  steps: { id: string; quality: number | null; coverage: number; lag: number }[]
}

/** Each registered player is evaluated independently, even when one is occluded. */
export function scoreDiagnostic(players: MotionFrame[][]): DiagnosticResult[] {
  return players.map((frames) => {
    let round = newMotionRound(DIAGNOSTIC_INTERVALS.length)
    const steps = DIAGNOSTIC_INTERVALS.map((interval) => {
      const evidence = evaluateMotionInterval(interval, DIAGNOSTIC_REFERENCE, frames, 'normal', round.lag, false, round.judged > 0)
      round = advanceMotionRound(round, evidence, interval.kind)
      return { id: DIAGNOSTIC_STEPS[DIAGNOSTIC_INTERVALS.indexOf(interval)].id, ...evidence }
    })
    return { round, steps }
  })
}

export const diagnosticCoverage = (result: DiagnosticResult) => trackingCoverage(result.round)
