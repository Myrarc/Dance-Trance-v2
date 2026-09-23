import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceRegistration, initialRegistration, selectRegistrationCount } from '../src/pose/registration.ts'

const waiting = { present: true, inZone: true, raised: false }
const raised = { ...waiting, raised: true }

test('camera chooses two players only after a stable second body, without flickering back on a brief dropout', () => {
  let state = initialRegistration(0)
  state = selectRegistrationCount(state, 2, 100)
  assert.equal(state.count, 1)
  state = selectRegistrationCount(state, 2, 650)
  assert.equal(state.count, 2)
  state = selectRegistrationCount(state, 1, 700)
  assert.equal(selectRegistrationCount(state, 2, 900).count, 2)
  state = selectRegistrationCount(state, 1, 1000)
  assert.equal(selectRegistrationCount(state, 1, 2000).count, 2)
  assert.equal(selectRegistrationCount(state, 1, 2600).count, 1)
})

test('each player confirms independently, and lowering one hand does not undo their confirmation', () => {
  let state = selectRegistrationCount(selectRegistrationCount(initialRegistration(0), 2, 0), 2, 550)
  let result = advanceRegistration(state, [raised, waiting], 600)
  state = result.state
  result = advanceRegistration(state, [raised, waiting], 1850)
  state = result.state
  assert.deepEqual(result.progress, [1, 0])
  assert.equal(result.ready, false)
  result = advanceRegistration(state, [waiting, raised], 1900)
  state = result.state
  assert.deepEqual(result.progress, [1, 0])
  result = advanceRegistration(state, [waiting, raised], 3150)
  assert.deepEqual(result.progress, [1, 1])
  assert.equal(result.ready, true)
})

test('a confirmed player must remain in view, and a long absence requires reconfirmation', () => {
  let state = advanceRegistration(initialRegistration(0), [raised], 100).state
  state = advanceRegistration(state, [raised], 1400).state
  let result = advanceRegistration(state, [{ ...waiting, present: false }], 1500)
  assert.equal(result.ready, false)
  result = advanceRegistration(result.state, [{ ...waiting, present: false }], 3100)
  assert.deepEqual(result.progress, [0])
})
