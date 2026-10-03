import type { Focus } from './angles.ts'
import { buildCueChart, type Difficulty } from './hitTargets.ts'
import { motionIntervalsForCues, motionLagLimit, referenceMotionFrames } from './motionScore.ts'
import { visualCues, type SongEdit } from '../lib/songEdits.ts'
import type { PoseTrack } from './track.ts'
import { isBpmMap, type BeatMap } from '../lib/beatMaps.ts'

/** One chart owns both the circles the player sees and the movements judged. */
export function buildArcadeChart(track: PoseTrack | null | undefined, difficulty: Difficulty, focus: Focus, head: boolean, edit?: SongEdit | null, manualBeats?: BeatMap | null) {
  const frames = track ? referenceMotionFrames(track) : []
  const end = track ? track.frames / track.fps : 0
  const map = manualBeats ?? edit?.lighting
  const beats = isBpmMap(map) ? new Float32Array(Array.from(
    { length: Math.max(0, Math.floor((end - map.start) * map.bpm / 60) + 1) },
    (_, index) => map.start + index * 60 / map.bpm,
  )) : map && 'marks' in map ? new Float32Array(map.marks.map((mark) => mark.time))
    : track?.beatConfidence === undefined || track.beatConfidence >= 0.45 ? track?.beats : undefined
  const generated = track ? buildCueChart({ ...track, beats }, difficulty, head, focus, motionLagLimit(difficulty) + 0.02) : []
  const candidates = visualCues(edit, generated, difficulty, focus, head).map((cue) => ({
    ...cue, id: cue.id ?? `${cue.kind}:${cue.kind === 'clap' ? 'hands' : cue.joint}:${cue.poseTime}:${cue.time}`,
  }))
  const intervals = motionIntervalsForCues(candidates, edit?.start ?? 0)
    .filter((interval) => interval.start >= (edit?.start ?? 0) && interval.end <= end
      && interval.end <= (edit?.end ?? end))
  return { frames, intervals, cues: intervals.map((interval) => interval.cue!), beats }
}
