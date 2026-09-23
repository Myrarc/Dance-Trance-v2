export type SfxEvent = 'menu' | 'navigateLeft' | 'navigateRight' | 'gestureOne' | 'gestureTwo' | 'gestureThree' | 'countdown' | 'go' | 'perfect' | 'good' | 'combo' | 'result' | 'record'

const NOTES: Record<SfxEvent, { frequencies: number[]; duration: number; gain: number }> = {
  menu: { frequencies: [330], duration: 0.05, gain: 0.035 },
  navigateLeft: { frequencies: [440, 349], duration: 0.07, gain: 0.125 },
  navigateRight: { frequencies: [349, 440], duration: 0.07, gain: 0.125 },
  gestureOne: { frequencies: [523], duration: 0.1, gain: 0.25 },
  gestureTwo: { frequencies: [659], duration: 0.1, gain: 0.25 },
  gestureThree: { frequencies: [784], duration: 0.1, gain: 0.25 },
  countdown: { frequencies: [220], duration: 0.08, gain: 0.05 },
  go: { frequencies: [330, 494], duration: 0.14, gain: 0.06 },
  perfect: { frequencies: [660, 880], duration: 0.11, gain: 0.045 },
  good: { frequencies: [440], duration: 0.08, gain: 0.035 },
  combo: { frequencies: [523, 659, 784], duration: 0.16, gain: 0.05 },
  result: { frequencies: [262, 330, 392], duration: 0.28, gain: 0.055 },
  record: { frequencies: [523, 659, 784, 1047], duration: 0.34, gain: 0.06 },
}

let context: AudioContext | null = null

export function playSfx(event: SfxEvent, muted: boolean) {
  if (muted || typeof window === 'undefined') return
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  context ??= new AudioContextClass()
  if (context.state === 'suspended') void context.resume()

  const profile = NOTES[event]
  const start = context.currentTime
  profile.frequencies.forEach((frequency, index) => {
    const oscillator = context!.createOscillator()
    const gain = context!.createGain()
    const noteStart = start + index * Math.min(0.07, profile.duration / profile.frequencies.length)
    oscillator.type = event === 'countdown' || event.startsWith('gesture') ? 'square' : 'triangle'
    oscillator.frequency.setValueAtTime(frequency, noteStart)
    gain.gain.setValueAtTime(profile.gain, noteStart)
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + profile.duration)
    oscillator.connect(gain).connect(context!.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteStart + profile.duration)
  })
}
