import { useEffect, useMemo, useRef, useState } from 'react'
import { fingerprint, getTrack, getVideo, remember, deleteBeatMap, type LibraryEntry } from '../lib/library'
import { loadBeatMap, beatGlowAt, type BeatKind, type BeatMark } from '../lib/beatMaps'
import { loadSongEdit, saveSongDraft, saveSongEdit, songDraftKey, markerFromCue, visualCues, type SongEdit, type VisualMarker } from '../lib/songEdits'
import { buildCueChart, HIT_LEAD_S, type Difficulty, type HitJoint } from '../pose/hitTargets'
import { sampleTrack, unpackTrack, type PoseTrack } from '../pose/track'
import { cueColor, drawArcadeHitMarker, drawArcadeHitLabel, drawCueGlyph } from '../pose/arcade'
import { drawSkeleton, SIDE_COLORS } from '../pose/skeleton'
import { editorWaveform } from '../lib/editorWaveform'
import './SongEditor.css'

const timeLabel = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(3).padStart(6, '0')}`
const joints: HitJoint[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head']
const jointLabel = (joint: string) => joint.replace(/([A-Z])/g, ' $1').toLowerCase()
const HEAD_LANDMARKS = new Set([0, 7, 8])
const HAND_LANDMARKS = new Set([13, 14, 15, 16])
const FOOT_LANDMARKS = new Set([25, 26, 27, 28, 31, 32])
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
  const [level, setLevel] = useState<Difficulty>('normal')
  const [selected, setSelected] = useState('')
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
  const [showHead, setShowHead] = useState(true)
  const [showHands, setShowHands] = useState(true)
  const [showFeet, setShowFeet] = useState(true)
  const [peaks, setPeaks] = useState<number[]>([])
  const [status, setStatus] = useState('Opening local song…')
  const [waveStatus, setWaveStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [undo, setUndo] = useState<SongEdit[]>([])
  const [redo, setRedo] = useState<SongEdit[]>([])
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writes = useRef(Promise.resolve())
  const dirty = !!edit && JSON.stringify(edit) !== baseline
  const generated = useMemo(() => track ? buildCueChart(track, level, true, 'full').map((cue, index) => markerFromCue(cue, `generated-${level}-${index}`)) : [], [track, level])
  const markers = edit?.charts[level] ?? generated
  const lights = useMemo(() => edit ? lightsFor(edit) : [], [edit])
  const marker = markers.find((item) => item.id === selected)
  const lightIndex = selected.startsWith('light:') ? Number(selected.slice(6)) : -1
  const light = lights[lightIndex]

  useEffect(() => {
    let stopped = false
    root.current?.focus()
    void Promise.all([getVideo(entry.id), getTrack(entry.id), loadSongEdit(entry.id), loadSongEdit(entry.id, true), loadBeatMap(`song:${entry.id}`)])
      .then(([blob, stored, saved, draft, lighting]) => {
        if (stopped) return
        const decoded = stored && unpackTrack(stored)
        const initial = saved ? { ...saved, lighting } : { version: 1 as const, duration: entry.duration, start: 0, end: entry.duration, charts: {}, lighting }
        setSource(blob)
        setTrack(decoded)
        setBpm(decoded?.bpm ?? 120)
        setEdit(draft ?? initial)
        setBaseline(JSON.stringify(initial))
        setStatus(draft ? 'Recovered your local draft. Save to apply it.' : 'Edits change visual guides only. Scoring still follows the reference dancer.')
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
    if (!edit || busy) return
    if (!dirty) {
      writes.current = writes.current.catch(() => undefined).then(() => deleteBeatMap(songDraftKey(entry.id)))
      void writes.current.catch((error) => setStatus(`Could not clear old draft: ${String(error)}`))
      return
    }
    draftTimer.current = setTimeout(() => {
      writes.current = writes.current.catch(() => undefined).then(() => saveSongDraft(entry.id, edit))
      void writes.current.catch((error) => setStatus(`Draft could not be saved: ${String(error)}`))
    }, 700)
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current) }
  }, [edit, dirty, busy, entry.id])
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
    const cues = visualCues({ ...edit, charts: { ...edit.charts, [level]: markers } }, [], level, 'full', true)
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
      const pose = showSkeleton && track ? sampleTrack(track, media.currentTime) : null
      if (pose) {
        const landmarks = pose.landmarks.map((landmark, index) => ({
          ...landmark,
          visibility: (!showHead && HEAD_LANDMARKS.has(index))
            || (!showHands && HAND_LANDMARKS.has(index))
            || (!showFeet && FOOT_LANDMARKS.has(index))
            ? 0
            : landmark.visibility,
        }))
        drawSkeleton(ctx, landmarks, canvas.width, canvas.height, {
          lineWidth: Math.max(4, canvas.height * .008),
          sideColors: SIDE_COLORS,
          glow: !reduced,
        })
      }
      for (const cue of cues) {
        if (cue.time < media.currentTime - 0.45 || cue.time > media.currentTime + HIT_LEAD_S) continue
        const x = cue.x * canvas.width, y = cue.y * canvas.height
        drawArcadeHitMarker(ctx, x, y, radius, cueColor(cue), cue.time - media.currentTime, reduced)
        drawCueGlyph(ctx, cue, x, y, radius, media.currentTime)
        if (autoHit && cue.time <= media.currentTime) drawArcadeHitLabel(ctx, x, y, radius, 'perfect')
      }
      if (marker) {
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
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [edit, level, markers, marker, loop, autoHit, showSkeleton, showHead, showHands, showFeet, track, reducedEffects, url])

  const change = (next: SongEdit) => { if (edit) setUndo((history) => [...history.slice(-79), edit]); setRedo([]); setEdit(next) }
  const seek = (next: number) => { if (video.current && edit) { video.current.currentTime = Math.max(0, Math.min(edit.duration, next)); setTime(video.current.currentTime) } }
  const snapped = (next: number) => !snap ? next : Math.max(0, offset + Math.round((next - offset) / (60 / bpm / snap)) * (60 / bpm / snap))
  const stamp = () => Math.min(edit?.duration ?? 0, snapped(video.current?.currentTime ?? time))
  const patchMarker = (patch: Partial<VisualMarker>) => { if (edit && marker) change({ ...edit, charts: { ...edit.charts, [level]: markers.map((item) => item.id === marker.id ? { ...item, ...patch } : item) } }) }
  const patchLight = (patch: Partial<BeatMark>) => { if (edit && light) change({ ...edit, lighting: { marks: lights.map((item, i) => i === lightIndex ? { ...item, ...patch } : item) } }) }
  const addMarker = () => {
    if (!edit) return
    const id = crypto.randomUUID()
    change({ ...edit, charts: { ...edit.charts, [level]: [...markers, { id, kind: 'spot', joint: 'rightHand', time: stamp(), duration: 0, x: .5, y: .5 }] } })
    setSelected(id)
  }
  const addLight = (kind: BeatKind) => { if (edit) { change({ ...edit, lighting: { marks: [...lights, { time: stamp(), kind }] } }); setSelected(`light:${lights.length}`) } }
  const remove = () => {
    if (!edit) return
    if (marker) change({ ...edit, charts: { ...edit.charts, [level]: markers.filter((item) => item.id !== marker.id) } })
    else if (light) change({ ...edit, lighting: { marks: lights.filter((_, i) => i !== lightIndex) } })
    setSelected('')
  }
  const duplicate = () => {
    if (!edit) return
    if (marker) { const id = crypto.randomUUID(); change({ ...edit, charts: { ...edit.charts, [level]: [...markers, { ...marker, id }] } }); setSelected(id) }
    else if (light) { change({ ...edit, lighting: { marks: [...lights, { ...light }] } }); setSelected(`light:${lights.length}`) }
  }
  const undoEdit = () => { const previous = undo.at(-1); if (previous && edit) { setRedo((history) => [...history, edit]); setUndo(undo.slice(0, -1)); setEdit(previous); setSelected('') } }
  const redoEdit = () => { const next = redo.at(-1); if (next && edit) { setUndo((history) => [...history, edit]); setRedo(redo.slice(0, -1)); setEdit(next); setSelected('') } }
  const toggle = () => {
    const media = video.current
    if (!media || !edit) return
    if (!media.paused) media.pause()
    else { if (media.currentTime < edit.start || media.currentTime >= edit.end) seek(edit.start); void media.play().catch(() => setStatus('Playback failed. Try reselecting the original video.')) }
  }
  const persist = async (mode: 'save' | 'draft' | 'discard') => {
    if (!edit) return
    setBusy(true)
    if (draftTimer.current) clearTimeout(draftTimer.current)
    try {
      await writes.current.catch(() => undefined)
      if (mode === 'discard') { await deleteBeatMap(songDraftKey(entry.id)); onClose() }
      else if (mode === 'draft') { await saveSongDraft(entry.id, edit); onClose() }
      else { const saved = await saveSongEdit(entry.id, edit); setBaseline(JSON.stringify(saved)); setStatus('Saved. Your visual chart, trim, and lighting are active.'); onSaved() }
    } catch (error) { setStatus(`Could not save: ${String(error)}. Your edits are still here.`) }
    finally { setBusy(false) }
  }
  const positionOnTimeline = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(edit?.duration ?? 0, snapped((event.clientX - bounds.left) / zoom)))
  }
  const dragging = useRef<{ id: string; time: number } | null>(null)
  const suppressMarkerClick = useRef(false)

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
    if (event.target instanceof HTMLElement && event.target.matches('.editor-marker, .editor-light') && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      const buttons = Array.from(event.target.parentElement!.querySelectorAll<HTMLButtonElement>('button'))
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
      next?.click(); next?.focus()
      return
    }
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redoEdit(); else undoEdit() }
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
    <header className="editor-header"><div><small>SONG EDITOR · LOCAL ONLY</small><h1>{entry.name}</h1></div><button className="btn primary" disabled={!edit || busy || !dirty} onClick={() => void persist('save')}>Save changes</button><button className="btn" disabled={busy} onClick={() => dirty ? setConfirmClose(true) : onClose()}>Close</button></header>
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
          <canvas ref={overlay} aria-label="Marker preview. Select a marker, then click to move its position." onClick={(event) => {
            if (!marker) return
            const bounds = event.currentTarget.getBoundingClientRect()
            patchMarker({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height })
          }} />
        </div>
        <div className="editor-tools"><button onClick={() => seek(time - 1 / 30)}>−1/30s</button><button disabled={!url} onClick={toggle}>{playing ? 'Pause' : 'Play'}</button><button onClick={() => seek(time + 1 / 30)}>+1/30s</button><output>{timeLabel(time)}</output><label>Speed<select value={rate} onChange={(event) => { const value = Number(event.target.value); setRate(value); if (video.current) video.current.playbackRate = value }}>{[.25, .5, .75, 1].map((value) => <option key={value}>{value}</option>)}</select></label><label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />Loop trim</label><label><input type="checkbox" checked={autoHit} onChange={(event) => setAutoHit(event.target.checked)} />Auto-hit preview</label><span className="editor-skeleton-controls" role="group" aria-label="Reference skeleton visibility"><label><input type="checkbox" checked={showSkeleton} onChange={(event) => setShowSkeleton(event.target.checked)} />Skeleton</label><label><input type="checkbox" checked={showHead} disabled={!showSkeleton} onChange={(event) => setShowHead(event.target.checked)} />Head</label><label><input type="checkbox" checked={showHands} disabled={!showSkeleton} onChange={(event) => setShowHands(event.target.checked)} />Hands</label><label><input type="checkbox" checked={showFeet} disabled={!showSkeleton} onChange={(event) => setShowFeet(event.target.checked)} />Feet</label></span></div>
      </section><aside className="editor-inspector">
        <h2>Visual chart</h2><label>Difficulty<select value={level} onChange={(event) => { setLevel(event.target.value as Difficulty); setSelected('') }}>{['easy', 'normal', 'hard'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <p>{edit.charts[level] === undefined ? 'Using generated markers' : 'Custom markers'} · {markers.length} cues</p>
        {!track && <p>Analysis is not available yet. You can still author markers manually; reopen after preparation to generate them.</p>}
        <div className="editor-tools"><button onClick={addMarker}>Add hit (A)</button><button onClick={() => { change({ ...edit, charts: { ...edit.charts, [level]: [] } }); setSelected('') }}>Empty chart</button><button disabled={!track} onClick={() => { const charts = { ...edit.charts }; delete charts[level]; change({ ...edit, charts }); setSelected('') }}>Restore generated</button></div>
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
        <label>Zoom<input type="range" min={10} max={240} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <label>BPM<input type="number" min={30} max={300} value={bpm} onChange={(event) => setBpm(Math.max(30, Math.min(300, Number(event.target.value) || 120)))} /></label>
        <label>Grid offset<input type="number" min={0} step={.001} value={offset} onChange={(event) => setOffset(Number(event.target.value) || 0)} /></label>
        <label>Snap<select value={snap} onChange={(event) => setSnap(Number(event.target.value))}><option value={0}>Off</option><option value={1}>Beat</option><option value={2}>½ beat</option><option value={4}>¼ beat</option></select></label>
        <button onClick={() => { if (timeline.current) timeline.current.scrollLeft = Math.max(0, time * zoom - timeline.current.clientWidth / 2) }}>Find playhead</button>
      </div><p>{waveStatus || 'Drag the waveform to scrub. Drag a marker to retime it. Select one, then use ↑/↓ to select nearby markers, ←/→ to scrub, or Delete to remove.'}</p>
        <div className="editor-timeline-scroll" ref={timeline}><div className="editor-timeline" style={{ width: Math.max(1, edit.duration * zoom), backgroundSize: `${60 / bpm * zoom}px 100%`, backgroundPositionX: offset * zoom }}>
          <div className="editor-ruler">{Array.from({ length: Math.ceil(edit.duration / 5) }, (_, i) => <span key={i} style={{ left: i * 5 * zoom }}>{timeLabel(i * 5).slice(0, -4)}</span>)}</div>
          <div className="editor-waveform" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seek(positionOnTimeline(event)) }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(positionOnTimeline(event)) }}><svg viewBox="0 0 800 80" preserveAspectRatio="none" aria-label="Audio waveform">{peaks.map((peak, i) => <line key={i} x1={i} x2={i} y1={40 - peak * 38} y2={40 + peak * 38} />)}</svg></div>
          <div className="editor-marker-lane" aria-label="Dance markers"><div className="editor-lane-labels" aria-hidden="true">{joints.map((joint) => <span key={joint}>{jointLabel(joint)}{joint === 'leftHand' ? ' / clap' : ''}</span>)}</div>{markers.map((item, index) => <button key={item.id} tabIndex={selected === item.id || (!markers.some((m) => m.id === selected) && index === 0) ? 0 : -1} aria-label={`${item.kind}, ${jointLabel(item.joint)}, ${timeLabel(item.time)}`} className={`editor-marker ${item.kind} ${selected === item.id ? 'selected' : ''}`} style={{ left: item.time * zoom, top: (item.kind === 'clap' ? 0 : joints.indexOf(item.joint)) * 36, width: item.kind === 'hold' ? Math.max(32, item.duration * zoom) : 32 }} title={`${item.kind} · ${jointLabel(item.joint)} · ${timeLabel(item.time)}`} onClick={() => { if (suppressMarkerClick.current) { suppressMarkerClick.current = false; return }; setSelected(item.id); seek(item.time) }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setSelected(item.id); dragging.current = { id: item.id, time: item.time } }} onPointerMove={(event) => {
            if (!dragging.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
            dragging.current.time = Math.min(edit.duration - (item.kind === 'hold' ? item.duration : 0), Math.max(0, snapped((event.clientX - bounds.left) / zoom)))
            event.currentTarget.style.left = `${dragging.current.time * zoom}px`
          }} onPointerUp={(event) => {
            const drag = dragging.current; dragging.current = null
            if (drag && drag.time !== item.time) { suppressMarkerClick.current = true; event.currentTarget.releasePointerCapture(event.pointerId); change({ ...edit, charts: { ...edit.charts, [level]: markers.map((m) => m.id === item.id ? { ...m, time: drag.time } : m) } }); seek(drag.time) }
          }}>{item.kind === 'clap' ? 'C' : item.kind === 'hold' ? '━' : '●'}</button>)}</div>
          <div className="editor-light-lane" aria-label="Lighting markers">{lights.map((item, i) => <button key={i} tabIndex={selected === `light:${i}` || (!selected.startsWith('light:') && i === 0) ? 0 : -1} aria-label={`${item.kind} light, ${timeLabel(item.time)}`} className={`editor-light ${item.kind} ${selected === `light:${i}` ? 'selected' : ''}`} style={{ left: item.time * zoom }} title={`${item.kind} at ${timeLabel(item.time)}`} onClick={() => { setSelected(`light:${i}`); seek(item.time) }}>{item.kind === 'burst' ? '★' : '◆'}</button>)}</div>
          <div className="editor-trim-shade" style={{ width: edit.start * zoom }} /><div className="editor-trim-shade" style={{ left: edit.end * zoom, right: 0 }} /><div className="editor-playhead" style={{ left: time * zoom }} />
        </div></div>
        <div className="editor-tools"><strong>Lighting:</strong><button onClick={() => addLight('beat')}>Z · Beat</button><button onClick={() => addLight('accent')}>X · Accent</button><button onClick={() => addLight('burst')}>C · Gold</button>
          <label>Trim start<input type="number" min={0} max={edit.end - .1} step={.001} value={edit.start} onChange={(event) => change({ ...edit, start: Number(event.target.value) })} /></label><button onClick={() => change({ ...edit, start: time })}>Start here</button>
          <label>Trim end<input type="number" min={edit.start + .1} max={edit.duration} step={.001} value={edit.end} onChange={(event) => change({ ...edit, end: Number(event.target.value) })} /></label><button onClick={() => change({ ...edit, end: time })}>End here</button><button onClick={() => change({ ...edit, start: 0, end: edit.duration })}>Full video</button>
        </div><small>Original file stays intact. Trimmed rounds do not replace full-song personal bests. Space: play/pause · ←/→: 1/30 second · Shift+←/→: 0.1 second · Ctrl+Z: undo · Ctrl+Shift+Z: redo · Ctrl+S: save</small>
      </section>
    </fieldset>}
    {confirmClose && <div className="editor-confirm" role="alertdialog" aria-label="Unsaved song edits"><h2>Keep your edits?</h2><p>Your changes are not active until saved.</p><button disabled={busy} onClick={() => void persist('draft')}>Keep draft & close</button><button disabled={busy} onClick={() => void persist('discard')}>Discard edits</button><button disabled={busy} onClick={() => setConfirmClose(false)}>Continue editing</button></div>}
  </div>
}
