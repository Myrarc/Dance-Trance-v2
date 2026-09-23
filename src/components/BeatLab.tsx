import { useEffect, useMemo, useRef, useState } from 'react'
import { MENU_THEMES } from '../lib/gameSettings'
import { getVideo, type LibraryEntry } from '../lib/library'
import { loadBeatMap, manualGlowAt, normalizeMarks, restoreAutomaticBeats, saveBeatMap, songBeatKey, themeBeatKey, type BeatMap, type BeatMark, type BeatKind } from '../lib/beatMaps'
import { spawnEdgeStars } from '../lib/edgeStars'

const PIXELS_PER_SECOND = 24
const PREVIEW_START = 12
const PREVIEW_LENGTH = 7

function clock(time: number) {
  return `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}.${Math.floor(time % 1 * 100).toString().padStart(2, '0')}`
}

export default function BeatLab({ library, initialTheme, onClose, onMapChange }: {
  library: LibraryEntry[]
  initialTheme: string
  onClose: () => void
  onMapChange: (key: string, map: BeatMap | null) => void
}) {
  const [key, setKey] = useState(() => themeBeatKey(initialTheme === 'off' ? MENU_THEMES[0].id : initialTheme))
  const [marks, setMarks] = useState<BeatMark[]>([])
  const [saved, setSaved] = useState<BeatMap | null>(null)
  const [undo, setUndo] = useState<BeatMark[][]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<{ kind: 'switch'; key: string } | { kind: 'close' } | { kind: 'restore' } | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const mediaRef = useRef<HTMLMediaElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const starsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ index: number; x: number; marks: BeatMark[]; changed: boolean } | null>(null)
  const dirty = JSON.stringify(normalizeMarks(marks)) !== JSON.stringify(saved?.marks ?? [])
  const songTrack = key.startsWith('song:')
  const song = songTrack ? library.find((entry) => songBeatKey(entry.id) === key) : null
  const theme = key.startsWith('theme:') ? MENU_THEMES.find((item) => themeBeatKey(item.id) === key) : null
  const ordered = useMemo(() => normalizeMarks(marks), [marks])
  const pxPerSecond = PIXELS_PER_SECOND * zoom
  const timelineWidth = Math.max(640, duration * pxPerSecond)
  const previewStart = Math.min(PREVIEW_START, Math.max(0, duration - 8))

  useEffect(() => {
    const frame = requestAnimationFrame(() => dialogRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => { if (pending) confirmRef.current?.focus() }, [pending])

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setStatus('')
    setLoading(true)
    setMarks([])
    setSaved(null)
    setMediaUrl(theme ? `${import.meta.env.BASE_URL}audio/${theme.file}` : null)
    setDuration(song?.duration ?? 0)
    setTime(0)
    setSelected(null)
    setUndo([])
    void loadBeatMap(key).then((map) => {
      if (cancelled) return
      setSaved(map)
      setMarks(map?.marks ?? [])
      setLoading(false)
    }).catch(() => { if (!cancelled) { setStatus('Could not load this beat map.'); setLoading(false) } })
    if (song?.hasVideo) void getVideo(song.id).then((blob) => {
      if (!blob || cancelled) return
      url = URL.createObjectURL(blob)
      setMediaUrl(url)
    }).catch(() => { if (!cancelled) setStatus('Could not open this song video.') })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [key, song?.id, song?.duration, song?.hasVideo, theme])

  useEffect(() => {
    let frame = 0
    let previousTime = mediaRef.current?.currentTime ?? 0
    const tick = () => {
      const media = mediaRef.current
      if (media) {
        setTime(media.currentTime)
        const timed = media.paused ? null : manualGlowAt(ordered, media.currentTime)
        if (timed?.mark.kind === 'burst' && previousTime < timed.mark.time &&
          media.currentTime - previousTime < .5 && !media.seeking && starsRef.current &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches) spawnEdgeStars(starsRef.current)
        previousTime = media.currentTime
        const pulse = timed?.pulse ?? 0
        const kind = timed?.mark.kind
        glowRef.current?.style.setProperty('--beat-color', kind === 'burst' ? '#ffd36a' : '#43e3e9')
        glowRef.current?.style.setProperty('--beat-border', kind === 'burst' ? '9px' : kind === 'accent' ? '7px' : '4px')
        glowRef.current?.style.setProperty('--beat-glow', `${Math.round(pulse * (kind === 'burst' ? 112 : kind === 'accent' ? 76 : 38))}px`)
        glowRef.current?.style.setProperty('--beat-opacity', String(Math.min(1, pulse * (kind === 'beat' ? .9 : 1.1))))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ordered])

  const change = (next: BeatMark[]) => {
    setUndo((history) => [...history.slice(-49), marks])
    setMarks(next)
    setStatus('Unsaved changes')
  }
  const choose = (next: string) => {
    if (next === key) return
    if (dirty) { setPending({ kind: 'switch', key: next }); return }
    mediaRef.current?.pause()
    starsRef.current?.replaceChildren()
    setKey(next)
  }
  const close = () => {
    if (dirty) { setPending({ kind: 'close' }); return }
    starsRef.current?.replaceChildren()
    onClose()
  }
  const add = (kind: BeatKind) => {
    const media = mediaRef.current
    if (loading || !media || media.paused || !Number.isFinite(media.currentTime)) return
    const at = media.currentTime
    if (marks.some((mark) => Math.abs(mark.time - at) < .03)) return
    change([...marks, { time: at, kind }])
    if (kind === 'burst' && starsRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      spawnEdgeStars(starsRef.current)
    }
    setSelected(marks.length)
  }
  const save = async () => {
    setBusy(true)
    try {
      const map = await saveBeatMap(key, marks)
      setSaved(map)
      setMarks(map.marks)
      setSelected(null)
      onMapChange(key, map)
      setStatus('Saved on this device')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save beat map.')
    } finally { setBusy(false) }
  }
  const restore = async () => {
    setBusy(true)
    try {
      await restoreAutomaticBeats(key)
      setSaved(null)
      setMarks([])
      setUndo([])
      setSelected(null)
      onMapChange(key, null)
      setStatus(songTrack ? 'Song edge lighting turned off' : 'Automatic beats restored')
    } catch { setStatus(songTrack ? 'Could not remove song lighting.' : 'Could not restore automatic beats.') }
    finally { setBusy(false) }
  }
  const confirmPending = () => {
    const action = pending
    setPending(null)
    if (action?.kind === 'restore') void restore()
    else if (action?.kind === 'close') onClose()
    else if (action?.kind === 'switch') { mediaRef.current?.pause(); setKey(action.key) }
  }
  const seek = (next: number) => {
    if (!mediaRef.current) return
    mediaRef.current.currentTime = Math.max(0, Math.min(duration, next))
    setTime(mediaRef.current.currentTime)
  }
  const nudge = (seconds: number) => {
    if (selected === null || !marks[selected]) return
    change(marks.map((mark, index) => index === selected ? { ...mark, time: Math.max(0, Math.min(duration, mark.time + seconds)) } : mark))
  }
  const undoLast = () => {
    if (!undo.length) return
    const previous = undo.at(-1)!
    setMarks(previous)
    setSelected(null)
    setUndo(undo.slice(0, -1))
    setStatus(JSON.stringify(normalizeMarks(previous)) === JSON.stringify(saved?.marks ?? []) ? '' : 'Unsaved changes')
  }

  return <main ref={dialogRef} tabIndex={-1} className="beat-lab" role="dialog" aria-modal="true" aria-label="Beat Lab" onKeyDown={(event) => {
    if (pending) { if (event.key === 'Escape') setPending(null); return }
    if (event.key === 'Escape') { event.stopPropagation(); close(); return }
    if (event.key === 'Tab') {
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), video[controls], audio[controls]') ?? [])]
      if (controls.length && event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (controls.length && !event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus() }
      return
    }
    if (event.repeat || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
    if (event.ctrlKey && event.key.toLowerCase() === 'z' && undo.length) { event.preventDefault(); undoLast(); return }
    if (event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); add('beat') }
    else if (event.key.toLowerCase() === 'x' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); add('accent') }
    else if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); add('burst') }
    else if (event.key === 'Delete' && selected !== null) { change(marks.filter((_, index) => index !== selected)); setSelected(null) }
    else if (event.key === 'ArrowLeft' && selected !== null) { event.preventDefault(); nudge(event.shiftKey ? -.1 : -.01) }
    else if (event.key === 'ArrowRight' && selected !== null) { event.preventDefault(); nudge(event.shiftKey ? .1 : .01) }
  }}>
    <div className="beat-lab-head"><div><span className="kicker">Private timing editor</span><h1>Beat Lab</h1></div><button className="btn" onClick={close}>Back to Settings</button></div>
    <div className="beat-lab-controls">
      <label>Track <select value={key} onChange={(event) => choose(event.target.value)}>{MENU_THEMES.map((item) => <option key={item.id} value={themeBeatKey(item.id)}>{item.label}</option>)}<optgroup label="Library songs">{library.map((entry) => <option key={entry.id} value={songBeatKey(entry.id)}>{entry.name}</option>)}</optgroup></select></label>
      <span>{clock(time)} / {clock(duration)}</span>
      <button className="btn" disabled={!mediaUrl} onClick={() => { const media = mediaRef.current; if (media) { if (media.paused) void media.play(); else media.pause() } }}>Play / Pause</button>
      <label>Zoom <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[1, 2, 4, 8].map((level) => <option key={level} value={level}>{level}×</option>)}</select></label>
    </div>
    {mediaUrl ? song ? <video key={key} ref={mediaRef as React.RefObject<HTMLVideoElement>} className="beat-lab-media" src={mediaUrl} controls onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} /> : <audio key={key} ref={mediaRef as React.RefObject<HTMLAudioElement>} src={mediaUrl} controls onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} /> : <p role="status">This song’s video is unavailable. Add it to the library again to record beats.</p>}
    <input aria-label="Seek track" type="range" min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 1)} onChange={(event) => seek(Number(event.target.value))} disabled={!mediaUrl} />
    <p className="beat-lab-help">Play the track: Z = beat · X = strong accent · C = gold starburst. Select a mark to drag, delete, or nudge with ←/→ (Shift = 0.1s). Ctrl+Z undoes an edit.{songTrack && ' Songs without a saved map have no edge lighting.'}</p>
    <div className="beat-lab-timeline"><div className="beat-lab-ruler" style={{ width: timelineWidth, backgroundSize: `${pxPerSecond}px 100%` }} onClick={(event) => { if (event.target === event.currentTarget) seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / pxPerSecond) }}>
      {song && duration > 0 && <div className="beat-lab-preview-range" title="Song picker preview loop" style={{ left: previewStart * pxPerSecond, width: Math.min(PREVIEW_LENGTH, duration - previewStart) * pxPerSecond }} />}
      <div className="beat-lab-playhead" style={{ left: time * pxPerSecond }} />
      {marks.map((mark, index) => <button key={index} type="button" className={`beat-lab-mark ${mark.kind}${selected === index ? ' selected' : ''}`} style={{ left: mark.time * pxPerSecond }} title={`${mark.kind} at ${clock(mark.time)}`} aria-label={`${mark.kind} at ${clock(mark.time)}`} onClick={(event) => { event.stopPropagation(); setSelected(index) }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { index, x: event.clientX, marks, changed: false }; setSelected(index) }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag || drag.index !== index) return; const delta = (event.clientX - drag.x) / pxPerSecond; if (Math.abs(delta) < .001) return; drag.changed = true; setMarks(drag.marks.map((item, i) => i === index ? { ...item, time: Math.max(0, Math.min(duration, item.time + delta)) } : item)); setStatus('Unsaved changes') }} onPointerUp={() => { const drag = dragRef.current; if (drag?.changed) setUndo((history) => [...history.slice(-49), drag.marks]); dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }} />)}
    </div></div>
    <div className="beat-lab-actions"><button className="btn" disabled={selected === null || !marks[selected] || loading} onClick={() => { if (selected !== null) { change(marks.filter((_, index) => index !== selected)); setSelected(null) } }}>Delete mark</button><button className="btn" disabled={!undo.length || loading} onClick={undoLast}>Undo</button><button className="btn primary" disabled={!dirty || busy || loading || !marks.length} onClick={() => void save()}>Save map</button><button className="btn subtle" disabled={busy || loading || !saved} onClick={() => setPending({ kind: 'restore' })}>{songTrack ? 'Remove song lighting' : 'Restore automatic beats'}</button></div>
    {pending && <div className="beat-lab-confirm" role="alertdialog" aria-label="Confirm beat map change"><p>{pending.kind === 'restore' ? songTrack ? 'Remove this map and turn off edge lighting for this song?' : 'Remove this map and use automatic beats?' : 'Discard unsaved beat changes?'}</p><button ref={confirmRef} className="btn" onClick={() => setPending(null)}>Cancel</button><button className="btn primary" onClick={confirmPending}>Confirm</button></div>}
    <p role="status">{status}</p><div ref={glowRef} className="beat-lab-glow" aria-hidden="true" /><div ref={starsRef} className="edge-stars beat-lab-stars" aria-hidden="true" />
  </main>
}
