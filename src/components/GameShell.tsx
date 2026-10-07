import { useModalFocus } from '../lib/useModalFocus'
import ScoringRecorder from './ScoringRecorder'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { T, L } from '../i18n'
import { accuracy, movementResults, recordEligible, trackingCoverage, type PlayerRound } from '../pose/gameplay'
import type { Difficulty } from '../pose/hitTargets'
import { gradeFromAccuracy, type ArcadeRecord, type Grade } from '../game/records'
import { MENU_THEMES, type GameSettings } from '../lib/gameSettings'
import { photoStage } from '../game/resultPhoto'


export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? ' compact' : ''}`}>
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Dance Trance" />
    </div>
  )
}

export function MenuGuide({ back = 'Back', suspended = false }: { back?: string; suspended?: boolean }) {
  return <div className={`distance-menu-guide${suspended ? ' is-suspended' : ''}`} role="note" aria-label={T('Gesture controls')}>
    <span><b aria-hidden="true">← →</b>{T('Arms out: browse')}</span>
    <span><b aria-hidden="true">↑</b>{T('Right hand up: select highlighted action')}</span>
    <span><b aria-hidden="true">↶</b>{T('Left hand up')}: {T(back)}</span>
    <small>{T('Hold for three beats')} · {T('Arrow keys')} · Enter · Esc</small>
  </div>
}

export function HomeScreen({ trackingReady, selected, motion, onMove, onSelect, onChoose, account }: {
  trackingReady: boolean
  selected: number
  motion: { direction: 'left' | 'right'; turn: number } | null
  onMove: (direction: 'left' | 'right') => void
  onSelect: () => void
  onChoose: (index: number) => void
  account: ReactNode
}) {
  const centerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => centerRef.current?.focus({ preventScroll: true }), [selected])
  const options = [
    { title: T('Play'), art: 'play' },
    { title: T('Practice Studio'), art: 'practice' },
    { title: L('Beatmap Editor', '谱面编辑器'), art: 'library' },
    { title: L('Photos', '照片'), art: 'camera' },
    { title: T('Settings'), art: 'settings' },
    { title: T('Camera setup'), art: 'camera' },
  ]
  const guide = [
    { art: 'previous', action: T('Previous'), pose: L('Left arm out', '伸出左臂') },
    { art: 'next', action: T('Next'), pose: L('Right arm out', '伸出右臂') },
    { art: 'select', action: T('Select'), pose: L('Right hand up', '举起右手') },
    { art: 'back', action: T('Back'), pose: L('Left hand up', '举起左手') },
  ]

  return (
    <main className="home-screen" data-gesture-surface onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        onMove(event.key === 'ArrowLeft' ? 'left' : 'right')
      }
    }}>
      <div className="home-topline">
        <Brand />
        <div className="home-top-actions" data-gesture-skip><nav className="home-tools" aria-label="Tools">{[2, 3, 4].map((index) => <button className="btn subtle" key={index} onClick={() => onChoose(index)}>{options[index].title}</button>)}</nav><div className="home-account">{account}</div></div>
      </div>
      <section className="home-hero">
        <div className="home-copy">
          <h1>{T('Choose your game.')}</h1>
          <p>{T(trackingReady ? 'Move through the menu with your arms, then raise your right hand to choose.' : 'Use the buttons or open Camera setup to enable gesture controls.')}</p>
        </div>
      </section>
      <section className="home-navigation-guide" aria-label={L('How to navigate with poses', '如何用动作导航')}>
        {guide.map(({ art, action, pose }) => <div className="home-guide-step" key={art}>
          <img src={`${import.meta.env.BASE_URL}menu/nav-${art}.webp`} alt="" aria-hidden="true" draggable={false} />
          <span><strong>{action}</strong><small>{pose}</small></span>
        </div>)}
      </section>
      <nav key={motion?.turn ?? 0} className={`song-carousel home-carousel${motion ? ` is-moving-${motion.direction}` : ''}`} aria-label={T('Game modes')}>
        {([-1, 0, 1] as const).map((offset) => {
          const index = (selected + offset + options.length) % options.length
          const option = options[index]
          const position = offset === -1 ? 'left' : offset === 1 ? 'right' : 'center'
          return <button
            key={index}
            ref={offset === 0 ? centerRef : undefined}
            className={`song-card song-card-${position} home-card`}
            aria-current={offset === 0 ? 'true' : undefined}
            aria-label={option.title}
            onClick={() => offset === 0 ? onSelect() : onMove(offset === -1 ? 'left' : 'right')}
          >
            <img className="home-card-art" src={`${import.meta.env.BASE_URL}menu/${option.art}.webp`} alt="" aria-hidden="true" draggable={false} />
            <strong>{option.title}</strong>
          </button>
        })}
      </nav>
      <p className="home-carousel-position" aria-live="polite">{selected + 1} / {options.length} · {options[selected].title}</p>
      <div className="home-mobile-controls">
        <button className="btn" onClick={() => onMove('left')}>{L('← Previous', '← 上一个')}</button>
        <button className="btn" onClick={() => onMove('right')}>{L('Next →', '下一个 →')}</button>
      </div>
    </main>
  )
}

function Toggle({ label, detail, checked, onChange, defaultSelected = false }: {
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
  defaultSelected?: boolean
}) {
  return (
    <label className="setting-row">
      <span><strong>{T(label)}</strong><small>{T(detail)}</small></span>
      <input type="checkbox" data-gesture-default={defaultSelected ? '' : undefined} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
      <b className="setting-value" aria-hidden="true">{T(checked ? 'On' : 'Off')}</b>
    </label>
  )
}

export function SettingsScreen({ settings, onChange, onClose, onOpenBeatLab, onOpenDiagnostics }: {
  settings: GameSettings
  onChange: (next: GameSettings) => void
  onClose: () => void
  onOpenBeatLab?: () => void
  onOpenDiagnostics?: () => void
}) {
  const modalRef = useRef<HTMLElement>(null)
  const beatSequenceRef = useRef(0)
  const [category, setCategory] = useState<'gameplay' | 'comfort' | 'language' | 'tools' | null>(null)
  useModalFocus(modalRef)
  useEffect(() => {
    const frame = requestAnimationFrame(() => modalRef.current?.querySelector<HTMLElement>('[data-gesture-default]')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [category])
  const back = () => category ? setCategory(null) : onClose()
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <main ref={modalRef} className="destination-screen settings-screen distance-menu" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-gesture-surface data-menu-priority="1" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); back(); return }
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLInputElement) return
      if (event.key.toLowerCase() === 'z') beatSequenceRef.current = performance.now()
      else if (event.key.toLowerCase() === 'x' && beatSequenceRef.current > 0 && performance.now() - beatSequenceRef.current <= 1000) { beatSequenceRef.current = 0; onOpenBeatLab?.() }
      else beatSequenceRef.current = 0
    }}>
      <div className="screen-title-row">
        <div><span className="kicker">{T('Player preferences')}</span><h1 id="settings-title">{T('Settings')}</h1></div>
        <button className="btn" data-menu-back onClick={back}>{T(category ? 'Back to categories' : 'Back')}</button>
      </div>
      {!category && <section className="settings-categories">
        {([
          ['gameplay', 'Gameplay', 'Skeletons and head scoring'],
          ['comfort', 'Sound & comfort', 'Music, effects, and score photos'],
          ['language', 'Language', 'Choose your display language'],
          ['tools', 'Tools', 'Tracking checks and device-side editors'],
        ] as const).map(([id, label, detail], index) => <button key={id} className="btn settings-category" data-gesture-default={index === 0 ? '' : undefined} data-gesture-label={T(label)} onClick={() => setCategory(id)}><strong>{T(label)}</strong><span>{T(detail)}</span></button>)}
      </section>}
      <section className="settings-page">
        {category === 'gameplay' && <div className="settings-card">
          <h2>{T('Gameplay')}</h2>
          <Toggle defaultSelected label="Show reference skeleton" detail="Display the pose guide over the reference video." checked={settings.showSkeletons} onChange={(value) => update('showSkeletons', value)} />
          <Toggle label="Show camera skeleton" detail="Display your tracked pose over the live camera." checked={settings.showCameraSkeletons} onChange={(value) => update('showCameraSkeletons', value)} />
          <Toggle label="Track head movements" detail="Include head cues and head position in scoring." checked={settings.trackHead} onChange={(value) => update('trackHead', value)} />
        </div>}
        {category === 'comfort' && <div className="settings-card">
          <h2>{T('Sound & comfort')}</h2>
          <Toggle defaultSelected label="Sound effects" detail="Countdown, judgments, combos, and results feedback." checked={!settings.soundMuted} onChange={(value) => update('soundMuted', !value)} />
          <Toggle label="Full motion effects" detail="Turn off for calmer transitions and celebrations." checked={!settings.reducedEffects} onChange={(value) => update('reducedEffects', !value)} />
          <Toggle label="Score photos" detail="Automatically take a local photo after each round." checked={settings.resultPhotos} onChange={(value) => update('resultPhotos', value)} />
          <button className="btn setting-choice" onClick={() => {
            const choices = [...MENU_THEMES.map((theme) => theme.id), 'off'] as const
            update('menuTheme', choices[(choices.indexOf(settings.menuTheme) + 1) % choices.length])
          }}>{T('Menu music')}: <strong>{MENU_THEMES.find((theme) => theme.id === settings.menuTheme)?.label ?? T('Off')}</strong><span>{T('Select to change')}</span></button>
        </div>}
        {category === 'language' && <fieldset className="settings-card language-card">
          <legend>{T('Language')}</legend>
          <label><input type="radio" data-gesture-default name="language" checked={settings.language === 'en'} onChange={() => update('language', 'en')} /> English</label>
          <label><input type="radio" name="language" checked={settings.language === 'zh'} onChange={() => update('language', 'zh')} /> 中文</label>
        </fieldset>}
        {category === 'tools' && <div className="settings-card advanced-settings">
          <h2>{T('Tools')}</h2>
          <button className="btn primary" data-gesture-default onClick={onOpenDiagnostics}>{L('Camera diagnostics', '摄像头检测')}</button>
          <button className="btn" onClick={onOpenBeatLab}>{L('Open Beat Lab', '打开节拍编辑器')} <small>{T('Edit timing at the device')}</small></button>
          <Toggle label="Show pose diagnostics" detail="Display tracking confidence and selection details over the game." checked={settings.showPoseDebug} onChange={(value) => update('showPoseDebug', value)} />
          <details className="device-settings-tools" data-gesture-skip><summary>Scoring recorder · use at the device</summary><ScoringRecorder /></details>
        </div>}
      </section>
      <MenuGuide back={category ? 'Back to categories' : 'Back'} />
    </main>
  )
}

export function PauseOverlay({ onResume, onRestart, onSettings, onQuit }: {
  onResume: () => void
  onRestart: () => void
  onSettings: () => void
  onQuit: () => void
}) {
  const modalRef = useRef<HTMLElement>(null)
  useModalFocus(modalRef)
  return (
    <section ref={modalRef} className="pause-overlay distance-menu" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-gesture-surface data-menu-priority="1">
      <div className="pause-card">
        <span className="kicker">{T('Take a breath')}</span>
        <h2 id="pause-title">{T('Paused')}</h2>
        <button className="btn primary" data-gesture-default data-menu-back onClick={onResume}>{T('Resume')}</button>
        <button className="btn" onClick={onRestart}>{T('Restart song')}</button>
        <button className="btn" onClick={onSettings}>{T('Settings')}</button>
        <button className="btn subtle" onClick={onQuit}>{T('Quit to Home')}</button>
        <MenuGuide back="Resume" />
      </div>
    </section>
  )
}

function AnimatedScore({ value, reduced }: { value: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? value : 0)
  useEffect(() => {
    if (reduced) {
      setShown(value)
      return
    }
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 850)
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduced, value])
  return <>{shown.toLocaleString()}</>
}

export interface ResultRecord {
  record: ArcadeRecord
  isNewBest: boolean
}

export function ResultsScreen({ players, difficulty, records, reducedEffects, photoRound, photoPrompt, takePhoto = true, onCapture, onPhotoPendingChange, onReplay, onChooseSong, onHome }: {
  players: PlayerRound[]
  difficulty: Difficulty
  records: (ResultRecord | null)[]
  reducedEffects: boolean
  photoRound: number
  photoPrompt: string
  takePhoto?: boolean
  onCapture: () => Promise<void>
  onPhotoPendingChange?: (pending: boolean) => void
  onReplay: () => void
  onChooseSong: () => void
  onHome: () => void
}) {
  const [photoTime, setPhotoTime] = useState(0)
  const [photoStatus, setPhotoStatus] = useState<'waiting' | 'saving' | 'saved' | 'error' | 'cancelled' | 'skipped'>(takePhoto ? 'waiting' : 'skipped')
  const [showDetails, setShowDetails] = useState(false)
  const replayRef = useRef<HTMLButtonElement>(null)
  const photoPending = photoStatus === 'waiting' || photoStatus === 'saving'
  const [flash, setFlash] = useState(false)
  const captureRef = useRef(onCapture)
  captureRef.current = onCapture
  const reducedEffectsRef = useRef(reducedEffects)
  reducedEffectsRef.current = reducedEffects
  const cancelPhotoRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    onPhotoPendingChange?.(photoStatus === 'waiting' || photoStatus === 'saving')
  }, [photoStatus, onPhotoPendingChange])
  useEffect(() => {
    if (!takePhoto) { setPhotoStatus('skipped'); return }
    setPhotoStatus('waiting')
    let active = true
    let pending = true
    let startedAt = performance.now()
    let timer = 0
    cancelPhotoRef.current = () => { pending = false; window.clearInterval(timer) }
    const tick = () => {
      if (!pending) return
      if (document.hidden) {
        pending = false
        window.clearInterval(timer)
        setPhotoStatus('cancelled')
        return
      }
      const elapsed = performance.now() - startedAt
      setPhotoTime(elapsed)
      if (photoStage(elapsed).phase !== 'capture') return
      pending = false
      window.clearInterval(timer)
      setPhotoStatus('saving')
      if (!reducedEffectsRef.current) setFlash(true)
      void captureRef.current().then(() => {
        if (!active) return
        setPhotoStatus('saved')
      }).catch(() => { if (active) setPhotoStatus('error') })
    }
    const onVisibility = () => {
      if (!document.hidden || !pending) return
      pending = false
      window.clearInterval(timer)
      setPhotoStatus('cancelled')
    }
    if (document.hidden) onVisibility()
    else {
      startedAt = performance.now()
      timer = window.setInterval(tick, 80)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      cancelPhotoRef.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [photoRound, takePhoto])
  useEffect(() => {
    if (!photoPending) replayRef.current?.focus({ preventScroll: true })
  }, [photoPending])
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), 1500)
    return () => window.clearTimeout(timer)
  }, [flash])
  const retryPhoto = () => {
    setPhotoStatus('saving')
    if (!reducedEffects) setFlash(true)
    void captureRef.current().then(() => {
      setPhotoStatus('saved')
    }).catch(() => setPhotoStatus('error'))
  }
  const skipPhoto = () => {
    cancelPhotoRef.current?.()
    setPhotoStatus('skipped')
  }
  const stage = photoStage(photoTime)
  return (
    <section className={`results-card distance-menu${showDetails ? ' is-details' : ''}${photoPending ? ' is-photo-pending' : ''}`} aria-labelledby="results-title" onKeyDown={(event) => {
      if (event.key === 'Escape' && photoStatus === 'waiting') { event.preventDefault(); event.stopPropagation(); skipPhoto() }
    }}>
      <span className="results-eyebrow">{T('Routine complete')} · {T(difficulty)}</span>
      <h2 id="results-title">{T('Final score')}</h2>
      <div className={`result-players${players.length > 1 ? ' is-multiplayer' : ''}`}>
        {players.map((player, index) => {
          const resultAccuracy = accuracy(player)
          const movements = movementResults(player)
          const grade: Grade = gradeFromAccuracy(resultAccuracy)
          return (
            <article key={index} className={records[index]?.isNewBest ? 'is-new-record' : undefined}>
              {records[index]?.isNewBest && <span className="new-record"><i aria-hidden="true">✦</i> {T('New record')}</span>}
              <h3>{T('Player')} {index + 1}</h3>
              <div className="result-headline">
                <div className={`grade-stamp grade-${grade.toLowerCase()}`} aria-label={`${T('Grade')} ${grade}`}>{grade}</div>
                <strong className="result-score"><AnimatedScore value={player.score} reduced={reducedEffects} /></strong>
              </div>
              <div className="result-summary" hidden={showDetails}>
                <div><span>{T('Accuracy')}</span><b>{resultAccuracy}%</b></div>
                <div><span>{T('max combo')}</span><b>{player.maxCombo}×</b></div>
              </div>
              <div className="result-breakdown" hidden={!showDetails}>
                <h4>{T('Movement breakdown')}</h4>
                <div className="result-stat"><span>{T('Movement + timing accuracy')}</span><b>{resultAccuracy}%</b></div>
                <div className="result-stat"><span>{T('max combo')}</span><b>{player.maxCombo}×</b></div>
                <div className="result-judgments"><div className="result-hit result-hit-perfect"><span>{T('Perfect match')}</span><b>{player.perfect}</b></div>
                <div className="result-hit result-hit-good"><span>{T('Good match')}</span><b>{player.good}</b></div>
                <div className="result-hit result-hit-miss"><span>{T('Missed move')}</span><b>{player.miss}</b></div></div>
                <small>{L(`${movements.scored} movements scored · ${trackingCoverage(player)}% tracking coverage`, `已评分 ${movements.scored} 个动作 · 追踪覆盖率 ${trackingCoverage(player)}%`)}</small>
                {movements.unscored > 0 && <small>{L(`${movements.unscored} not scored due to tracking`, `${movements.unscored} 个动作因追踪不足未评分`)}</small>}
                {!recordEligible(player) && <small>{L('Personal best unavailable — camera could not score enough moves.', '无法记录个人最佳：摄像头未能评分足够多的动作。')}</small>}
                {records[index] && <small className="result-best">{T('Personal best')}: {records[index].record.bestScore.toLocaleString()}</small>}
              </div>
              {!showDetails && <p className="result-tracking">{T('Tracking')}: {trackingCoverage(player)}%{!recordEligible(player) && <span>{T('Not enough tracking for a personal best.')}</span>}</p>}
            </article>
          )
        })}
      </div>
      <div className="result-actions">
        <button ref={replayRef} className="btn primary" data-gesture-default onClick={onReplay}>{T('Play again')}</button>
        <button className="btn" onClick={onChooseSong}>{T('Choose song')}</button>
        <button className="btn result-home" onClick={onHome}>{T('Home')}</button>
        <button className="btn" data-menu-back={showDetails ? '' : undefined} onClick={() => setShowDetails((value) => !value)}>{T(showDetails ? 'Hide details' : 'Details')}</button>
      </div>
      {photoStatus === 'waiting' && <p className="result-photo-status">{T('Photo in a moment. Menu gestures resume after the photo — lower your hands first.')} <button className="btn" onClick={skipPhoto}>{T('Skip photo')}</button></p>}
      {photoStatus === 'skipped' && takePhoto && <p className="result-photo-status" role="status">{T('Photo skipped. Lower your hands to use menu gestures.')}</p>}
      {photoStatus === 'saved' && <p className="result-photo-status" role="status">{T('Photo saved to Photos')}</p>}
      {photoStatus === 'saving' && <p className="result-photo-status" role="status">{L('Saving your photo…', '正在保存照片…')}</p>}
      {(photoStatus === 'error' || photoStatus === 'cancelled') && <p className="result-photo-status" role="alert">{L(photoStatus === 'error' ? 'Photo could not be saved.' : 'Photo countdown stopped when this page was hidden.', photoStatus === 'error' ? '照片未能保存。' : '页面隐藏时，拍照倒计时已停止。')} <button className="btn" onClick={retryPhoto}>{L('Retry photo', '重试拍照')}</button></p>}
      <MenuGuide suspended={photoPending} back={showDetails ? 'Hide details' : 'Choose song'} />
      {photoStatus === 'waiting' && stage.phase === 'posing' && createPortal(<div className="result-photo-prompt" role="status" aria-live="polite"><strong>{T(photoPrompt)}</strong><span>{stage.digit}</span><button className="btn" onClick={skipPhoto}>{T('Skip photo')}</button></div>, document.body)}
      {flash && createPortal(<div className="result-photo-flash" aria-hidden="true" />, document.body)}
    </section>
  )
}
