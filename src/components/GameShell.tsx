import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { T, L } from '../i18n'
import { accuracy, recordEligible, trackingCoverage, type PlayerRound } from '../pose/gameplay'
import type { Difficulty } from '../pose/hitTargets'
import { gradeFromAccuracy, type ArcadeRecord, type Grade } from '../game/records'
import { MENU_THEMES, type GameSettings } from '../lib/gameSettings'
import { photoStage } from '../game/resultPhoto'

function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = ref.current
    const focusableElements = () => modal
      ? [...modal.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('disabled'))
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

function HomeIcon({ index }: { index: number }) {
  const icons = [
    <path key="play" d="M7 3.5v17L21 12z" fill="currentColor" stroke="none" />,
    <g key="practice"><circle cx="12" cy="4" r="2" /><path d="M12 6v9M12 9 4 6m8 3 8-3m-8 9-5 7m5-7 5 7" /></g>,
    <g key="library"><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M8 8h8m-8 4h8m-8 4h5" /></g>,
    <g key="settings"><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1m0-15.6-2.1 2.1M6.3 17.7l-2.1 2.1" /></g>,
    <g key="camera"><rect x="2" y="5" width="20" height="16" rx="2" /><path d="m8 5 1.5-2h5L16 5" /><circle cx="12" cy="13" r="4" /></g>,
  ]
  return <svg className="home-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[index]}</svg>
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
    { title: T('Play'), body: T('Turn a song into an arcade round.'), tone: 'yellow' },
    { title: T('Practice Studio'), body: T('Loop, slow down, and focus on the parts that need work.'), tone: 'cyan' },
    { title: L('Library & photos', '舞蹈库与照片'), body: T('Pick up a prepared song or bring in a new dance video.'), tone: 'yellow' },
    { title: T('Settings'), body: T('Adjust tracking overlays, sound, language, and motion.'), tone: 'cream' },
    { title: T('Camera setup'), body: T('Reconnect tracking and register players again.'), tone: 'cyan' },
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
      <nav key={motion?.turn ?? 0} className={`song-carousel home-carousel${motion ? ` is-moving-${motion.direction}` : ''}`} aria-label={T('Game modes')}>
        {([-1, 0, 1] as const).map((offset) => {
          const index = (selected + offset + options.length) % options.length
          const option = options[index]
          const position = offset === -1 ? 'left' : offset === 1 ? 'right' : 'center'
          return <button
            key={index}
            ref={offset === 0 ? centerRef : undefined}
            className={`song-card song-card-${position} home-card home-card-${option.tone}`}
            aria-current={offset === 0 ? 'true' : undefined}
            aria-label={option.title}
            onClick={() => offset === 0 ? onSelect() : onMove(offset === -1 ? 'left' : 'right')}
          >
            <strong>{option.title}</strong>
            <small>{option.body}</small>
            <span className="home-card-footer"><HomeIcon index={index} /><i aria-hidden="true">{offset === 0 ? L('SELECT', '选择') : offset === -1 ? '←' : '→'}</i></span>
          </button>
        })}
      </nav>
      <div className="home-mobile-controls">
        <button className="btn" onClick={() => onMove('left')}>{L('← Previous', '← 上一个')}</button>
        <button className="btn" onClick={() => onMove('right')}>{L('Next →', '下一个 →')}</button>
      </div>
      <p className="home-navigation-hint">{L('← Previous · Next → · Right hand up or Enter to choose', '← 上一个 · 下一个 → · 举右手或按 Enter 选择')}</p>
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

export function SettingsScreen({ settings, onChange, onClose, onOpenBeatLab }: {
  settings: GameSettings
  onChange: (next: GameSettings) => void
  onClose: () => void
  onOpenBeatLab?: () => void
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
          <Toggle label="Show pose diagnostics" detail="Display tracking confidence and selection details over the game." checked={settings.showPoseDebug} onChange={(value) => update('showPoseDebug', value)} />
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
        </fieldset>
        <fieldset className="settings-card language-card">
          <legend>{T('Language')}</legend>
          <label><input type="radio" name="language" checked={settings.language === 'en'} onChange={() => update('language', 'en')} /> English</label>
          <label><input type="radio" name="language" checked={settings.language === 'zh'} onChange={() => update('language', 'zh')} /> 中文</label>
        </fieldset>
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
              <div className={`grade-stamp grade-${grade.toLowerCase()}`} aria-label={`${T('Grade')} ${grade}`}>{grade}</div>
              <h3>{T('Player')} {index + 1}</h3>
              <strong className="result-score"><AnimatedScore value={player.score} reduced={reducedEffects} /></strong>
              <div className="result-breakdown">
                  <span><b>{resultAccuracy}%</b> {T('accuracy')} · <b>{player.maxCombo}×</b> {T('max combo')}</span>
                  <small>{L(`${trackingCoverage(player)}% tracking coverage`, `追踪覆盖率 ${trackingCoverage(player)}%`)}</small>
                  {!recordEligible(player) && <small>{L('Provisional score — not enough tracked movement for a personal best.', '临时成绩：追踪到的动作不足，无法记为个人最佳。')}</small>}
                <small><b>P</b> {player.perfect} {T('Perfect')} · <b>G</b> {player.good} {T('Good')} · <b>M</b> {player.miss} {T('Miss')}</small>
                {records[index] && <small>{T('Personal best')}: {records[index].record.bestScore.toLocaleString()}</small>}
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
