import assert from 'node:assert/strict'
import test from 'node:test'
import { playSfx } from '../src/lib/sfx.ts'

test('left and right menu navigation play five times louder without changing gesture beeps', () => {
  const gains: number[] = []
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    createOscillator() {
      return {
        type: 'triangle',
        frequency: { setValueAtTime() {} },
        connect(target: unknown) { return target },
        start() {},
        stop() {},
      }
    }
    createGain() {
      return {
        gain: {
          setValueAtTime(value: number) { gains.push(value) },
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      }
    }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeAudioContext } })
  try {
    playSfx('navigateLeft', false)
    playSfx('navigateRight', false)
    playSfx('gestureOne', false)
    assert.deepEqual(gains, [0.125, 0.125, 0.125, 0.125, 0.25])
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
