import assert from 'node:assert/strict'
import test from 'node:test'
import { playSfx } from '../src/lib/sfx.ts'

test('arcade sounds distinguish navigation, starts, rewards, and mute while preserving the button and gesture assets', async () => {
  const gains: number[] = []
  const files: string[] = []
  const samples: { rate: number; start: number[] }[] = []
  const tones: { frequency: number; wave: string; start: number; stop: number; attack: number }[] = []
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    decodeAudioData() { return Promise.resolve({} as AudioBuffer) }
    createBufferSource() {
      const sample = { rate: 1, start: [] as number[] }
      samples.push(sample)
      return {
        buffer: null,
        playbackRate: {
          get value() { return sample.rate },
          set value(value: number) { sample.rate = value },
        },
        connect(target: unknown) { return target },
        start(...args: number[]) { sample.start = args },
      }
    }
    createOscillator() {
      const tone = { frequency: 0, wave: '', start: 0, stop: 0, attack: 0 }
      tones.push(tone)
      return {
        get type() { return tone.wave },
        set type(value: string) { tone.wave = value },
        frequency: { setValueAtTime(value: number) { tone.frequency = value } },
        connect(target: unknown) { return target },
        start(time: number) { tone.start = time },
        stop(time: number) { tone.stop = time },
      }
    }
    createGain() {
      return {
        gain: {
          setValueAtTime(value: number) { if (value > 0.0001) gains.push(value) },
          linearRampToValueAtTime(value: number, time: number) { gains.push(value); tones.at(-1)!.attack = time },
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      }
    }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    AudioContext: FakeAudioContext,
    fetch: async (file: string) => {
      files.push(file)
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }
    },
  } })
  try {
    playSfx('navigateLeft', false)
    playSfx('navigateRight', false)
    playSfx('gestureOne', false)
    playSfx('menu', false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(gains, [0.125, 0.125, 0.125, 0.125, 0.25, 0.5])
    assert.deepEqual(files, ['/audio/beep.mp3', '/audio/sfx-button-press.mp3'])
    assert.deepEqual(samples, [
      { rate: 0.9, start: [0, 0.26, 0.48] },
      { rate: 1, start: [0, 0, 0.82] },
    ])

    tones.length = 0
    playSfx('coin', false)
    assert.equal(tones.length, 3)
    assert.ok(tones.every((tone, index) => index === 0 || tone.frequency > tones[index - 1].frequency), 'coin insertion rises into the arcade')
    assert.ok(tones.every((tone) => tone.wave === 'square' && tone.attack > tone.start && tone.attack < tone.stop), 'chip tones have a short attack instead of an abrupt click')
    tones.length = 0
    playSfx('countdown', false)
    playSfx('go', false)
    assert.ok(tones.at(-1)!.frequency > tones[0].frequency, 'GO is brighter than the countdown ticks')
    tones.length = 0
    playSfx('perfect', false)
    const perfectPitch = tones[0].frequency
    tones.length = 0
    playSfx('miss', false)
    assert.ok(tones[0].frequency < perfectPitch, 'misses sound different from rewards')
    tones.length = 0
    playSfx('record', false)
    assert.ok(tones.length > 2, 'a personal best earns a fanfare beyond the brief hit judgments')
    assert.ok(tones.at(-1)!.stop < 0.7, 'the fanfare finishes quickly instead of covering the music')
    const beforeMuted = [tones.length, samples.length, files.length]
    playSfx('coin', true)
    playSfx('confirm', true)
    playSfx('menu', true)
    playSfx('record', true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual([tones.length, samples.length, files.length], beforeMuted, 'mute covers synthesized and sampled feedback')
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
