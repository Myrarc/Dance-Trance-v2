import { useEffect, useMemo, useRef, useState } from 'react'
import { fingerprint, getTrack, getVideo, remember, deleteBeatMap, readBeatMap, saveTrackCorrections, writeBeatMap, type LibraryEntry, type StoredTrack } from '../lib/library'
import { loadBeatMap, beatGlowAt, type BeatKind, type BeatMark } from '../lib/beatMaps'
import { copyMarkerSequence, cuePreviewPart, filterPreviewCues, loadSongEdit, markerFromCue, markerRange, pasteMarkerSequence, saveSongDraft, saveSongEdit, songDraftKey, visualCues, type MarkerSequenceItem, type PreviewPart, type SongEdit, type VisualMarker } from '../lib/songEdits'
import { buildCueChart, HIT_LEAD_S, type CueEvent, type Difficulty, type HitJoint } from '../pose/hitTargets'
import { sampleTrack, unpackTrack, type PoseTrack } from '../pose/track'
import { cueColor, drawArcadeHitMarker, drawArcadeHitLabel, drawCueGlyph } from '../pose/arcade'
import { drawSkeleton, SIDE_COLORS } from '../pose/skeleton'
import { brushPoseCorrection, type PoseCorrection } from '../pose/poseCorrections'
import { editorWaveform } from '../lib/editorWaveform'
import './SongEditor.css'

const timeLabel = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(3).padStart(6, '0')}`
const joints: HitJoint[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head']
const jointLabel = (joint: string) => joint.replace(/([A-Z])/g, ' $1').toLowerCase()
const cueKey = (cue: CueEvent) => `${cue.kind}:${cue.kind === 'clap' ? 'hands' : cue.joint}:${cue.time.toFixed(4)}`
const correctionDraftKey = (id: string) => `pose-correction-draft:${id}`
const adjustableJoints = [
  { label: 'H', landmarks: [0, 7, 8] },
  { label: 'LS', landmarks: [11] }, { label: 'RS', landmarks: [12] },
  { label: 'LE', landmarks: [13] }, { label: 'RE', landmarks: [14] },
  { label: 'LW', landmarks: [15] }, { label: 'RW', landmarks: [16] },
  { label: 'LH', landmarks: [23] }, { label: 'RH', landmarks: [24] },
  { label: 'LK', landmarks: [25] }, { label: 'RK', landmarks: [26] },
  { label: 'LA', landmarks: [27] }, { label: 'RA', landmarks: [28] },
]
const validCorrections = (value: unknown): PoseCorrection[] => Array.isArray(value) ? value.filter((item): item is PoseCorrection => {
  if (!item || typeof item !== 'object') return false
  const correction = item as Partial<PoseCorrection>
  return [correction.frame, correction.landmark, correction.x, correction.y, correction.worldX, correction.worldY].every(Number.isFinite)
}) : []
function lightsFor(edit: SongEdit): BeatMark[] {
  const map = edit.lighting
  if (!map) return []
  if ('marks' in map) return map.marks
  return Array.from({ length: Math.min(10000, Math.max(0, Math.ceil((edit.duration - map.start) * map.bpm / 60))) }, (_, i) => ({ time: map.start + i * 60 / map.bpm, kind: 'beat' }))
}

export default function SongEditor({ entry, onClose, onSaved, reducedEffects }: {
  entry: LibraryEntry; onClose: () => void; onSaved: () => void; reducedEffects: boolean
}) {
  const [edit, setEdit] = useState<SongEdit | null>(null)
  const [baseline, setBaseline] = useState('')
  const [source, setSource] = useState<Blob | null>(null)
  const [url, setUrl] = useState('')
  const [track, setTrack] = useState<PoseTrack | null>(null)
  const [storedTrack, setStoredTrack] = useState<StoredTrack | null>(null)
  const [corrections, setCorrections] = useState<PoseCorrection[]>([])
  const [correctionBaseline, setCorrectionBaseline] = useState('[]')
  const [correctionUndo, setCorrectionUndo] = useState<PoseCorrection[][]>([])
  const [correctionRedo, setCorrectionRedo] = useState<PoseCorrection[][]>([])
  const [level, setLevel] = useState<Difficulty>('normal')
  const [selected, setSelected] = useState('')
  const [selectedMarkers, setSelectedMarkers] = useState<string[]>([])
  const [markerClipboard, setMarkerClipboard] = useState<MarkerSequenceItem[]>([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [aspect, setAspect] = useState(16 / 9)
  const [rate, setRate] = useState(1)
  const [zoom, setZoom] = useState(60)
  const [bpm, setBpm] = useState(120)
  const [snap, setSnap] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loop, setLoop] = useState(false)
  const [autoHit, setAutoHit] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [showHeadMarkers, setShowHeadMarkers] = useState(true)
  const [showHandMarkers, setShowHandMarkers] = useState(true)
  const [showFootMarkers, setShowFootMarkers] = useState(true)
  const [adjustSkeleton, setAdjustSkeleton] = useState(false)
  const [previewHit, setPreviewHit] = useState<{ key: string; expiresAt: number } | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [status, setStatus] = useState('Opening local song…')
  const [waveStatus, setWaveStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [undo, setUndo] = useState<SongEdit[]>([])
  const [redo, setRedo] = useState<SongEdit[]>([])
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionAnchor = useRef('')
  const writes = useRef(Promise.resolve())
  const editDirty = !!edit && JSON.stringify(edit) !== baseline
  const correctionDirty = JSON.stringify(corrections) !== correctionBaseline
  const dirty = editDirty || correctionDirty
  const generated = useMemo(() => track ? buildCueChart(track, level, true, 'full').map((cue, index) => markerFromCue(cue, `generated-${level}-${index}`)) : [], [track, level])
  const markers = edit?.charts[level] ?? generated
  const cues = useMemo(() => edit ? visualCues({ ...edit, charts: { ...edit.charts, [level]: markers } }, [], level, 'full', true) : [], [edit, level, markers])
  const visibleCues = useMemo(() => filterPreviewCues(cues, { head: showHeadMarkers, hands: showHandMarkers, feet: showFootMarkers }), [cues, showHeadMarkers, showHandMarkers, showFootMarkers])
  const lights = useMemo(() => edit ? lightsFor(edit) : [], [edit])
  const marker = markers.find((item) => item.id === selected)
  const markerVisible = !!marker && (marker.kind === 'clap' || marker.joint.endsWith('Hand') ? showHandMarkers : marker.joint.endsWith('Foot') ? showFootMarkers : showHeadMarkers)
  const lightIndex = selected.startsWith('light:') ? Number(selected.slice(6)) : -1
  const light = lights[lightIndex]

  useEffect(() => {
    let stopped = false
    root.current?.focus()
    void Promise.all([getVideo(entry.id), getTrack(entry.id), loadSongEdit(entry.id), loadSongEdit(entry.id, true), loadBeatMap(`song:${entry.id}`), readBeatMap(correctionDraftKey(entry.id))])
      .then(([blob, stored, saved, draft, lighting, correctionDraft]) => {
        if (stopped) return
        const savedCorrections = stored?.corrections ?? []
        const draftCorrections = validCorrections(correctionDraft)
        const activeCorrections = correctionDraft == null ? savedCorrections : draftCorrections
        const decoded = stored && unpackTrack({ ...stored, corrections: activeCorrections })
        const initial = saved ? { ...saved, lighting } : { version: 1 as const, duration: entry.duration, start: 0, end: entry.duration, charts: {}, lighting }
        setSource(blob)
        setStoredTrack(stored)
        setTrack(decoded)
        setCorrections(activeCorrections)
        setCorrectionBaseline(JSON.stringify(savedCorrections))
        setBpm(decoded?.bpm ?? 120)
        setEdit(draft ?? initial)
        setBaseline(JSON.stringify(initial))
        setStatus(draft || correctionDraft != null ? 'Recovered your local draft. Autosave will apply it.' : 'Visual markers guide the player. Skeleton corrections change reference scoring.')
      }).catch((error) => { if (!stopped) setStatus(`Could not open editor: ${String(error)}`) })
    return () => { stopped = true }
  }, [entry.id, entry.duration])
  useEffect(() => {
    if (!source) return
    const next = URL.createObjectURL(source)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [source])
  useEffect(() => {
    if (!source || !edit?.duration) return
    let stopped = false
    setWaveStatus('Building waveform…')
    void editorWaveform(source, edit.duration, () => stopped).then((result) => {
      if (!stopped) { setPeaks(result); setWaveStatus('') }
    }).catch(() => { if (!stopped) setWaveStatus('Waveform unavailable for this codec; video and marker editing still work.') })
    return () => { stopped = true }
  }, [source, edit?.duration])
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  useEffect(() => {
    const media = video.current
    const canvas = overlay.current
    if (!media || !canvas || !edit) return
    let frame = 0
    let lastTick = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (media.currentTime >= edit.end && !media.paused) {
        if (loop) media.currentTime = edit.start
        else media.pause()
      }
      if (now - lastTick > 80) { setTime(media.currentTime); lastTick = now }
      if (!media.videoWidth) return
      canvas.width = media.videoWidth
      canvas.height = media.videoHeight
      const ctx = canvas.getContext('2d')!
      const radius = Math.max(28, canvas.height * 0.052)
      const reduced = reducedEffects || matchMedia('(prefers-reduced-motion: reduce)').matches
      const poseTime = adjustSkeleton && track ? Math.round(media.currentTime * track.fps) / track.fps : media.currentTime
      const pose = showSkeleton && track ? sampleTrack(track, poseTime) : null
      if (pose) {
        drawSkeleton(ctx, pose.landmarks, canvas.width, canvas.height, {
          lineWidth: Math.max(4, canvas.height * .008),
          sideColors: SIDE_COLORS,
          glow: !reduced,
        })
        if (adjustSkeleton) {
          ctx.font = `800 ${Math.max(10, canvas.height * .015)}px system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          for (const joint of adjustableJoints) {
            const point = pose.landmarks[joint.landmarks[0]]
            if (!point || point.visibility < .2) continue
            const x = point.x * canvas.width, y = point.y * canvas.height
            const handleRadius = Math.max(11, canvas.height * .017)
            ctx.beginPath(); ctx.arc(x, y, handleRadius, 0, Math.PI * 2)
            ctx.fillStyle = '#fff7e0'; ctx.fill()
            ctx.strokeStyle = '#30213f'; ctx.lineWidth = Math.max(3, canvas.height * .004); ctx.stroke()
            ctx.fillStyle = '#30213f'; ctx.fillText(joint.label, x, y)
          }
        }
      }
      if (!adjustSkeleton) {
        for (const cue of visibleCues) {
          if (cue.time < media.currentTime - 0.45 || cue.time > media.currentTime + HIT_LEAD_S) continue
          const x = cue.x * canvas.width, y = cue.y * canvas.height
          drawArcadeHitMarker(ctx, x, y, radius, cueColor(cue), cue.time - media.currentTime, reduced)
          drawCueGlyph(ctx, cue, x, y, radius, media.currentTime)
          if ((autoHit && cue.time <= media.currentTime) || (previewHit?.key === cueKey(cue) && now <= previewHit.expiresAt)) drawArcadeHitLabel(ctx, x, y, radius, 'perfect')
        }
        if (marker && markerVisible) {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 4
          ctx.strokeRect(marker.x * canvas.width - radius, marker.y * canvas.height - radius, radius * 2, radius * 2)
        }
        const glow = edit.lighting && !reduced ? beatGlowAt(edit.lighting, media.currentTime) : null
        if (glow) {
          ctx.strokeStyle = glow.mark.kind === 'burst' ? '#ffd45a' : '#2ec4c6'
          ctx.globalAlpha = glow.pulse * .7
          ctx.lineWidth = glow.mark.kind === 'burst' ? 40 : glow.mark.kind === 'accent' ? 25 : 12
          ctx.strokeRect(0, 0, canvas.width, canvas.height)
        }
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [edit, visibleCues, marker, markerVisible, loop, autoHit, previewHit, showSkeleton, adjustSkeleton, track, reducedEffects, url])

  const change = (next: SongEdit) => { if (edit) setUndo((history) => [...history.slice(-79), edit]); setRedo([]); setEdit(next) }
  const seek = (next: number) => { if (video.current && edit) { video.current.currentTime = Math.max(0, Math.min(edit.duration, next)); setTime(video.current.currentTime) } }
  const snapped = (next: number) => !snap ? next : Math.max(0, offset + Math.round((next - offset) / (60 / bpm / snap)) * (60 / bpm / snap))
  const stamp = () => Math.min(edit?.duration ?? 0, snapped(video.current?.currentTime ?? time))
  const patchMarker = (patch: Partial<VisualMarker>) => { if (edit && marker) change({ ...edit, charts: { ...edit.charts, [level]: markers.map((item) => item.id === marker.id ? { ...item, ...patch } : item) } }) }
  const patchLight = (patch: Partial<BeatMark>) => { if (edit && light) change({ ...edit, lighting: { marks: lights.map((item, i) => i === lightIndex ? { ...item, ...patch } : item) } }) }
  const selectMarker = (id: string, options: { toggle?: boolean; range?: boolean } = {}) => {
    if (options.range && selectionAnchor.current) {
      const ids = markerRange(markers, selectionAnchor.current, id)
      setSelectedMarkers(ids)
    } else if (options.toggle) {
      const next = selectedMarkers.includes(id) ? selectedMarkers.filter((item) => item !== id) : [...selectedMarkers, id]
      setSelectedMarkers(next)
      selectionAnchor.current = id
      setSelected(next.includes(id) ? id : next.at(-1) ?? '')
      return
    } else {
      setSelectedMarkers([id])
      selectionAnchor.current = id
    }
    setSelected(id)
  }
  const clearMarkerSelection = () => { setSelectedMarkers([]); selectionAnchor.current = '' }
  const copySelectedMarkers = () => {
    const ids = selectedMarkers.length ? selectedMarkers : marker ? [marker.id] : []
    const copied = copyMarkerSequence(markers, ids)
    if (!copied.length) { setStatus('Select one or more hit markers to copy.'); return }
    setMarkerClipboard(copied)
    setStatus(`Copied ${copied.length} hit marker${copied.length === 1 ? '' : 's'} with their relative timing.`)
  }
  const pasteMarkers = () => {
    if (!edit || !markerClipboard.length) return
    const pasted = pasteMarkerSequence(markerClipboard, stamp(), edit.duration)
    change({ ...edit, charts: { ...edit.charts, [level]: [...markers, ...pasted] } })
    const ids = pasted.map((item) => item.id)
    setSelectedMarkers(ids)
    setSelected(ids[0] ?? '')
    selectionAnchor.current = ids[0] ?? ''
    setStatus(`Pasted ${pasted.length} hit marker${pasted.length === 1 ? '' : 's'} at the playhead.`)
  }
  const addMarker = () => {
    if (!edit) return
    const id = crypto.randomUUID()
    change({ ...edit, charts: { ...edit.charts, [level]: [...markers, { id, kind: 'spot', joint: 'rightHand', time: stamp(), duration: 0, x: .5, y: .5 }] } })
    selectMarker(id)
  }
  const addLight = (kind: BeatKind) => { if (edit) { change({ ...edit, lighting: { marks: [...lights, { time: stamp(), kind }] } }); clearMarkerSelection(); setSelected(`light:${lights.length}`) } }
  const remove = () => {
    if (!edit) return
    if (marker) {
      const ids = new Set(selectedMarkers.length ? selectedMarkers : [marker.id])
      change({ ...edit, charts: { ...edit.charts, [level]: markers.filter((item) => !ids.has(item.id)) } })
    }
    else if (light) change({ ...edit, lighting: { marks: lights.filter((_, i) => i !== lightIndex) } })
    setSelected('')
    clearMarkerSelection()
  }
  const duplicate = () => {
    if (!edit) return
    if (marker) {
      const ids = selectedMarkers.length ? selectedMarkers : [marker.id]
      const copied = copyMarkerSequence(markers, ids)
      const firstTime = Math.min(...markers.filter((item) => ids.includes(item.id)).map((item) => item.time))
      const span = Math.max(...copied.map((item) => item.time + (item.kind === 'hold' ? item.duration : 0)))
      const pasted = pasteMarkerSequence(copied, firstTime + span + .25, edit.duration)
      change({ ...edit, charts: { ...edit.charts, [level]: [...markers, ...pasted] } })
      const pastedIds = pasted.map((item) => item.id)
      setSelectedMarkers(pastedIds); setSelected(pastedIds[0] ?? '')
    }
    else if (light) { change({ ...edit, lighting: { marks: [...lights, { ...light }] } }); setSelected(`light:${lights.length}`) }
  }
  const undoEdit = () => { const previous = undo.at(-1); if (previous && edit) { setRedo((history) => [...history, edit]); setUndo(undo.slice(0, -1)); setEdit(previous); setSelected(''); clearMarkerSelection() } }
  const redoEdit = () => { const next = redo.at(-1); if (next && edit) { setUndo((history) => [...history, edit]); setRedo(redo.slice(0, -1)); setEdit(next); setSelected(''); clearMarkerSelection() } }
  const showCorrections = (next: PoseCorrection[]) => {
    setCorrections(next)
    if (storedTrack) setTrack(unpackTrack({ ...storedTrack, corrections: next }))
  }
  const changeCorrections = (next: PoseCorrection[]) => {
    setCorrectionUndo((history) => [...history.slice(-79), corrections])
    setCorrectionRedo([])
    showCorrections(next)
  }
  const undoCorrection = () => {
    const previous = correctionUndo.at(-1)
    if (!previous) return
    setCorrectionRedo((history) => [...history, corrections])
    setCorrectionUndo(correctionUndo.slice(0, -1))
    showCorrections(previous)
  }
  const redoCorrection = () => {
    const next = correctionRedo.at(-1)
    if (!next) return
    setCorrectionUndo((history) => [...history, corrections])
    setCorrectionRedo(correctionRedo.slice(0, -1))
    showCorrections(next)
  }
  const correctionFrame = () => track ? Math.max(0, Math.min(track.frames - 1, Math.round((video.current?.currentTime ?? time) * track.fps))) : -1
  const toggleAdjustment = () => {
    if (!track) { setStatus('Reference analysis is not available yet.'); return }
    const next = !adjustSkeleton
    setAdjustSkeleton(next)
    setShowSkeleton(true)
    if (next) {
      video.current?.pause()
      seek(correctionFrame() / track.fps)
      setStatus('Skeleton adjustment is active. Drag a labeled joint; nearby frames blend with the correction.')
    } else setStatus('Skeleton adjustment is off. Corrections autosave and apply to scoring.')
  }
  const toggle = () => {
    const media = video.current
    if (!media || !edit) return
    if (adjustSkeleton) { setStatus('Turn off skeleton adjustment before playing.'); return }
    if (!media.paused) media.pause()
    else { if (media.currentTime < edit.start || media.currentTime >= edit.end) seek(edit.start); void media.play().catch(() => setStatus('Playback failed. Try reselecting the original video.')) }
  }
  const hitPreviewMarker = (part: PreviewPart) => {
    const currentTime = video.current?.currentTime ?? time
    const cue = visibleCues.filter((item) => cuePreviewPart(item) === part && item.time >= currentTime - .45 && item.time <= currentTime + HIT_LEAD_S)
      .sort((a, b) => Math.abs(a.time - currentTime) - Math.abs(b.time - currentTime))[0]
    if (!cue) { setStatus(`No ${part} marker is close to the playhead.`); return }
    setPreviewHit({ key: cueKey(cue), expiresAt: performance.now() + 700 })
  }
  const persist = async (mode: 'save' | 'draft' | 'discard', closeAfter = false) => {
    if (!edit) return
    setBusy(true)
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    const editSnapshot = structuredClone(edit)
    const correctionSnapshot = structuredClone(corrections)
    try {
      await writes.current.catch(() => undefined)
      if (mode === 'discard') { await Promise.all([deleteBeatMap(songDraftKey(entry.id)), deleteBeatMap(correctionDraftKey(entry.id))]); onClose() }
      else if (mode === 'draft') { await Promise.all([saveSongDraft(entry.id, editSnapshot), writeBeatMap(correctionDraftKey(entry.id), correctionSnapshot)]); onClose() }
      else {
        const saved = await saveSongEdit(entry.id, editSnapshot)
        if (storedTrack) await saveTrackCorrections(entry.id, correctionSnapshot)
        await Promise.all([deleteBeatMap(songDraftKey(entry.id)), deleteBeatMap(correctionDraftKey(entry.id))])
        setBaseline(JSON.stringify(saved))
        setCorrectionBaseline(JSON.stringify(correctionSnapshot))
        setStoredTrack((current) => current ? { ...current, corrections: correctionSnapshot } : current)
        setStatus('Saved. Visual chart, trim, lighting, and skeleton corrections are active.')
        onSaved()
        if (closeAfter) onClose()
      }
    } catch (error) { setStatus(`Could not save: ${String(error)}. Your edits are still here.`) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!edit || !dirty || busy) return
    const editSnapshot = structuredClone(edit)
    const correctionSnapshot = structuredClone(corrections)
    const correctionJson = JSON.stringify(correctionSnapshot)
    autosaveTimer.current = setTimeout(() => {
      setSaving(true)
      const pending = writes.current.catch(() => undefined).then(async () => {
        await Promise.all([saveSongDraft(entry.id, editSnapshot), writeBeatMap(correctionDraftKey(entry.id), correctionSnapshot)])
        const saved = await saveSongEdit(entry.id, editSnapshot)
        if (storedTrack) await saveTrackCorrections(entry.id, correctionSnapshot)
        await Promise.all([deleteBeatMap(songDraftKey(entry.id)), deleteBeatMap(correctionDraftKey(entry.id))])
        return saved
      })
      writes.current = pending.then(() => undefined)
      void pending.then((saved) => {
        setBaseline(JSON.stringify(saved))
        setCorrectionBaseline(correctionJson)
        setStoredTrack((current) => current ? { ...current, corrections: correctionSnapshot } : current)
        setStatus('Saved automatically. All editor changes are active.')
        onSaved()
      }).catch((error) => setStatus(`Autosave failed: ${String(error)}. Your edits are still open.`))
        .finally(() => setSaving(false))
    }, 450)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [edit, corrections, dirty, busy, entry.id, storedTrack, onSaved])
  const positionOnTimeline = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(edit?.duration ?? 0, snapped((event.clientX - bounds.left) / zoom)))
  }
  const dragging = useRef<{ id: string; time: number } | null>(null)
  const suppressMarkerClick = useRef(false)
  const draggingJoint = useRef<{
    pointerId: number
    frame: number
    landmarks: number[]
    track: PoseTrack
    corrections: PoseCorrection[]
  } | null>(null)
  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }
  }
  const beginJointDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!adjustSkeleton || !track) return
    const point = pointerPosition(event)
    const frameIndex = correctionFrame()
    const pose = sampleTrack(track, frameIndex / track.fps)
    if (!pose) return
    let nearest: typeof adjustableJoints[number] | null = null
    let nearestDistance = .04
    for (const joint of adjustableJoints) {
      const landmark = pose.landmarks[joint.landmarks[0]]
      const distance = Math.hypot(landmark.x - point.x, landmark.y - point.y)
      if (landmark.visibility >= .2 && distance < nearestDistance) { nearest = joint; nearestDistance = distance }
    }
    if (!nearest) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setCorrectionUndo((history) => [...history.slice(-79), corrections])
    setCorrectionRedo([])
    draggingJoint.current = { pointerId: event.pointerId, frame: frameIndex, landmarks: nearest.landmarks, track, corrections }
  }
  const moveJoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = draggingJoint.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const point = pointerPosition(event)
    showCorrections(brushPoseCorrection(drag.track, drag.corrections, drag.frame, drag.landmarks, point.x, point.y, 3))
  }
  const endJointDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingJoint.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    draggingJoint.current = null
  }

  return <div className="song-editor" role="dialog" aria-modal="true" aria-label="Song editor" tabIndex={-1} ref={root} onKeyDown={(event) => {
    event.stopPropagation()
    if (event.key === 'Tab') {
      const container = confirmClose ? root.current?.querySelector('.editor-confirm') : root.current
      const controls = Array.from(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      return
    }
    if (busy || confirmClose) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void persist('save'); return }
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable="true"]')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelectedMarkers(); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteMarkers(); return }
    if (event.target instanceof HTMLElement && event.target.matches('.editor-marker, .editor-light') && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      const buttons = Array.from(event.target.parentElement!.querySelectorAll<HTMLButtonElement>('button'))
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
      next?.click(); next?.focus()
      return
    }
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (adjustSkeleton) { if (event.shiftKey) redoCorrection(); else undoCorrection() } else if (event.shiftKey) redoEdit(); else undoEdit() }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate() }
    else if (event.code === 'Space') { event.preventDefault(); toggle() }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seek(time + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .1 : 1 / 30)) }
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const target = event.target
      const lane = target instanceof HTMLButtonElement && target.matches('.editor-marker, .editor-light') ? target.parentElement : null
      const index = lane ? Array.from(lane.querySelectorAll('button')).indexOf(target as HTMLButtonElement) : -1
      remove()
      if (lane && index >= 0) requestAnimationFrame(() => {
        const buttons = lane.querySelectorAll<HTMLButtonElement>('button')
        const next = buttons[Math.min(index, buttons.length - 1)]
        next?.click()
        next?.focus()
      })
    }
    else if (!event.repeat && event.key.toLowerCase() === 'a') addMarker()
    else if (!event.repeat && ['z', 'x', 'c'].includes(event.key.toLowerCase())) addLight(event.key.toLowerCase() === 'z' ? 'beat' : event.key.toLowerCase() === 'x' ? 'accent' : 'burst')
  }}>
    <header className="editor-header"><div><small>SONG EDITOR · LOCAL ONLY</small><h1>{entry.name}</h1></div><button className="btn primary" disabled={!edit || busy || saving || !dirty} onClick={() => void persist('save')}>{saving ? 'Saving…' : dirty ? 'Save now' : 'Saved'}</button><button className="btn" disabled={busy || saving} onClick={() => dirty ? void persist('save', true) : onClose()}>Close</button></header>
    <p className="editor-status" role="status">{status}</p>
    {edit && !source && <label className="btn">Reselect original video<input type="file" accept="video/*" onChange={async (event) => {
      const file = event.target.files?.[0]; if (!file) return
      try { if (await fingerprint(file) !== entry.id) throw new Error('Choose the same original video.'); await remember(file); setSource(file); onSaved() }
      catch (error) { setStatus(String(error)) }
    }} /></label>}
    {edit && <fieldset className="editor-body" disabled={busy}>
      <div className="editor-top"><section className="editor-preview">
        <div className="editor-video" style={{ aspectRatio: aspect, width: `min(100%, ${48 * aspect}dvh)` }}>
          <video ref={video} src={url || undefined} playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration
            if (!Number.isFinite(duration) || duration <= 0) return
            setAspect(event.currentTarget.videoWidth / event.currentTarget.videoHeight)
            if (!edit.duration) { const next = { ...edit, duration, end: duration }; setEdit(next); setBaseline(JSON.stringify(next)) }
            event.currentTarget.playbackRate = rate
            seek(edit.start)
          }} />
          <canvas ref={overlay} className={adjustSkeleton ? 'is-adjusting' : ''} aria-label={adjustSkeleton ? 'Reference skeleton adjustment canvas. Drag a labeled joint to correct it.' : 'Marker preview. Select a marker, then click to move its position.'} onPointerDown={beginJointDrag} onPointerMove={moveJoint} onPointerUp={endJointDrag} onPointerCancel={endJointDrag} onClick={(event) => {
            if (adjustSkeleton || !marker) return
            const bounds = event.currentTarget.getBoundingClientRect()
            patchMarker({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height })
          }} />
        </div>
        <div className="editor-tools"><button onClick={() => seek(time - 1 / 30)}>−1/30s</button><button disabled={!url || adjustSkeleton} onClick={toggle}>{playing ? 'Pause' : 'Play'}</button><button onClick={() => seek(time + 1 / 30)}>+1/30s</button><output>{timeLabel(time)}</output><label>Speed<select value={rate} onChange={(event) => { const value = Number(event.target.value); setRate(value); if (video.current) video.current.playbackRate = value }}>{[.25, .5, .75, 1].map((value) => <option key={value}>{value}</option>)}</select></label><label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />Loop trim</label><label><input type="checkbox" checked={autoHit} onChange={(event) => setAutoHit(event.target.checked)} />Auto-hit preview</label><span className="editor-hit-controls" role="group" aria-label="Test marker hits"><b>Test hit</b><button type="button" disabled={!showHeadMarkers} onClick={() => hitPreviewMarker('head')}>Head</button><button type="button" disabled={!showHandMarkers} onClick={() => hitPreviewMarker('hands')}>Hands</button><button type="button" disabled={!showFootMarkers} onClick={() => hitPreviewMarker('feet')}>Feet</button></span><span className="editor-skeleton-controls"><b>Skeleton</b><label><input type="checkbox" checked={showSkeleton} onChange={(event) => setShowSkeleton(event.target.checked)} />Show</label></span><span className="editor-marker-visibility" role="group" aria-label="Hit marker visibility"><b>Hit markers</b><label><input type="checkbox" checked={showHeadMarkers} onChange={(event) => setShowHeadMarkers(event.target.checked)} />Head</label><label><input type="checkbox" checked={showHandMarkers} onChange={(event) => setShowHandMarkers(event.target.checked)} />Hands</label><label><input type="checkbox" checked={showFootMarkers} onChange={(event) => setShowFootMarkers(event.target.checked)} />Feet</label></span></div>
        <div className={`editor-adjust-controls ${adjustSkeleton ? 'active' : ''}`} role="group" aria-label="Skeleton correction controls">
          <button type="button" className={adjustSkeleton ? 'primary' : ''} disabled={!track} aria-pressed={adjustSkeleton} onClick={toggleAdjustment}>{adjustSkeleton ? 'Finish adjusting' : 'Adjust skeleton'}</button>
          <button type="button" disabled={!adjustSkeleton || !correctionUndo.length} onClick={undoCorrection}>Undo adjustment</button>
          <button type="button" disabled={!adjustSkeleton || !correctionRedo.length} onClick={redoCorrection}>Redo adjustment</button>
          <button type="button" disabled={!adjustSkeleton || !corrections.some((item) => item.frame === correctionFrame())} onClick={() => changeCorrections(corrections.filter((item) => item.frame !== correctionFrame()))}>Reset frame</button>
          <button type="button" disabled={!adjustSkeleton || !corrections.length} onClick={() => changeCorrections([])}>Reset all</button>
          <span>{adjustSkeleton ? 'Paused · H head · S shoulder · E elbow · W wrist · H hip · K knee · A ankle · blends ±0.2s' : `${corrections.length} saved or draft landmark adjustments`}</span>
        </div>
      </section><aside className="editor-inspector">
        <h2>Visual chart</h2><label>Difficulty<select value={level} onChange={(event) => { setLevel(event.target.value as Difficulty); setSelected(''); clearMarkerSelection() }}>{['easy', 'normal', 'hard'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <p>{edit.charts[level] === undefined ? 'Using generated markers' : 'Custom markers'} · {markers.length} cues</p>
        {!track && <p>Analysis is not available yet. You can still author markers manually; reopen after preparation to generate them.</p>}
        <div className="editor-tools"><button onClick={addMarker}>Add hit (A)</button><button onClick={() => { change({ ...edit, charts: { ...edit.charts, [level]: [] } }); setSelected(''); clearMarkerSelection() }}>Empty chart</button><button disabled={!track} onClick={() => { const charts = { ...edit.charts }; delete charts[level]; change({ ...edit, charts }); setSelected(''); clearMarkerSelection() }}>Restore generated</button></div>
        <h3>{marker ? 'Selected marker' : light ? 'Selected light' : 'Select a timeline marker'}</h3>
        {(marker || light) && <>
          <label>Hit time (seconds)<input type="number" min={0} max={edit.duration} step={.001} value={(marker ?? light).time} onChange={(event) => marker ? patchMarker({ time: Number(event.target.value) }) : patchLight({ time: Number(event.target.value) })} /></label>
          {marker ? <><label>Type<select value={marker.kind} onChange={(event) => patchMarker({ kind: event.target.value as VisualMarker['kind'], duration: event.target.value === 'hold' ? Math.min(.6, edit.duration - marker.time) : 0 })}><option value="spot">Hit</option><option value="hold">Hold</option><option value="clap">Clap</option></select></label>
            {marker.kind !== 'clap' && <label>Body target<select value={marker.joint} onChange={(event) => patchMarker({ joint: event.target.value as HitJoint })}>{joints.map((joint) => <option key={joint} value={joint}>{jointLabel(joint)}</option>)}</select></label>}
            {marker.kind === 'hold' && <label>Hold duration<input type="number" min={.05} step={.05} value={marker.duration} onChange={(event) => patchMarker({ duration: Number(event.target.value) })} /></label>}
            <div className="editor-tools">{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} %<input type="number" min={0} max={100} step={.1} value={Number((marker[axis] * 100).toFixed(1))} onChange={(event) => patchMarker({ [axis]: Number(event.target.value) / 100 })} /></label>)}</div><small>Click the video to place this marker.</small>
          </> : <label>Strength<select value={light.kind} onChange={(event) => patchLight({ kind: event.target.value as BeatKind })}><option value="beat">Beat</option><option value="accent">Accent</option><option value="burst">Gold burst</option></select></label>}
          <div className="editor-tools"><button onClick={() => marker ? patchMarker({ time: stamp() }) : patchLight({ time: stamp() })}>Set to playhead</button><button onClick={duplicate}>Duplicate</button><button onClick={remove}>Delete</button></div>
        </>}
      </aside></div>
      <section className="editor-timeline-panel"><div className="editor-tools">
        <button disabled={!undo.length} onClick={undoEdit}>Undo</button><button disabled={!redo.length} onClick={redoEdit}>Redo</button>
        <button disabled={!selectedMarkers.length} onClick={copySelectedMarkers}>Copy selected</button><button disabled={!markerClipboard.length} onClick={pasteMarkers}>Paste at playhead</button>
        {!!selectedMarkers.length && <output>{selectedMarkers.length} selected</output>}
        <label>Zoom<input type="range" min={10} max={240} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <label>BPM<input type="number" min={30} max={300} value={bpm} onChange={(event) => setBpm(Math.max(30, Math.min(300, Number(event.target.value) || 120)))} /></label>
        <label>Grid offset<input type="number" min={0} step={.001} value={offset} onChange={(event) => setOffset(Number(event.target.value) || 0)} /></label>
        <label>Snap<select value={snap} onChange={(event) => setSnap(Number(event.target.value))}><option value={0}>Off</option><option value={1}>Beat</option><option value={2}>½ beat</option><option value={4}>¼ beat</option></select></label>
        <button onClick={() => { if (timeline.current) timeline.current.scrollLeft = Math.max(0, time * zoom - timeline.current.clientWidth / 2) }}>Find playhead</button>
      </div><p>{waveStatus || 'Drag to retime. Ctrl/Cmd-click toggles markers; Shift-click selects a range. Ctrl/Cmd+C copies the sequence and Ctrl/Cmd+V pastes it at the playhead.'}</p>
        <div className="editor-timeline-scroll" ref={timeline}><div className="editor-timeline" style={{ width: Math.max(1, edit.duration * zoom), backgroundSize: `${60 / bpm * zoom}px 100%`, backgroundPositionX: offset * zoom }}>
          <div className="editor-ruler">{Array.from({ length: Math.ceil(edit.duration / 5) }, (_, i) => <span key={i} style={{ left: i * 5 * zoom }}>{timeLabel(i * 5).slice(0, -4)}</span>)}</div>
          <div className="editor-waveform" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seek(positionOnTimeline(event)) }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(positionOnTimeline(event)) }}><svg viewBox="0 0 800 80" preserveAspectRatio="none" aria-label="Audio waveform">{peaks.map((peak, i) => <line key={i} x1={i} x2={i} y1={40 - peak * 38} y2={40 + peak * 38} />)}</svg></div>
          <div className="editor-marker-lane" aria-label="Dance markers"><div className="editor-lane-labels" aria-hidden="true">{joints.map((joint) => <span key={joint}>{jointLabel(joint)}{joint === 'leftHand' ? ' / clap' : ''}</span>)}</div>{markers.map((item, index) => <button key={item.id} tabIndex={selected === item.id || (!markers.some((m) => m.id === selected) && index === 0) ? 0 : -1} aria-label={`${item.kind}, ${jointLabel(item.joint)}, ${timeLabel(item.time)}`} aria-pressed={selectedMarkers.includes(item.id)} className={`editor-marker ${item.kind} ${selectedMarkers.includes(item.id) ? 'selected' : ''}`} style={{ left: item.time * zoom, top: (item.kind === 'clap' ? 0 : joints.indexOf(item.joint)) * 36, width: item.kind === 'hold' ? Math.max(32, item.duration * zoom) : 32 }} title={`${item.kind} · ${jointLabel(item.joint)} · ${timeLabel(item.time)}`} onClick={(event) => { if (suppressMarkerClick.current) { suppressMarkerClick.current = false; return }; selectMarker(item.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }); seek(item.time) }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !selectedMarkers.includes(item.id)) selectMarker(item.id); dragging.current = { id: item.id, time: item.time } }} onPointerMove={(event) => {
            if (!dragging.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
            dragging.current.time = Math.min(edit.duration - (item.kind === 'hold' ? item.duration : 0), Math.max(0, snapped((event.clientX - bounds.left) / zoom)))
            event.currentTarget.style.left = `${dragging.current.time * zoom}px`
          }} onPointerUp={(event) => {
            const drag = dragging.current; dragging.current = null
            if (drag && drag.time !== item.time) { suppressMarkerClick.current = true; event.currentTarget.releasePointerCapture(event.pointerId); change({ ...edit, charts: { ...edit.charts, [level]: markers.map((m) => m.id === item.id ? { ...m, time: drag.time } : m) } }); seek(drag.time) }
          }}>{item.kind === 'clap' ? 'C' : item.kind === 'hold' ? '━' : '●'}</button>)}</div>
          <div className="editor-light-lane" aria-label="Lighting markers">{lights.map((item, i) => <button key={i} tabIndex={selected === `light:${i}` || (!selected.startsWith('light:') && i === 0) ? 0 : -1} aria-label={`${item.kind} light, ${timeLabel(item.time)}`} className={`editor-light ${item.kind} ${selected === `light:${i}` ? 'selected' : ''}`} style={{ left: item.time * zoom }} title={`${item.kind} at ${timeLabel(item.time)}`} onClick={() => { clearMarkerSelection(); setSelected(`light:${i}`); seek(item.time) }}>{item.kind === 'burst' ? '★' : '◆'}</button>)}</div>
          <div className="editor-trim-shade" style={{ width: edit.start * zoom }} /><div className="editor-trim-shade" style={{ left: edit.end * zoom, right: 0 }} /><div className="editor-playhead" style={{ left: time * zoom }} />
        </div></div>
        <div className="editor-tools"><strong>Lighting:</strong><button onClick={() => addLight('beat')}>Z · Beat</button><button onClick={() => addLight('accent')}>X · Accent</button><button onClick={() => addLight('burst')}>C · Gold</button>
          <label>Trim start<input type="number" min={0} max={edit.end - .1} step={.001} value={edit.start} onChange={(event) => change({ ...edit, start: Number(event.target.value) })} /></label><button onClick={() => change({ ...edit, start: time })}>Start here</button>
          <label>Trim end<input type="number" min={edit.start + .1} max={edit.duration} step={.001} value={edit.end} onChange={(event) => change({ ...edit, end: Number(event.target.value) })} /></label><button onClick={() => change({ ...edit, end: time })}>End here</button><button onClick={() => change({ ...edit, start: 0, end: edit.duration })}>Full video</button>
        </div><small>Original file stays intact. Every completed edit autosaves. Space: play/pause · ←/→: 1/30 second · Shift+←/→: 0.1 second · Ctrl+Z: undo · Ctrl+Shift+Z: redo · Ctrl/Cmd+C/V: copy/paste</small>
      </section>
    </fieldset>}
    {confirmClose && <div className="editor-confirm" role="alertdialog" aria-label="Unsaved song edits"><h2>Keep your edits?</h2><p>Your changes are not active until saved.</p><button disabled={busy} onClick={() => void persist('draft')}>Keep draft & close</button><button disabled={busy} onClick={() => void persist('discard')}>Discard edits</button><button disabled={busy} onClick={() => setConfirmClose(false)}>Continue editing</button></div>}
  </div>
}
