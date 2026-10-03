export type SfxEvent = 'coin' | 'confirm' | 'menu' | 'navigateLeft' | 'navigateRight' | 'gestureOne' | 'gestureTwo' | 'gestureThree' | 'countdown' | 'go' | 'perfect' | 'good' | 'miss' | 'combo' | 'result' | 'record'

const NOTES: Record<SfxEvent, { frequencies: number[]; duration: number; gain: number; step?: number; wave?: OscillatorType }> = {
  coin: { frequencies: [1047, 1568, 2093], duration: 0.13, gain: 0.06, step: 0.055, wave: 'square' },
  confirm: { frequencies: [523, 784], duration: 0.12, gain: 0.055, step: 0.055, wave: 'square' },
  menu: { frequencies: [330], duration: 0.05, gain: 0.035 },
  navigateLeft: { frequencies: [440, 349], duration: 0.07, gain: 0.125 },
  navigateRight: { frequencies: [349, 440], duration: 0.07, gain: 0.125 },
  gestureOne: { frequencies: [523], duration: 0.1, gain: 0.25 },
  gestureTwo: { frequencies: [659], duration: 0.1, gain: 0.25 },
  gestureThree: { frequencies: [784], duration: 0.1, gain: 0.25 },
  countdown: { frequencies: [440], duration: 0.08, gain: 0.05 },
  go: { frequencies: [523, 1047], duration: 0.18, gain: 0.06, step: 0.09, wave: 'square' },
  perfect: { frequencies: [660, 880], duration: 0.11, gain: 0.045 },
  good: { frequencies: [440], duration: 0.08, gain: 0.035 },
  miss: { frequencies: [110], duration: 0.1, gain: 0.018 },
  combo: { frequencies: [659, 784, 1047], duration: 0.12, gain: 0.05, step: 0.065 },
  result: { frequencies: [392, 523, 659, 784], duration: 0.22, gain: 0.055, step: 0.085 },
  record: { frequencies: [523, 659, 784, 1047, 784, 1047], duration: 0.18, gain: 0.055, step: 0.09, wave: 'square' },
}

const SAMPLES: Partial<Record<SfxEvent, { file: string; gain: number; rate: number; offset: number; duration: number }>> = {
  menu: { file: 'sfx-button-press.mp3', gain: 0.5, rate: 1, offset: 0, duration: 0.82 },
  gestureOne: { file: 'beep.mp3', gain: 0.25, rate: 0.9, offset: 0.26, duration: 0.48 },
  gestureTwo: { file: 'beep.mp3', gain: 0.25, rate: 1, offset: 0.26, duration: 0.48 },
  gestureThree: { file: 'beep.mp3', gain: 0.25, rate: 1.12, offset: 0.26, duration: 0.48 },
}

let context: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer>>()

function playTone(event: SfxEvent) {
  const profile = NOTES[event]
  const start = context!.currentTime
  profile.frequencies.forEach((frequency, index) => {
    const oscillator = context!.createOscillator()
    const gain = context!.createGain()
    const noteStart = start + index * (profile.step ?? Math.min(0.07, profile.duration / profile.frequencies.length))
    oscillator.type = profile.wave ?? (event === 'countdown' || event.startsWith('gesture') ? 'square' : 'triangle')
    oscillator.frequency.setValueAtTime(frequency, noteStart)
    gain.gain.setValueAtTime(0.0001, noteStart)
    gain.gain.linearRampToValueAtTime(profile.gain, noteStart + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + profile.duration)
    oscillator.connect(gain).connect(context!.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteStart + profile.duration)
  })
}

function loadSample(file: string) {
  let buffer = buffers.get(file)
  if (!buffer) {
    buffer = window.fetch(`${import.meta.env?.BASE_URL ?? '/'}audio/${file}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${file}`)
        return response.arrayBuffer()
      })
      .then((data) => context!.decodeAudioData(data))
      .catch((error) => {
        buffers.delete(file)
        throw error
      })
    buffers.set(file, buffer)
  }
  return buffer
}

export function playSfx(event: SfxEvent, muted: boolean) {
  if (muted || typeof window === 'undefined') return
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  context ??= new AudioContextClass()
  if (context.state === 'suspended') void context.resume()

  const sample = SAMPLES[event]
  if (sample && typeof window.fetch === 'function' && 'decodeAudioData' in context && 'createBufferSource' in context) {
    void loadSample(sample.file).then((buffer) => {
      const source = context!.createBufferSource()
      const gain = context!.createGain()
      source.buffer = buffer
      source.playbackRate.value = sample.rate
      gain.gain.setValueAtTime(sample.gain, context!.currentTime)
      source.connect(gain).connect(context!.destination)
      source.start(context!.currentTime, sample.offset, sample.duration)
    }).catch(() => playTone(event))
    return
  }
  playTone(event)
}
