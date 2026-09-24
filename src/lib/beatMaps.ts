import { deleteBeatMap, readBeatMap, writeBeatMap } from './library.ts'

export type BeatKind = 'beat' | 'accent' | 'burst'
export interface BeatMark { time: number; kind: BeatKind }
export type BeatMap = { marks: BeatMark[] } | { bpm: number; start: number }

export const themeBeatKey = (id: string) => `theme:${id}`
export const songBeatKey = (id: string) => `song:${id}`

export function normalizeMarks(value: unknown): BeatMark[] {
  if (!Array.isArray(value)) return []
  return value.filter((mark): mark is BeatMark =>
    !!mark && typeof mark === 'object' && typeof mark.time === 'number' &&
    Number.isFinite(mark.time) && mark.time >= 0 &&
    (mark.kind === 'beat' || mark.kind === 'accent' || mark.kind === 'burst'))
    .map(({ time, kind }) => ({ time, kind }))
    .sort((a, b) => a.time - b.time)
}

export async function loadBeatMap(key: string): Promise<BeatMap | null> {
  const stored = await readBeatMap(key)
  if (isBpmMap(stored)) return { bpm: stored.bpm, start: stored.start }
  if (!stored || typeof stored !== 'object' || !('marks' in stored)) return null
  const marks = normalizeMarks(stored.marks)
  return marks.length ? { marks } : null
}

export function isBpmMap(value: unknown): value is { bpm: number; start: number } {
  if (!value || typeof value !== 'object') return false
  const map = value as { bpm?: unknown; start?: unknown }
  return typeof map.bpm === 'number' && Number.isFinite(map.bpm) && map.bpm >= 30 && map.bpm <= 300 &&
    typeof map.start === 'number' && Number.isFinite(map.start) && map.start >= 0
}

export async function saveBeatMap(key: string, map: BeatMap): Promise<BeatMap> {
  if (isBpmMap(map)) {
    await writeBeatMap(key, map)
    return map
  }
  const ordered = normalizeMarks(map.marks)
  if (!ordered.length) throw new Error('Add at least one beat before saving.')
  const saved = { marks: ordered }
  await writeBeatMap(key, saved)
  return saved
}

export async function restoreAutomaticBeats(key: string): Promise<void> {
  await deleteBeatMap(key)
}

/** Sample the most recent manually timed mark at the media playback time. */
export function manualGlowAt(marks: BeatMark[], time: number, decaySeconds = .34): { mark: BeatMark; pulse: number } | null {
  let low = 0
  let high = marks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (marks[middle].time <= time) low = middle + 1
    else high = middle
  }
  if (!low) return null
  const last = marks[low - 1]
  const pulse = Math.max(0, 1 - (time - last.time) / decaySeconds) *
    (last.kind === 'burst' ? 1.45 : last.kind === 'accent' ? 1 : .65)
  return pulse > 0 ? { mark: last, pulse } : null
}

/** Seeking before a mark or beyond its decay returns zero. */
export function manualPulseAt(marks: BeatMark[], time: number, decaySeconds = .34): number {
  return manualGlowAt(marks, time, decaySeconds)?.pulse ?? 0
}

export function beatGlowAt(map: BeatMap, time: number): { mark: BeatMark; pulse: number } | null {
  if ('marks' in map) return manualGlowAt(map.marks, time)
  if (time < map.start || !isBpmMap(map)) return null
  const interval = 60 / map.bpm
  const beatTime = map.start + Math.floor((time - map.start) / interval + 1e-9) * interval
  const pulse = Math.max(0, Math.min(1, 1 - (time - beatTime) / Math.min(.34, interval)))
  return pulse > 0 ? { mark: { time: beatTime, kind: 'beat' }, pulse } : null
}

export function tapTempo(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const last = taps.at(-1)
  if (last !== undefined && now - last < 150) return { taps, bpm: null }
  const next = [...(last !== undefined && now - last <= 2000 ? taps.slice(-4) : []), now]
  const bpm = next.length > 1 ? Math.round(60000 * (next.length - 1) / (now - next[0])) : null
  return { taps: next, bpm: bpm !== null && bpm >= 30 && bpm <= 300 ? bpm : null }
}
