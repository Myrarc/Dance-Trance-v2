import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const LM = {
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
} as const

export type MenuGesture = 'previous' | 'next' | 'confirm' | 'back'
export type GestureContext = 'library' | 'lobby' | 'results' | 'menu' | 'songPicker'
export type PauseHold = { since: number; center: number } | null
export const PAUSE_HOLD_MS = 2000

export interface GestureHold {
  candidate: MenuGesture | null
  since: number
  latched: boolean
  beeps: number
  lastBeepAt: number
}

export interface GestureReading extends GestureHold {
  progress: number
  beep: 1 | 2 | 3 | null
  fired: MenuGesture | null
}

export const GESTURE_HOLD_MS = 900
export const GESTURE_REPEAT_MS = 650
const GESTURE_BEEP_GAP_MS = 400
const GESTURE_BEEP_DURATION_MS = 100

const visible = (point: NormalizedLandmark | undefined) =>
  !!point && (point.visibility ?? 1) >= 0.5

const reliableMenuPoint = (point: NormalizedLandmark | undefined) =>
  !!point && (point.visibility ?? 1) >= 0.55

/** Deliberate registration pose: the player's right hand is high, left hand down. */
export function isRightHandRaised(pose: NormalizedLandmark[]) {
  const points = [LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist]
  if (!points.every((index) => visible(pose[index]))) return false

  const ls = pose[LM.lShoulder]
  const rs = pose[LM.rShoulder]
  const re = pose[LM.rElbow]
  const lw = pose[LM.lWrist]
  const rw = pose[LM.rWrist]
  const shoulderWidth = Math.abs(ls.x - rs.x)
  if (shoulderWidth < 0.06) return false

  return rw.y < rs.y - shoulderWidth * 0.75 &&
    re.y < rs.y - shoulderWidth * 0.15 &&
    rw.y < re.y - shoulderWidth * 0.35 &&
    lw.y > ls.y + shoulderWidth * 0.35
}

/** Screen-space centre after the selfie view is mirrored. */
export function playerScreenX(pose: NormalizedLandmark[]) {
  const visibleTorso = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip]
    .map((index) => pose[index])
    .filter(visible)
  if (!visibleTorso.length) return null
  return 1 - visibleTorso.reduce((sum, point) => sum + point.x, 0) / visibleTorso.length
}

export function inPlayerZone(screenX: number, playerIndex: number, playerCount: number) {
  if (playerCount === 1) return screenX >= 0.25 && screenX <= 0.75
  return playerIndex === 0 ? screenX >= 0.05 && screenX <= 0.45 : screenX >= 0.55 && screenX <= 0.95
}

export function isCrossedArms(pose: NormalizedLandmark[] | null | undefined): boolean {
  if (!pose) return false
  const [leftShoulder, rightShoulder, leftWrist, rightWrist] = [pose[11], pose[12], pose[15], pose[16]]
  if (![leftShoulder, rightShoulder, leftWrist, rightWrist].every(reliableMenuPoint)) return false
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x)
  return shoulderWidth >= 0.06 &&
    Math.hypot(leftWrist.x - rightShoulder.x, leftWrist.y - rightShoulder.y) < shoulderWidth * 0.62 &&
    Math.hypot(rightWrist.x - leftShoulder.x, rightWrist.y - leftShoulder.y) < shoulderWidth * 0.62
}

/** Static menu poses are intentionally scale-relative and require visible arm joints. */
export function detectMenuGesture(pose: NormalizedLandmark[] | undefined): MenuGesture | null {
  if (!pose) return null
  const nose = pose[0]
  const leftShoulder = pose[11]
  const rightShoulder = pose[12]
  const leftElbow = pose[13]
  const rightElbow = pose[14]
  const leftWrist = pose[15]
  const rightWrist = pose[16]
  if (![nose, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist].every(reliableMenuPoint)) return null

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x)
  if (shoulderWidth < 0.06) return null
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const armYAllowance = shoulderWidth * 0.9
  const leftOutward = Math.sign(leftShoulder.x - rightShoulder.x)

  const leftHandUp = leftWrist.y < shoulderY - shoulderWidth * 0.5 &&
    leftElbow.y < shoulderY + shoulderWidth * 0.3 &&
    leftWrist.y < leftElbow.y - shoulderWidth * 0.35
  const rightHandUp = rightWrist.y < shoulderY - shoulderWidth * 0.5 &&
    rightElbow.y < shoulderY + shoulderWidth * 0.3 &&
    rightWrist.y < rightElbow.y - shoulderWidth * 0.35
  if (leftHandUp && rightHandUp) return null
  if (rightHandUp && !leftHandUp) return 'confirm'
  if (leftHandUp && !rightHandUp) return 'back'

  if (isCrossedArms(pose)) return 'back'

  const leftExtended =
    Math.abs(leftWrist.y - leftShoulder.y) < armYAllowance &&
    Math.abs(leftElbow.y - leftShoulder.y) < armYAllowance &&
    (leftWrist.x - leftShoulder.x) * leftOutward > shoulderWidth * 0.45
  const rightExtended =
    Math.abs(rightWrist.y - rightShoulder.y) < armYAllowance &&
    Math.abs(rightElbow.y - rightShoulder.y) < armYAllowance &&
    (rightWrist.x - rightShoulder.x) * -leftOutward > shoulderWidth * 0.45

  // Both arms out remain neutral for menu navigation.
  if (leftExtended === rightExtended) return null
  return leftExtended ? 'previous' : 'next'
}

export function advanceGestureHold(
  state: GestureHold,
  gesture: MenuGesture | null,
  now: number,
): GestureReading {
  if (!gesture) {
    return { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0, progress: 0, beep: null, fired: null }
  }
  if (state.latched) {
    if ((gesture === 'previous' || gesture === 'next') && state.candidate === gesture && now - state.lastBeepAt >= GESTURE_REPEAT_MS) {
      return { ...state, lastBeepAt: now, progress: 1, beep: null, fired: gesture }
    }
    return { ...state, progress: 1, beep: null, fired: null }
  }
  if (state.candidate !== gesture) {
    return { candidate: gesture, since: now, latched: false, beeps: 1, lastBeepAt: now, progress: 0, beep: 1, fired: null }
  }
  const progress = Math.min(1, Math.max(0, (now - state.since) / GESTURE_HOLD_MS))
  if (state.beeps < 3 && now - state.lastBeepAt >= GESTURE_BEEP_GAP_MS) {
    const beep = (state.beeps + 1) as 2 | 3
    return { ...state, beeps: beep, lastBeepAt: now, progress, beep, fired: null }
  }
  if (state.beeps === 3 && progress === 1 && now - state.lastBeepAt >= GESTURE_BEEP_DURATION_MS) {
    return { ...state, latched: true, lastBeepAt: now, progress: 1, beep: null, fired: gesture }
  }
  return { ...state, progress, beep: null, fired: null }
}

/** A registration hand raise must be visibly released before it can confirm a menu action. */
export function advanceGestureFromPose(
  state: GestureHold,
  pose: NormalizedLandmark[] | undefined,
  now: number,
): GestureReading {
  if (state.latched && state.candidate === 'confirm' && (!pose || isRightHandRaised(pose))) {
    return { ...state, progress: 1, beep: null, fired: null }
  }
  return advanceGestureHold(state, detectMenuGesture(pose), now)
}

/** The pause pose must stay crossed and stationary long enough to avoid dance moves. */
export function advancePauseHold(hold: PauseHold, crossed: boolean, center: number | null, now: number) {
  if (!crossed || center === null) return { hold: null, progress: 0, fired: false }
  if (!hold || Math.abs(center - hold.center) > 0.06) return { hold: { since: now, center }, progress: 0, fired: false }
  if (!Number.isFinite(hold.since)) return { hold, progress: 0, fired: false }
  const progress = Math.min(1, (now - hold.since) / PAUSE_HOLD_MS)
  return progress === 1
    ? { hold: { since: Infinity, center }, progress: 0, fired: true }
    : { hold, progress, fired: false }
}

export function gestureLabel(gesture: MenuGesture, context: GestureContext): string {
  if (context === 'songPicker') {
    if (gesture === 'previous') return 'Previous song'
    if (gesture === 'next') return 'Next song'
    if (gesture === 'back') return 'Go back'
    return 'Play selected song'
  }
  if (context === 'menu') {
    if (gesture === 'previous') return 'Previous option'
    if (gesture === 'next') return 'Next option'
    if (gesture === 'back') return 'Go back'
    return 'Select option'
  }
  if (gesture === 'previous') return 'Previous song'
  if (gesture === 'next') return 'Next song'
  if (gesture === 'back') return context === 'library' ? 'Close song list' : 'Choose a song'
  if (context === 'library') return 'Load selected song'
  if (context === 'results') return 'Play again'
  return 'Start game'
}
