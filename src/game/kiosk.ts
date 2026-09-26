import { HIT_LEAD_S, type CueEvent } from '../pose/hitTargets.ts'

export const KIOSK_TITLE_MS = 12_000
export const KIOSK_PLAY_MS = 30_000

export function kioskSongOrder<T extends { id: string }>(songs: readonly T[], previousId: string | null, random = Math.random): T[] {
  const candidates = songs.filter((song) => song.id !== previousId)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const candidate = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = candidate
  }
  // Keep the previous demo as a fallback if every other song is unavailable.
  return [...candidates, ...songs.filter((song) => song.id === previousId)]
}

export function kioskFrame(cues: CueEvent[], time: number, start: number) {
  const eligible = cues.filter((cue) => cue.time >= start)
  return {
    hits: eligible.filter((cue) => cue.time <= time).length,
    visible: eligible.filter((cue) => cue.time >= time - 0.45 && cue.time <= time + HIT_LEAD_S),
  }
}
