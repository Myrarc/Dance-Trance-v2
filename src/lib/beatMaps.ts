import { deleteBeatMap, readBeatMap, writeBeatMap } from './library.ts'

export type BeatKind = 'beat' | 'accent' | 'burst'
export interface BeatMark { time: number; kind: BeatKind }
export interface BeatMap { marks: BeatMark[] }

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
  if (!stored || typeof stored !== 'object' || !('marks' in stored)) return null
  const marks = normalizeMarks(stored.marks)
  return marks.length ? { marks } : null
}

export async function saveBeatMap(key: string, marks: BeatMark[]): Promise<BeatMap> {
  const ordered = normalizeMarks(marks)
  if (!ordered.length) throw new Error('Add at least one beat before saving.')
  const map = { marks: ordered }
  await writeBeatMap(key, map)
  return map
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
