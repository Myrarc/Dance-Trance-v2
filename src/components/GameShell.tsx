import ScoringRecorder from './ScoringRecorder'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { T, L } from '../i18n'
import { accuracy, recordEligible, type PlayerRound } from '../pose/gameplay'
import type { Difficulty } from '../pose/hitTargets'
import { gradeFromAccuracy, type ArcadeRecord, type Grade } from '../game/records'
import { MENU_THEMES, type GameSettings } from '../lib/gameSettings'
import { photoStage } from '../game/resultPhoto'

function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = ref.current
    const focusableElements = () => modal
      ? [...modal.querySelectorAll<HTMLElement>('button, input, summary, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0)
      : []
    const focusFrame = requestAnimationFrame(() => focusableElements()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modal) return
      const focusable = focusableElements()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!modal.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref])
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? ' compact' : ''}`}>
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Dance Trance" />
    </div>
  )
}

export function HomeScreen({ trackingReady, selected, motion, onMove, onSelect, account }: {
  trackingReady: boolean
  selected: number
  motion: { direction: 'left' | 'right'; turn: number } | null
  onMove: (direction: 'left' | 'right') => void
  onSelect: () => void
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
        <div className="home-top-actions" data-gesture-skip><div className="home-account">{account}</div></div>
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
      <div className="home-mobile-controls">
        <button className="btn" onClick={() => onMove('left')}>{L('← Previous', '← 上一个')}</button>
        <button className="btn" onClick={() => onMove('right')}>{L('Next →', '下一个 →')}</button>
      </div>
    </main>
  )
}

export function WelcomeOverlay({ onStart, onExplore }: {
  onStart: () => void
  onExplore: () => void
}) {
  const modalRef = useRef<HTMLElement>(null)
  useModalFocus(modalRef)

  return (
    <section ref={modalRef} className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <span className="welcome-step">{T('Ready when you are')}</span>
        <h2 id="welcome-title">{T('Your video.')}<br />{T('Your moves.')}<br />{T('Your arcade.')}</h2>
        <p>{L('Turn a dance video into a one or two-player rhythm game.', '把舞蹈视频变成单人或双人节奏游戏。')}</p>
        <div className="welcome-actions">
          <button className="btn primary" onClick={onStart}>{T('Let’s dance')}</button>
          <button className="btn subtle" onClick={onExplore}>{T('Explore first')}</button>
        </div>
      </div>
    </section>
  )
}

function Toggle({ label, detail, checked, onChange }: {
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="setting-row">
      <span><strong>{T(label)}</strong><small>{T(detail)}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
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
  useModalFocus(modalRef)
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <main ref={modalRef} className="destination-screen settings-screen" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-gesture-surface onKeyDown={(event) => {
      if (event.key === 'Escape') onClose()
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLInputElement) return
      if (event.key.toLowerCase() === 'z') beatSequenceRef.current = performance.now()
      else if (event.key.toLowerCase() === 'x' && beatSequenceRef.current > 0 && performance.now() - beatSequenceRef.current <= 1000) { beatSequenceRef.current = 0; onOpenBeatLab?.() }
      else beatSequenceRef.current = 0
    }}>
      <div className="screen-title-row">
        <div><span className="kicker">{T('Player preferences')}</span><h1 id="settings-title">{T('Settings')}</h1></div>
        <button className="btn" onClick={onClose}>{T('Back')}</button>
      </div>
      <section className="settings-grid">
        <div className="settings-card">
          <h2>{T('Gameplay')}</h2>
          <Toggle label="Show reference skeleton" detail="Display the pose guide over the reference video." checked={settings.showSkeletons} onChange={(value) => update('showSkeletons', value)} />
          <Toggle label="Show camera skeleton" detail="Display your tracked pose over the live camera." checked={settings.showCameraSkeletons} onChange={(value) => update('showCameraSkeletons', value)} />
          <Toggle label="Track head movements" detail="Include head cues and head position in scoring." checked={settings.trackHead} onChange={(value) => update('trackHead', value)} />
        </div>
        <div className="settings-card">
          <h2>{T('Comfort')}</h2>
          <Toggle label="Sound effects" detail="Countdown, judgments, combos, and results feedback." checked={!settings.soundMuted} onChange={(value) => update('soundMuted', !value)} />
          <Toggle label="Full motion effects" detail="Turn off for calmer transitions and celebrations." checked={!settings.reducedEffects} onChange={(value) => update('reducedEffects', !value)} />
        </div>
        <fieldset className="settings-card music-card">
          <legend>{L('Menu music', '菜单音乐')}</legend>
          <div className="theme-options">
            {[...MENU_THEMES, { id: 'off', label: 'Off' } as const].map((theme) => <button key={theme.id} type="button" className={`btn${settings.menuTheme === theme.id ? ' active' : ''}`} aria-pressed={settings.menuTheme === theme.id} onClick={() => update('menuTheme', theme.id)}>{theme.id === 'off' ? T('Off') : theme.label}</button>)}
          </div>
          <button type="button" className="btn" onClick={onOpenBeatLab}>{L('Open Beat Lab', '打开节拍编辑器')}</button>
        </fieldset>
        <fieldset className="settings-card language-card">
          <legend>{T('Language')}</legend>
          <label><input type="radio" name="language" checked={settings.language === 'en'} onChange={() => update('language', 'en')} /> English</label>
          <label><input type="radio" name="language" checked={settings.language === 'zh'} onChange={() => update('language', 'zh')} /> 中文</label>
        </fieldset>
        <details className="settings-card advanced-settings"><summary>{L('Advanced tools', '高级工具')}</summary>
          <button className="btn primary" onClick={onOpenDiagnostics}>{L('Camera diagnostics', '摄像头检测')}</button>
          <p>{L('Try three movements and check tracking before you play.', '开始游戏前，试做三个动作并检查追踪效果。')}</p>
          <Toggle label="Show pose diagnostics" detail="Display tracking confidence and selection details over the game." checked={settings.showPoseDebug} onChange={(value) => update('showPoseDebug', value)} />
          <ScoringRecorder />
        </details>
      </section>
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
    <section ref={modalRef} className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-gesture-surface>
      <div className="pause-card">
        <span className="kicker">{T('Take a breath')}</span>
        <h2 id="pause-title">{T('Paused')}</h2>
        <button className="btn primary" onClick={onResume}>{T('Resume')}</button>
        <button className="btn" onClick={onRestart}>{T('Restart song')}</button>
        <button className="btn" onClick={onSettings}>{T('Settings')}</button>
        <button className="btn subtle" onClick={onQuit}>{T('Quit to Home')}</button>
        <small>{T('Press Escape to resume')}</small>
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

export function ResultsScreen({ players, difficulty, records, reducedEffects, photoRound, photoPrompt, onCapture, onReplay, onChooseSong, onHome }: {
  players: PlayerRound[]
  difficulty: Difficulty
  records: (ResultRecord | null)[]
  reducedEffects: boolean
  photoRound: number
  photoPrompt: string
  onCapture: () => Promise<void>
  onReplay: () => void
  onChooseSong: () => void
  onHome: () => void
}) {
  const [photoTime, setPhotoTime] = useState(0)
  const [photoStatus, setPhotoStatus] = useState<'waiting' | 'saving' | 'saved' | 'error' | 'cancelled'>('waiting')
  const [flash, setFlash] = useState(false)
  const captureRef = useRef(onCapture)
  captureRef.current = onCapture
  useEffect(() => {
    let active = true
    let pending = true
    let startedAt = performance.now()
    let timer = 0
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
      if (!reducedEffects) setFlash(true)
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
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [photoRound, reducedEffects])
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
  const stage = photoStage(photoTime)
  return (
    <section className="results-card" aria-labelledby="results-title">
      <span className="results-eyebrow">{T('Routine complete')} · {T(difficulty)}</span>
      <h2 id="results-title">{T('Final score')}</h2>
      <div className={`result-players${players.length > 1 ? ' is-multiplayer' : ''}`}>
        {players.map((player, index) => {
          const resultAccuracy = accuracy(player)
          const grade: Grade = gradeFromAccuracy(resultAccuracy)
          return (
            <article key={index}>
              {records[index]?.isNewBest && <span className="new-record">{T('New record')}</span>}
              <h3>{T('Player')} {index + 1}</h3>
              <div className="result-headline">
                <div className={`grade-stamp grade-${grade.toLowerCase()}`} aria-label={`${T('Grade')} ${grade}`}>{grade}</div>
                <strong className="result-score"><AnimatedScore value={player.score} reduced={reducedEffects} /></strong>
              </div>
              <div className="result-breakdown">
                <div className="result-stat"><span>{T('accuracy')}</span><b>{resultAccuracy}%</b></div>
                <div className="result-stat"><span>{T('max combo')}</span><b>{player.maxCombo}×</b></div>
                <div className="result-hit result-hit-perfect"><span>{T('Perfect')}</span><b>{player.perfect}</b></div>
                <div className="result-hit result-hit-good"><span>{T('Good')}</span><b>{player.good}</b></div>
                <div className="result-hit result-hit-miss"><span>{T('Miss')}</span><b>{player.miss}</b></div>
                {!recordEligible(player) && <small>{L('Personal best unavailable — camera could not score enough moves.', '无法记录个人最佳：摄像头未能评分足够多的动作。')}</small>}
                {records[index] && <small className="result-best">{T('Personal best')}: {records[index].record.bestScore.toLocaleString()}</small>}
              </div>
            </article>
          )
        })}
      </div>
      <div className="result-actions">
        <button className="btn primary" onClick={onReplay} autoFocus>{T('Play again')}</button>
        <button className="btn" onClick={onChooseSong}>{T('Choose another song')}</button>
        <button className="btn result-home" onClick={onHome}>{T('Home')}</button>
      </div>
      {photoStatus === 'saved' && <p className="result-photo-status" role="status">{L('Photo saved to Library → Photos', '照片已保存到舞蹈库 → 照片')}</p>}
      {photoStatus === 'saving' && <p className="result-photo-status" role="status">{L('Saving your photo…', '正在保存照片…')}</p>}
      {(photoStatus === 'error' || photoStatus === 'cancelled') && <p className="result-photo-status" role="alert">{L(photoStatus === 'error' ? 'Photo could not be saved.' : 'Photo countdown stopped when this page was hidden.', photoStatus === 'error' ? '照片未能保存。' : '页面隐藏时，拍照倒计时已停止。')} <button className="btn" onClick={retryPhoto}>{L('Retry photo', '重试拍照')}</button></p>}
      <p className="gesture-hint">{T('Right hand up to replay · left hand up to choose a song')}</p>
      {photoStatus === 'waiting' && stage.phase === 'posing' && createPortal(<div className="result-photo-prompt" role="status" aria-live="polite"><strong>{T(photoPrompt)}</strong><span>{stage.digit}</span></div>, document.body)}
      {flash && createPortal(<div className="result-photo-flash" aria-hidden="true" />, document.body)}
    </section>
  )
}
