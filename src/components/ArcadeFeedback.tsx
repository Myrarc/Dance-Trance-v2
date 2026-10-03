import { useEffect, useRef, useState } from 'react'
import { T } from '../i18n'
import { playSfx } from '../lib/sfx'
import { comboMilestone } from '../game/feedback'
import type { GamePhase, PlayerRound } from '../pose/gameplay'
import type { ScoreDebug } from './WebcamPanel'

function ComboCelebration({ combo }: { combo: number }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 1100)
    return () => window.clearTimeout(timer)
  }, [])
  return visible ? <span className="combo-celebration" role="status"><i aria-hidden="true">✦</i> {combo} {T('combo')}!</span> : null
}

export function ArcadeHud({ players, playerCount, phase, soundMuted, scoreDebug, onPause }: {
  players: PlayerRound[]
  playerCount: number
  phase: GamePhase
  soundMuted: boolean
  scoreDebug: ScoreDebug[]
  onPause: () => void
}) {
  const previousCombos = useRef<number[]>([])
  const sequence = useRef(0)
  const [celebrations, setCelebrations] = useState<({ combo: number; id: number } | null)[]>([])
  useEffect(() => {
    const milestones = players.map((player, index) => comboMilestone(previousCombos.current[index] ?? 0, player.combo))
    previousCombos.current = players.map((player) => player.combo)
    if (!milestones.some(Boolean)) return
    const id = ++sequence.current
    setCelebrations((previous) => milestones.map((combo, index) => combo ? { combo, id } : previous[index] ?? null))
    // Two players reaching a milestone together share one reward sound.
    playSfx('combo', soundMuted)
  }, [players, soundMuted])
  return <section className="game-flow game-playing" hidden={phase !== 'playing'}>
    <div className={`arcade-scoreboard${playerCount > 1 ? ' is-multiplayer' : ''}`}>
      {Array.from({ length: Math.max(1, playerCount) }, (_, index) => {
        const player = players[index]
        const combo = player?.combo ?? 0
        const celebration = celebrations[index]
        const progress = combo ? (combo - 1) % 5 + 1 : 0
        return <article className="arcade-player-score" key={index} aria-label={`${T('Player')} ${index + 1}`}>
          <span className="arcade-player-tag">P{index + 1}</span>
          <strong className="arcade-score" aria-label={T('Score')}>{player?.score.toLocaleString() ?? '0'}</strong>
          <span className={`arcade-combo${combo >= 5 ? ' is-hot' : ''}`}>{combo ? `${combo}× ${T('combo')}` : T('build your combo')}</span>
          <span className="combo-pips" aria-hidden="true">{Array.from({ length: 5 }, (_, pip) => <i key={pip} className={pip < progress ? 'is-filled' : undefined} />)}</span>
          {celebration && combo >= celebration.combo && <ComboCelebration key={celebration.id} combo={celebration.combo} />}
          {import.meta.env.DEV && scoreDebug[index] && <small className="score-debug">{scoreDebug[index].cue} · {scoreDebug[index].grade} · {Math.round(scoreDebug[index].lag * 1000)}ms</small>}
        </article>
      })}
    </div>
    <button className="pause-button" onClick={onPause} aria-label={T('Pause')}>Ⅱ</button>
  </section>
}

export function RoundSignal({ phase, countdown }: { phase?: GamePhase; countdown?: number }) {
  const previousPhase = useRef(phase)
  const [showGo, setShowGo] = useState(false)
  useEffect(() => {
    const starting = previousPhase.current === 'countdown' && phase === 'playing'
    previousPhase.current = phase
    setShowGo(starting)
    if (!starting) return
    const timer = window.setTimeout(() => setShowGo(false), 800)
    return () => window.clearTimeout(timer)
  }, [phase])
  if (phase === 'countdown') return <div key={countdown} className="game-countdown" aria-live="assertive">
    <span>{T('Ready')}</span><strong>{countdown}</strong><small>{T('Follow the dancer')}</small>
  </div>
  return showGo ? <div className="game-go" role="status">{T('GO!')}</div> : null
}
