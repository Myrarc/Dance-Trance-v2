import { useEffect, useRef, useState } from 'react'
import { getTrack, getVideo, type LibraryEntry } from '../lib/library'
import { buildCueChart, type CueEvent } from '../pose/hitTargets'
import { cueColor, drawArcadeHitLabel, drawArcadeHitMarker, drawCueGlyph } from '../pose/arcade'
import { KIOSK_PLAY_MS, KIOSK_TITLE_MS, kioskFrame, kioskSongOrder } from '../game/kiosk'
import { L } from '../i18n'

interface Demo { url: string; name: string; cues: CueEvent[] }

export default function AttractKiosk({ library, reducedEffects, onPlayingChange }: {
  library: LibraryEntry[]
  reducedEffects: boolean
  onPlayingChange: (playing: boolean) => void
}) {
  const [demo, setDemo] = useState<Demo | null>(null)
  const [cycle, setCycle] = useState(0)
  const previousSong = useRef<string | null>(null)
  const libraryRef = useRef(library)
  libraryRef.current = library
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    const timer = window.setTimeout(async () => {
      for (const entry of kioskSongOrder(libraryRef.current, previousSong.current)) {
        try {
          const [video, stored] = await Promise.all([getVideo(entry.id), getTrack(entry.id)])
          if (cancelled) return
          const { unpackTrack } = await import('../pose/track')
          if (cancelled) return
          const track = stored && unpackTrack(stored)
          if (!video || !track) continue
          const cues = buildCueChart(track, 'normal', false, 'full')
          if (!cues.length) continue
          url = URL.createObjectURL(video)
          previousSong.current = entry.id
          setDemo({ url, name: entry.name, cues })
          return
        } catch { /* An unavailable local file should not interrupt the welcome screen. */ }
      }
      if (!cancelled) setCycle((value) => value + 1)
    }, KIOSK_TITLE_MS)
    return () => { cancelled = true; clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  }, [cycle])
  useEffect(() => {
    onPlayingChange(!!demo)
    return () => onPlayingChange(false)
  }, [demo, onPlayingChange])
  return demo && <KioskPlayback key={demo.url} demo={demo} reducedEffects={reducedEffects} onFinish={() => {
    setDemo(null)
    setCycle((value) => value + 1)
  }} />
}

function KioskPlayback({ demo, reducedEffects, onFinish }: { demo: Demo; reducedEffects: boolean; onFinish: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const comboRef = useRef<HTMLElement>(null)
  const finishRef = useRef(onFinish)
  finishRef.current = onFinish
  const startRef = useRef(0)
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let frame = 0
    let started = false
    let loopHits = 0
    let lastTime = 0
    let lastHits = 0
    let deadline = window.setTimeout(() => finishRef.current(), 8000)
    const playing = () => {
      if (started) return
      started = true
      clearTimeout(deadline)
      deadline = window.setTimeout(() => finishRef.current(), KIOSK_PLAY_MS)
    }
    const hidden = () => { if (document.hidden) finishRef.current() }
    video.addEventListener('playing', playing)
    document.addEventListener('visibilitychange', hidden)
    const draw = () => {
      frame = requestAnimationFrame(draw)
      if (!video.videoWidth || !video.videoHeight) return
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const time = video.currentTime
      if (time < lastTime - 0.5) { loopHits += lastHits; startRef.current = 0 }
      const state = kioskFrame(demo.cues, time, startRef.current)
      lastTime = time
      lastHits = state.hits
      if (comboRef.current) comboRef.current.textContent = `${loopHits + state.hits}× COMBO`
      const radius = Math.max(28, canvas.height * 0.052)
      for (const cue of state.visible) {
        const x = cue.x * canvas.width
        const y = cue.y * canvas.height
        drawArcadeHitMarker(ctx, x, y, radius, cueColor(cue), cue.time - time, reducedEffects || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        drawCueGlyph(ctx, cue, x, y, radius, time)
        if (cue.time <= time) drawArcadeHitLabel(ctx, x, y, radius, 'perfect')
      }
    }
    frame = requestAnimationFrame(draw)
    return () => {
      clearTimeout(deadline)
      cancelAnimationFrame(frame)
      video.removeEventListener('playing', playing)
      document.removeEventListener('visibilitychange', hidden)
      video.pause()
    }
  }, [demo, reducedEffects])
  return <section className="kiosk-demo" aria-label={L('Arcade demonstration', '街机演示')}>
    <video ref={videoRef} src={demo.url} playsInline loop onError={() => finishRef.current()} onLoadedMetadata={(event) => {
      const video = event.currentTarget
      startRef.current = Math.min(demo.cues[0]?.time ?? 0, Math.max(0, video.duration - 30))
      startRef.current = Math.max(0, startRef.current - 1)
      video.currentTime = startRef.current
      video.volume = 0.55
      void video.play().catch(() => {
        video.muted = true
        setMuted(true)
        void video.play().catch(() => finishRef.current())
      })
    }} />
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="kiosk-heading"><span>{L('DEMO PLAY', '游戏演示')}</span><strong>{demo.name}</strong></div>
    <div className="kiosk-combo"><strong ref={comboRef}>0× COMBO</strong><span>{L('ALL PERFECT', '全部完美')}</span></div>
    <div className="kiosk-join"><strong>{L('YOUR TURN?', '轮到你了？')}</strong><span>{L('PRESS ANY BUTTON TO PLAY', '按任意键开始游戏')}</span>{muted && <small>{L('Tap to join the music', '点击加入音乐')}</small>}</div>
  </section>
}
