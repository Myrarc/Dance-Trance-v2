export type AppScreen = 'attract' | 'tracking' | 'home' | 'arcade' | 'practice' | 'editor' | 'photos' | 'settings'
export type ArcadePhase = 'setup' | 'countdown' | 'playing' | 'paused' | 'results'

export interface GameState {
  screen: AppScreen
  arcadePhase: ArcadePhase
  returnScreen: Exclude<AppScreen, 'settings'> | null
}

export type GameAction =
  | { type: 'wake' }
  | { type: 'openHome' }
  | { type: 'openArcade' }
  | { type: 'openPractice' }
  | { type: 'openEditor' }
  | { type: 'openPhotos' }
  | { type: 'openSettings' }
  | { type: 'closeSettings' }
  | { type: 'startCountdown' }
  | { type: 'countdownFinished' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'finishRound' }
  | { type: 'replay' }
  | { type: 'chooseSong' }
  | { type: 'quitHome' }

export const initialGameState: GameState = {
  screen: 'attract',
  arcadePhase: 'setup',
  returnScreen: null,
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'wake':
      return { ...initialGameState, screen: 'tracking' }
    case 'openHome':
      return { screen: 'home', arcadePhase: 'setup', returnScreen: null }
    case 'quitHome':
      return initialGameState
    case 'openArcade':
      return { screen: 'arcade', arcadePhase: 'setup', returnScreen: null }
    case 'openPractice':
      return { ...state, screen: 'practice', returnScreen: null }
    case 'openEditor':
      return { ...state, screen: 'editor', returnScreen: null }
    case 'openPhotos':
      return { ...state, screen: 'photos', returnScreen: null }
    case 'openSettings':
      return state.screen === 'settings'
        ? state
        : { ...state, screen: 'settings', returnScreen: state.screen }
    case 'closeSettings':
      return { ...state, screen: state.returnScreen ?? 'home', returnScreen: null }
    case 'startCountdown':
    case 'restart':
    case 'replay':
      return state.screen === 'arcade' ? { ...state, arcadePhase: 'countdown' } : state
    case 'countdownFinished':
      return state.screen === 'arcade' && state.arcadePhase === 'countdown'
        ? { ...state, arcadePhase: 'playing' }
        : state
    case 'pause':
      return state.screen === 'arcade' && state.arcadePhase === 'playing'
        ? { ...state, arcadePhase: 'paused' }
        : state
    case 'resume':
      return state.screen === 'arcade' && state.arcadePhase === 'paused'
        ? { ...state, arcadePhase: 'playing' }
        : state
    case 'finishRound':
      return state.screen === 'arcade' && state.arcadePhase === 'playing'
        ? { ...state, arcadePhase: 'results' }
        : state
    case 'chooseSong':
      return state.screen === 'arcade' ? { ...state, arcadePhase: 'setup' } : state
  }
}
