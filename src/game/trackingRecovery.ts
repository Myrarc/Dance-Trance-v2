import type { GamePhase } from '../pose/gameplay.ts'

export interface TrackingRecovery {
  mode: 'playing' | 'finding' | 'countdown'
  missingSince: number | null
  visibleSince: number | null
  countdownSince: number | null
}

export const initialTrackingRecovery: TrackingRecovery = {
  mode: 'playing', missingSince: null, visibleSince: null, countdownSince: null,
}

export function advanceTrackingRecovery(state: TrackingRecovery, present: boolean, nowMs: number): TrackingRecovery {
  if (state.mode === 'playing') {
    if (present) return initialTrackingRecovery
    const missingSince = state.missingSince ?? nowMs
    return { mode: nowMs - missingSince >= 1000 ? 'finding' : 'playing', missingSince, visibleSince: null, countdownSince: null }
  }
  if (!present) return { mode: 'finding', missingSince: state.missingSince, visibleSince: null, countdownSince: null }
  if (state.mode === 'finding') {
    const visibleSince = state.visibleSince ?? nowMs
    if (nowMs - visibleSince < 500) return { ...state, visibleSince }
    return { mode: 'countdown', missingSince: null, visibleSince, countdownSince: nowMs }
  }
  if (nowMs - (state.countdownSince ?? nowMs) >= 3000) return initialTrackingRecovery
  return state
}

export function recoveryCountdown(state: TrackingRecovery, nowMs: number): number | null {
  if (state.mode !== 'countdown' || state.countdownSince === null) return null
  return Math.max(1, 3 - Math.floor((nowMs - state.countdownSince) / 1000))
}

export function effectiveTrackingPhase(phase: GamePhase, recovery: TrackingRecovery): GamePhase {
  return phase === 'playing' && recovery.mode !== 'playing' ? 'paused' : phase
}

export function advanceRoundRecovery(state: TrackingRecovery, phase: GamePhase, present: boolean, nowMs: number): TrackingRecovery {
  return phase === 'playing' ? advanceTrackingRecovery(state, present, nowMs) : initialTrackingRecovery
}
