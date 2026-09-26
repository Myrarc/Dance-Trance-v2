import { HIT_LEAD_S, type CueEvent } from '../pose/hitTargets.ts'

export const KIOSK_TITLE_MS = 12_000
export const KIOSK_PLAY_MS = 30_000

export function kioskFrame(cues: CueEvent[], time: number, start: number) {
  const eligible = cues.filter((cue) => cue.time >= start)
  return {
    hits: eligible.filter((cue) => cue.time <= time).length,
    visible: eligible.filter((cue) => cue.time >= time - 0.45 && cue.time <= time + HIT_LEAD_S),
  }
}
