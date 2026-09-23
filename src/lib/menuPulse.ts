/** Fade a visual accent from the previous beat in playback time, including after a seek or loop. */
export function beatPulseAt(beats: Float32Array, time: number, decaySeconds = 0.34): number {
  let low = 0
  let high = beats.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (beats[middle] <= time) low = middle + 1
    else high = middle
  }
  if (!low) return 0
  return Math.max(0, 1 - (time - beats[low - 1]) / decaySeconds)
}
