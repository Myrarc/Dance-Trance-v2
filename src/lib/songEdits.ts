import { readBeatMap, writeBeatMap, commitSongEdit } from './library.ts'
import { isBpmMap, normalizeMarks, type BeatMap } from './beatMaps.ts'
import type { CueEvent, Difficulty, HitJoint } from '../pose/hitTargets.ts'
import type { Focus } from '../pose/angles.ts'

export interface VisualMarker {
  id: string
  kind: 'spot' | 'hold' | 'clap'
  joint: HitJoint
  time: number
  duration: number
  x: number
  y: number
}
export interface SongEdit {
  version: 1
  duration: number
  start: number
  end: number
  charts: Partial<Record<Difficulty, VisualMarker[]>>
  lighting: BeatMap | null
}
export const songEditKey = (id: string) => `song-edit:${id}`
export const songDraftKey = (id: string) => `song-draft:${id}`
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function validateSongEdit(value: unknown): SongEdit {
  const edit = value as SongEdit
  if (!edit || edit.version !== 1 || !finite(edit.duration) || edit.duration <= 0 ||
    !finite(edit.start) || !finite(edit.end) || edit.start < 0 || edit.end > edit.duration ||
    edit.end - edit.start < 0.1 || !edit.charts || typeof edit.charts !== 'object') throw new Error('Invalid video trim range.')
  for (const level of ['easy', 'normal', 'hard'] as const) {
    const markers = edit.charts[level]
    if (markers === undefined) continue
    if (!Array.isArray(markers)) throw new Error('Invalid marker chart.')
    const ids = new Set<string>()
    for (const marker of markers) {
      if (!marker || typeof marker.id !== 'string' || !marker.id || ids.has(marker.id) ||
        !['spot', 'hold', 'clap'].includes(marker.kind) || !['head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'].includes(marker.joint) ||
        !finite(marker.time) || marker.time < 0 || marker.time > edit.duration ||
        !finite(marker.x) || marker.x < 0 || marker.x > 1 || !finite(marker.y) || marker.y < 0 || marker.y > 1 ||
        !finite(marker.duration) || marker.duration < 0 || (marker.kind === 'hold' && (marker.duration < 0.05 || marker.time + marker.duration > edit.duration))) {
        throw new Error('Marker timing, position, or duration is invalid.')
      }
      ids.add(marker.id)
    }
  }
  if (edit.lighting !== null && !isBpmMap(edit.lighting)) {
    if (!edit.lighting || !Array.isArray(edit.lighting.marks) || normalizeMarks(edit.lighting.marks).length !== edit.lighting.marks.length ||
      edit.lighting.marks.some((mark) => mark.time > edit.duration)) throw new Error('Invalid lighting marks.')
  }
  return structuredClone(edit)
}

export async function loadSongEdit(id: string, draft = false): Promise<SongEdit | null> {
  const value = await readBeatMap(draft ? songDraftKey(id) : songEditKey(id))
  return value ? validateSongEdit(value) : null
}
export async function saveSongDraft(id: string, edit: SongEdit) {
  await writeBeatMap(songDraftKey(id), validateSongEdit(edit))
}
export async function saveSongEdit(id: string, edit: SongEdit) {
  const saved = validateSongEdit(edit)
  await commitSongEdit(id, saved, saved.lighting)
  return saved
}
export function markerFromCue(cue: CueEvent, id: string): VisualMarker {
  return { id, kind: cue.kind, joint: cue.kind === 'clap' ? 'leftHand' : cue.joint,
    time: cue.time, duration: cue.kind === 'hold' ? cue.duration : 0, x: cue.x, y: cue.y }
}
export function visualCues(edit: SongEdit | null | undefined, generated: CueEvent[], difficulty: Difficulty, focus: Focus, head: boolean): CueEvent[] {
  const authored = edit?.charts[difficulty]
  const cues: CueEvent[] = authored === undefined ? generated : authored.map((marker) => {
    const base = { time: marker.time, poseTime: marker.time, x: marker.x, y: marker.y, confidence: 1, feature: {} }
    return marker.kind === 'clap' ? { ...base, kind: 'clap', expectedGap: 0 } :
      marker.kind === 'hold' ? { ...base, kind: 'hold', joint: marker.joint, duration: marker.duration } :
        { ...base, kind: 'spot', joint: marker.joint }
  })
  return cues.filter((cue) => (!edit || (cue.time >= edit.start && cue.time <= edit.end)) &&
    (cue.kind === 'clap' ? focus !== 'lower' : (head || cue.joint !== 'head') &&
      (focus === 'full' || (focus === 'upper' ? !cue.joint.endsWith('Foot') : cue.joint.endsWith('Foot')))))
    .sort((a, b) => a.time - b.time)
}
export type PreviewPart = 'head' | 'hands' | 'feet'
export const cuePreviewPart = (cue: CueEvent): PreviewPart => cue.kind === 'clap' || cue.joint.endsWith('Hand') ? 'hands' : cue.joint.endsWith('Foot') ? 'feet' : 'head'
export function filterPreviewCues(cues: CueEvent[], visible: Record<PreviewPart, boolean>) {
  return cues.filter((cue) => visible[cuePreviewPart(cue)])
}
export const isTrimmed = (edit: SongEdit | null) => !!edit && (edit.start > 0.01 || edit.end < edit.duration - 0.01)
export function withinTrim<T extends { start: number; end: number }>(intervals: T[], edit?: Pick<SongEdit, 'start' | 'end'> | null): T[] {
  return edit ? intervals.filter((interval) => interval.start >= edit.start && interval.end <= edit.end) : intervals
}
