import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  advanceGestureFromPose,
  advanceGestureHold,
  advancePauseHold,
  detectMenuGesture,
  gestureLabel,
  inPlayerZone,
  isCrossedArms,
  isRightHandRaised,
  playerScreenX,
  type GestureHold,
} from '../src/pose/gestures.ts'

test('song picker labels match its circular left and right browsing', () => {
  assert.equal(gestureLabel('previous', 'songPicker'), 'Previous song')
  assert.equal(gestureLabel('next', 'songPicker'), 'Next song')
})

test('a held still cross pauses once and moving or releasing cancels it', () => {
  let reading = advancePauseHold(null, true, 0.5, 0)
  reading = advancePauseHold(reading.hold, true, 0.5, 1900)
  assert.equal(reading.fired, false)
  reading = advancePauseHold(reading.hold, true, 0.5, 2000)
  assert.equal(reading.fired, true)
  assert.equal(advancePauseHold(reading.hold, true, 0.5, 5000).fired, false)
  reading = advancePauseHold(reading.hold, false, null, 5100)
  reading = advancePauseHold(reading.hold, true, 0.5, 5200)
  reading = advancePauseHold(reading.hold, true, 0.6, 7200)
  assert.equal(reading.fired, false)
})

const pose = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))

const registrationPose = pose()
Object.assign(registrationPose[11], { x: 0.4, y: 0.4 })
Object.assign(registrationPose[12], { x: 0.6, y: 0.4 })
Object.assign(registrationPose[13], { x: 0.3, y: 0.4 })
Object.assign(registrationPose[14], { x: 0.7, y: 0.4 })
Object.assign(registrationPose[15], { x: 0.15, y: 0.4 })
Object.assign(registrationPose[16], { x: 0.85, y: 0.4 })

test('only an anatomical right hand raised above the head with the left down registers', () => {
  const p = pose()
  Object.assign(p[11], { x: 0.4, y: 0.4 })
  Object.assign(p[12], { x: 0.6, y: 0.4 })
  Object.assign(p[13], { x: 0.4, y: 0.5 })
  Object.assign(p[15], { x: 0.4, y: 0.65 })
  Object.assign(p[14], { x: 0.6, y: 0.25 })
  Object.assign(p[16], { x: 0.6, y: 0.12 })
  assert.equal(isRightHandRaised(p), true)
  assert.equal(isRightHandRaised(p.map((point, index) => index === 16 ? { ...point, y: 0.38 } : point)), false)
  assert.equal(isRightHandRaised(p.map((point, index) => index === 14 ? { ...point, y: 0.52 } : point)), false)
  assert.equal(isRightHandRaised(p.map((point, index) => index === 15 ? { ...point, y: 0.12 } : point)), false)
  assert.equal(isRightHandRaised(p.map((point, index) => index === 16 ? { ...point, visibility: 0.1 } : point)), false)
  assert.equal(isRightHandRaised(registrationPose), false)
  const distant = p.map((point) => ({
    ...point,
    x: 0.5 + (point.x - 0.5) * 0.35,
    y: 0.5 + (point.y - 0.5) * 0.6,
  }))
  assert.equal(isRightHandRaised(distant), true)
})

test('maps camera coordinates into mirrored player zones', () => {
  assert.equal(playerScreenX(registrationPose as NormalizedLandmark[]), 0.5)
  assert.equal(inPlayerZone(0.5, 0, 1), true)
  assert.equal(inPlayerZone(0.2, 0, 2), true)
  assert.equal(inPlayerZone(0.8, 1, 2), true)
  assert.equal(inPlayerZone(0.5, 0, 2), false)
})

test('recognises deliberate menu poses without treating both arms out as navigation', () => {
  const p = pose()
  Object.assign(p[0], { x: 0.5, y: 0.25 })
  Object.assign(p[11], { x: 0.4, y: 0.45 })
  Object.assign(p[12], { x: 0.6, y: 0.45 })

  Object.assign(p[13], { x: 0.28, y: 0.45 })
  Object.assign(p[15], { x: 0.15, y: 0.45 })
  Object.assign(p[14], { x: 0.72, y: 0.45 })
  Object.assign(p[16], { x: 0.85, y: 0.45 })
  assert.equal(detectMenuGesture(p), null)

  Object.assign(p[14], { x: 0.61, y: 0.58 })
  Object.assign(p[16], { x: 0.61, y: 0.7 })
  assert.equal(detectMenuGesture(p), 'previous')
  assert.equal(detectMenuGesture(p.map((point) => ({ ...point, x: 1 - point.x }))), 'previous')

  Object.assign(p[13], { x: 0.42, y: 0.58 })
  Object.assign(p[15], { x: 0.43, y: 0.7 })
  Object.assign(p[14], { x: 0.72, y: 0.45 })
  Object.assign(p[16], { x: 0.85, y: 0.45 })
  assert.equal(detectMenuGesture(p), 'next')
  assert.equal(detectMenuGesture(p.map((point) => ({ ...point, x: 1 - point.x }))), 'next')

  Object.assign(p[13], { x: 0.42, y: 0.58 })
  Object.assign(p[15], { x: 0.43, y: 0.7 })
  Object.assign(p[14], { x: 0.58, y: 0.35 })
  Object.assign(p[16], { x: 0.57, y: 0.18 })
  assert.equal(detectMenuGesture(p), 'confirm')

  Object.assign(p[13], { x: 0.42, y: 0.35 })
  Object.assign(p[15], { x: 0.43, y: 0.18 })
  assert.equal(detectMenuGesture(p), null)

  Object.assign(p[14], { x: 0.61, y: 0.58 })
  Object.assign(p[16], { x: 0.61, y: 0.7 })
  assert.equal(detectMenuGesture(p), 'back')
  assert.equal(isCrossedArms(p), false)

  Object.assign(p[13], { x: 0.48, y: 0.5 })
  Object.assign(p[15], { x: 0.6, y: 0.45 })
  Object.assign(p[14], { x: 0.52, y: 0.5 })
  Object.assign(p[16], { x: 0.4, y: 0.45 })
  assert.equal(isCrossedArms(p), true)
})

test('bent arms slightly below shoulder height can navigate but resting arms cannot', () => {
  const p = pose()
  Object.assign(p[0], { x: 0.5, y: 0.25 })
  Object.assign(p[11], { x: 0.4, y: 0.45 })
  Object.assign(p[12], { x: 0.6, y: 0.45 })
  Object.assign(p[13], { x: 0.3, y: 0.54 })
  Object.assign(p[15], { x: 0.26, y: 0.56 })
  Object.assign(p[14], { x: 0.61, y: 0.58 })
  Object.assign(p[16], { x: 0.61, y: 0.7 })
  assert.equal(detectMenuGesture(p), 'previous')
  assert.equal(detectMenuGesture(p.map((point) => ({ ...point, x: 1 - point.x }))), 'previous')

  Object.assign(p[13], { x: 0.39, y: 0.58 })
  Object.assign(p[15], { x: 0.39, y: 0.7 })
  Object.assign(p[14], { x: 0.7, y: 0.54 })
  Object.assign(p[16], { x: 0.74, y: 0.56 })
  assert.equal(detectMenuGesture(p), 'next')

  Object.assign(p[14], { x: 0.61, y: 0.58 })
  Object.assign(p[16], { x: 0.61, y: 0.7 })
  assert.equal(detectMenuGesture(p), null)
})

test('a comfortably bent arm below shoulder height navigates without a full extension', () => {
  const p = pose()
  Object.assign(p[0], { x: 0.5, y: 0.24 })
  Object.assign(p[11], { x: 0.4, y: 0.4 })
  Object.assign(p[12], { x: 0.6, y: 0.4 })
  Object.assign(p[13], { x: 0.4, y: 0.56 })
  Object.assign(p[15], { x: 0.4, y: 0.68 })
  Object.assign(p[14], { x: 0.66, y: 0.54 })
  Object.assign(p[16], { x: 0.71, y: 0.56 })
  assert.equal(detectMenuGesture(p), 'next')

  Object.assign(p[14], { x: 0.6, y: 0.56 })
  Object.assign(p[16], { x: 0.6, y: 0.68 })
  Object.assign(p[13], { x: 0.34, y: 0.54 })
  Object.assign(p[15], { x: 0.29, y: 0.56 })
  assert.equal(detectMenuGesture(p), 'previous')

  Object.assign(p[14], { x: 0.66, y: 0.54 })
  Object.assign(p[16], { x: 0.71, y: 0.56 })
  assert.equal(detectMenuGesture(p), null, 'both arms out should not navigate')
})

test('a bent hand raised near the face selects or goes back, but an arm held sideways does not', () => {
  const p = pose()
  Object.assign(p[0], { x: 0.5, y: 0.25 })
  Object.assign(p[11], { x: 0.4, y: 0.45 })
  Object.assign(p[12], { x: 0.6, y: 0.45 })
  Object.assign(p[13], { x: 0.4, y: 0.58 })
  Object.assign(p[15], { x: 0.4, y: 0.7 })
  Object.assign(p[14], { x: 0.66, y: 0.49 })
  Object.assign(p[16], { x: 0.69, y: 0.31 })
  assert.equal(detectMenuGesture(p), 'confirm')

  Object.assign(p[14], { x: 0.6, y: 0.58 })
  Object.assign(p[16], { x: 0.6, y: 0.7 })
  Object.assign(p[13], { x: 0.34, y: 0.49 })
  Object.assign(p[15], { x: 0.31, y: 0.31 })
  assert.equal(detectMenuGesture(p), 'back')

  Object.assign(p[14], { x: 0.66, y: 0.49 })
  Object.assign(p[16], { x: 0.69, y: 0.31 })
  assert.equal(detectMenuGesture(p), null, 'both hands up should not choose an action')

  Object.assign(p[13], { x: 0.4, y: 0.58 })
  Object.assign(p[15], { x: 0.4, y: 0.7 })
  Object.assign(p[14], { x: 0.66, y: 0.54 })
  Object.assign(p[16], { x: 0.71, y: 0.56 })
  assert.equal(detectMenuGesture(p), 'next', 'the easier sideways pose must not select')
})

test('three live beeps precede navigation, then a held pose repeats at a controlled rate', () => {
  let state: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }
  let reading = advanceGestureHold(state, 'next', 100)
  assert.equal(reading.beep, 1)
  state = reading
  reading = advanceGestureHold(state, 'next', 499)
  assert.equal(reading.beep, null)
  state = reading
  reading = advanceGestureHold(state, 'next', 500)
  assert.equal(reading.beep, 2)
  state = reading
  reading = advanceGestureHold(state, 'next', 900)
  assert.equal(reading.beep, 3)
  assert.equal(reading.fired, null)
  state = reading
  reading = advanceGestureHold(state, 'next', 1000)
  assert.equal(reading.beep, null)
  assert.equal(reading.fired, 'next')
  state = reading
  assert.equal(advanceGestureHold(state, 'next', 1600).fired, null)
  state = advanceGestureHold(state, 'next', 1650)
  assert.equal(state.fired, 'next')
  assert.equal(advanceGestureHold(state, 'next', 2000).fired, null)
  state = advanceGestureHold(state, null, 2100)
  assert.equal(advanceGestureHold(state, 'next', 2200).beep, 1)
})

test('select and back fire once until released', () => {
  const ready: GestureHold = { candidate: 'confirm', since: 0, latched: true, beeps: 3, lastBeepAt: 1000 }
  assert.equal(advanceGestureHold(ready, 'confirm', 5000).fired, null)
  assert.equal(advanceGestureHold({ ...ready, candidate: 'back' }, 'back', 5000).fired, null)
})

test('losing recognition after the first beep cancels the remaining beeps', () => {
  let state: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }
  state = advanceGestureHold(state, 'confirm', 0)
  assert.equal(state.beeps, 1)
  const lost = advanceGestureHold(state, null, 250)
  assert.equal(lost.beep, null)
  assert.equal(lost.progress, 0)
  assert.equal(advanceGestureHold(lost, null, 850).fired, null)
  assert.equal(advanceGestureHold(lost, 'confirm', 900).beep, 1)
})

test('losing recognition after the second beep prevents the third and the action', () => {
  let state: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }
  state = advanceGestureHold(state, 'back', 0)
  state = advanceGestureHold(state, 'back', 400)
  assert.equal(state.beeps, 2)
  state = advanceGestureHold(state, null, 600)
  assert.equal(advanceGestureHold(state, null, 800).beep, null)
  assert.equal(advanceGestureHold(state, null, 1000).fired, null)
})

test('switching gestures restarts the three-beep confirmation', () => {
  let state: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }
  state = advanceGestureHold(state, 'previous', 0)
  state = advanceGestureHold(state, 'previous', 400)
  const switched = advanceGestureHold(state, 'next', 450)
  assert.equal(switched.beep, 1)
  assert.equal(switched.candidate, 'next')
  assert.equal(advanceGestureHold(switched, 'next', 900).fired, null)
})

test('slow inference emits only one beep per observed frame', () => {
  let state: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }
  state = advanceGestureHold(state, 'confirm', 0)
  state = advanceGestureHold(state, 'confirm', 850)
  assert.equal(state.beep, 2)
  const tooSoon = advanceGestureHold(state, 'confirm', 900)
  assert.equal(tooSoon.beep, null)
  const third = advanceGestureHold(tooSoon, 'confirm', 1250)
  assert.equal(third.beep, 3)
  assert.equal(advanceGestureHold(third, 'confirm', 1350).fired, 'confirm')
})

test('registration hand raise cannot confirm a menu action until a visible neutral release', () => {
  const raised = pose()
  Object.assign(raised[0], { x: 0.5, y: 0.2 })
  Object.assign(raised[11], { x: 0.4, y: 0.4 })
  Object.assign(raised[12], { x: 0.6, y: 0.4 })
  Object.assign(raised[13], { x: 0.4, y: 0.52 })
  Object.assign(raised[15], { x: 0.4, y: 0.65 })
  Object.assign(raised[14], { x: 0.6, y: 0.24 })
  Object.assign(raised[16], { x: 0.6, y: 0.08 })
  const awaitingRelease: GestureHold = { candidate: 'confirm', since: 0, latched: true, beeps: 0, lastBeepAt: 0 }
  const held = advanceGestureFromPose(awaitingRelease, raised, 1000)
  assert.equal(held.fired, null)
  assert.equal(held.beep, null)
  const stillLatched = advanceGestureFromPose(held, undefined, 1100)
  assert.equal(stillLatched.latched, true)
  const neutral = raised.map((point, index) => index === 14 || index === 16
    ? { ...point, y: index === 14 ? 0.52 : 0.65 }
    : point)
  const released = advanceGestureFromPose(stillLatched, neutral, 1200)
  assert.equal(released.latched, false)
  const started = advanceGestureFromPose(released, raised, 1300)
  assert.equal(started.beep, 1)
  const second = advanceGestureFromPose(started, raised, 1700)
  const third = advanceGestureFromPose(second, raised, 2100)
  assert.equal(advanceGestureFromPose(third, raised, 2200).fired, 'confirm')
})
