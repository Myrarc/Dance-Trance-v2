import { useEffect, useMemo, useRef, useState } from 'react'
import { MENU_THEMES } from '../lib/gameSettings'
import { getVideo, type LibraryEntry } from '../lib/library'
import { beatGlowAt, isBpmMap, loadBeatMap, restoreAutomaticBeats, saveBeatMap, songBeatKey, tapTempo, themeBeatKey, type BeatMap } from '../lib/beatMaps'

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
  const [bpmText, setBpmText] = useState('120')
  const [startText, setStartText] = useState('0')
  const [edited, setEdited] = useState(false)
  const [tapCount, setTapCount] = useState(0)
  const [saved, setSaved] = useState<BeatMap | null>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<{ kind: 'switch'; key: string } | { kind: 'close' } | { kind: 'restore' } | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const mediaRef = useRef<HTMLMediaElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const tapTimesRef = useRef<number[]>([])
  const songTrack = key.startsWith('song:')
  const song = songTrack ? library.find((entry) => songBeatKey(entry.id) === key) : null
  const theme = key.startsWith('theme:') ? MENU_THEMES.find((item) => themeBeatKey(item.id) === key) : null
  const bpm = Number(bpmText)
  const start = Number(startText)
  const draft = useMemo(() => bpmText.trim() && startText.trim() && isBpmMap({ bpm, start }) && (!duration || start < duration)
    ? { bpm, start } : null, [bpm, start, bpmText, startText, duration])

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
    setSaved(null)
    setEdited(false)
    setTapCount(0)
    tapTimesRef.current = []
    setBpmText('120')
    setStartText('0')
    setMediaUrl(theme ? `${import.meta.env.BASE_URL}audio/${theme.file}` : null)
    setDuration(song?.duration ?? 0)
    setTime(0)
    void loadBeatMap(key).then((map) => {
      if (cancelled) return
      setSaved(map)
      if (map && 'bpm' in map) {
        setBpmText(String(map.bpm))
        setStartText(String(map.start))
      }
      setLoading(false)
    }).catch(() => { if (!cancelled) { setStatus('Could not load timing for this track.'); setLoading(false) } })
    if (song?.hasVideo) void getVideo(song.id).then((blob) => {
      if (!blob || cancelled) return
      url = URL.createObjectURL(blob)
      setMediaUrl(url)
    }).catch(() => { if (!cancelled) setStatus('Could not open this song video.') })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [key, song?.id, song?.duration, song?.hasVideo, theme])

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const media = mediaRef.current
      if (media) {
        setTime(media.currentTime)
        const pulse = media.paused || !draft ? 0 : beatGlowAt(draft, media.currentTime)?.pulse ?? 0
        glowRef.current?.style.setProperty('--beat-glow', `${Math.round(pulse * 76)}px`)
        glowRef.current?.style.setProperty('--beat-opacity', String(pulse))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [draft])

  const choose = (next: string) => {
    if (next === key) return
    if (edited) { setPending({ kind: 'switch', key: next }); return }
    mediaRef.current?.pause()
    setKey(next)
  }
  const close = () => {
    if (edited) { setPending({ kind: 'close' }); return }
    onClose()
  }
  const save = async () => {
    if (!draft) { setStatus('Enter a BPM from 30 to 300 and a beat start within the track.'); return }
    setBusy(true)
    try {
      const map = await saveBeatMap(key, draft)
      setSaved(map)
      setEdited(false)
      onMapChange(key, map)
      setStatus('BPM lighting saved on this device.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save timing.')
    } finally { setBusy(false) }
  }
  const restore = async () => {
    setBusy(true)
    try {
      await restoreAutomaticBeats(key)
      setSaved(null)
      setEdited(false)
      setTapCount(0)
      tapTimesRef.current = []
      setBpmText('120')
      setStartText('0')
      onMapChange(key, null)
      setStatus(songTrack ? 'Song edge lighting turned off.' : 'Automatic beats restored.')
    } catch { setStatus('Could not restore timing.') }
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
  const tap = () => {
    const result = tapTempo(tapTimesRef.current, performance.now())
    tapTimesRef.current = result.taps
    setTapCount(result.taps.length)
    if (result.bpm !== null) {
      setBpmText(String(result.bpm))
      setEdited(true)
    }
  }

  return <main ref={dialogRef} tabIndex={-1} className="beat-lab" role="dialog" aria-modal="true" aria-label="Beat Lab" onKeyDown={(event) => {
    if (pending) { if (event.key === 'Escape') setPending(null); return }
    if (event.key === 'Escape') { event.stopPropagation(); close(); return }
    if (event.key !== 'Tab') return
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), video[controls], audio[controls]') ?? [])]
    if (controls.length && event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
    else if (controls.length && !event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus() }
  }}>
    <div className="beat-lab-head"><h1>Beat Lab</h1><button className="btn" onClick={close}>Back to Settings</button></div>
    <p className="beat-lab-intro">Set the tempo and the first beat. Edge lights will pulse on every beat from that point, in sync with the track.</p>
    <div className="beat-lab-track"><label htmlFor="beat-lab-track">Track</label><select id="beat-lab-track" value={key} onChange={(event) => choose(event.target.value)}>{MENU_THEMES.map((item) => <option key={item.id} value={themeBeatKey(item.id)}>{item.label}</option>)}<optgroup label="Library songs">{library.map((entry) => <option key={entry.id} value={songBeatKey(entry.id)}>{entry.name}</option>)}</optgroup></select></div>
    <div className="beat-lab-layout">
      <section className="beat-lab-panel" aria-label="Beat timing">
        <label htmlFor="beat-lab-bpm">Tempo <span>BPM</span></label>
        <div className="beat-lab-tempo"><input id="beat-lab-bpm" type="number" min="30" max="300" step="1" value={bpmText} onChange={(event) => { setBpmText(event.target.value); setEdited(true); setTapCount(0); tapTimesRef.current = [] }} /><button className="btn" type="button" disabled={loading || busy} onClick={tap} onKeyDown={(event) => { if (event.repeat) event.preventDefault() }}>Tap tempo</button></div>
        <p aria-live="polite">{tapCount === 1 ? 'Tap again to set BPM.' : tapCount > 1 ? `${tapCount} taps sampled · ${bpmText} BPM` : 'Click Tap tempo or focus it and press Space/Enter in rhythm. 30–300 BPM.'}</p>
        <label htmlFor="beat-lab-start">First beat <span>seconds into track</span></label>
        <div className="beat-lab-start"><input id="beat-lab-start" type="number" min="0" max={duration || undefined} step="0.01" value={startText} onChange={(event) => { setStartText(event.target.value); setEdited(true) }} /><button className="btn" type="button" disabled={!mediaUrl} onClick={() => { setStartText(mediaRef.current?.currentTime.toFixed(2) ?? '0'); setEdited(true) }}>Use playhead</button></div>
        <p>Play or seek to the first beat, then use the playhead.</p>
        {saved && 'marks' in saved && <p className="beat-lab-legacy">This track uses an older tap map. Saving replaces it with BPM timing.</p>}
        <div className="beat-lab-actions"><button className="btn primary" disabled={busy || loading || !draft || (!edited && saved !== null && 'bpm' in saved)} onClick={() => void save()}>Save BPM lighting</button><button className="btn subtle" disabled={busy || loading || !saved} onClick={() => setPending({ kind: 'restore' })}>{songTrack ? 'Turn off song lighting' : 'Restore automatic beats'}</button></div>
        <p role="status">{status}</p>
      </section>
      <section className="beat-lab-preview" aria-label="Track preview">
        <div className="beat-lab-preview-head"><h2>Preview</h2><strong>{clock(time)} / {clock(duration)}</strong></div>
        {mediaUrl ? song ? <video key={key} ref={mediaRef as React.RefObject<HTMLVideoElement>} className="beat-lab-media" src={mediaUrl} controls onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} /> : <audio key={key} ref={mediaRef as React.RefObject<HTMLAudioElement>} className="beat-lab-media" src={mediaUrl} controls onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} /> : <p role="status">This song’s video is unavailable. Add it to the library again to set its beats.</p>}
        <input aria-label="Seek track" type="range" min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 1)} onChange={(event) => seek(Number(event.target.value))} disabled={!mediaUrl} />
        <p>The border shows the BPM pulse while the track plays.</p>
      </section>
    </div>
    {pending && <div className="beat-lab-confirm" role="alertdialog" aria-label="Confirm beat map change"><p>{pending.kind === 'restore' ? songTrack ? 'Turn off edge lighting for this song?' : 'Remove this timing and use automatic beats?' : 'Discard unsaved BPM changes?'}</p><button ref={confirmRef} className="btn" onClick={() => setPending(null)}>Cancel</button><button className="btn primary" onClick={confirmPending}>Confirm</button></div>}
    <div ref={glowRef} className="beat-lab-glow" aria-hidden="true" />
  </main>
}
