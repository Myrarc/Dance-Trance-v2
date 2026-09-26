import assert from 'node:assert/strict'
import test from 'node:test'
import { gameReducer, initialGameState } from '../src/game/state.ts'

test('the camera stays off until the attract screen is dismissed', () => {
  assert.deepEqual(initialGameState, { screen: 'attract', arcadePhase: 'setup', returnScreen: null })
  assert.equal(gameReducer(initialGameState, { type: 'wake' }).screen, 'tracking')
  assert.equal(gameReducer(gameReducer(initialGameState, { type: 'wake' }), { type: 'openHome' }).screen, 'home')
})

test('editor and photos are separate destinations and Settings returns to each', () => {
  for (const [type, screen] of [['openEditor', 'editor'], ['openPhotos', 'photos']] as const) {
    const destination = gameReducer(initialGameState, { type })
    assert.equal(destination.screen, screen)
    const settings = gameReducer(destination, { type: 'openSettings' })
    assert.equal(gameReducer(settings, { type: 'closeSettings' }).screen, screen)
    assert.equal(gameReducer(destination, { type: 'openHome' }).screen, 'home')
  }
})

test('a selected song goes from loading to the round without another player setup', () => {
  let state = gameReducer(initialGameState, { type: 'openArcade' })
  assert.equal(state.arcadePhase, 'setup')
  state = gameReducer(state, { type: 'startCountdown' })
  assert.equal(state.arcadePhase, 'countdown')
  state = gameReducer(state, { type: 'countdownFinished' })
  state = gameReducer(state, { type: 'finishRound' })

  assert.equal(state.screen, 'arcade')
  assert.equal(state.arcadePhase, 'results')

  state = gameReducer(state, { type: 'replay' })
  assert.equal(state.arcadePhase, 'countdown')
})

test('settings opened from pause returns to the paused round', () => {
  let state = { ...initialGameState, screen: 'arcade' as const, arcadePhase: 'playing' as const }
  state = gameReducer(state, { type: 'pause' })
  state = gameReducer(state, { type: 'openSettings' })
  assert.equal(state.screen, 'settings')

  state = gameReducer(state, { type: 'closeSettings' })
  assert.equal(state.screen, 'arcade')
  assert.equal(state.arcadePhase, 'paused')

  state = gameReducer(state, { type: 'resume' })
  assert.equal(state.arcadePhase, 'playing')
})

test('restart does not visit results and quitting resets the arcade flow', () => {
  const playing = { ...initialGameState, screen: 'arcade' as const, arcadePhase: 'playing' as const }
  assert.equal(gameReducer(playing, { type: 'restart' }).arcadePhase, 'countdown')
  assert.deepEqual(gameReducer(playing, { type: 'openHome' }), { screen: 'home', arcadePhase: 'setup', returnScreen: null })
  assert.deepEqual(gameReducer(playing, { type: 'quitHome' }), initialGameState)
})
