export const MENU_THEMES = [
  { id: 'theme1', label: 'Menu Theme 1', file: 'menu-theme-1.mp3' },
  { id: 'theme2', label: 'Menu Theme 2', file: 'menu-theme-2.mp3' },
  { id: 'theme3', label: 'Menu Theme 3', file: 'menu-theme-3.mp3' },
  { id: 'coin', label: 'Coin Arpeggio', file: 'coin-arpeggio.mp3' },
] as const

export type MenuTheme = 'off' | (typeof MENU_THEMES)[number]['id']

export interface GameSettings {
  soundMuted: boolean
  menuTheme: MenuTheme
  reducedEffects: boolean
  language: 'en' | 'zh'
  showSkeletons: boolean
  showCameraSkeletons: boolean
  trackHead: boolean
  showPoseDebug: boolean
}

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const SETTINGS_KEY = 'dance-trance:game-settings'

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  soundMuted: false,
  menuTheme: 'theme1',
  reducedEffects: false,
  language: 'en',
  showSkeletons: false,
  showCameraSkeletons: true,
  trackHead: false,
  showPoseDebug: false,
}

function browserStorage(): SettingsStorage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
export function loadGameSettings(storage: SettingsStorage | null = browserStorage()): GameSettings {
  if (!storage) return DEFAULT_GAME_SETTINGS
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GameSettings>
    return {
      soundMuted: typeof saved.soundMuted === 'boolean' ? saved.soundMuted : false,
      menuTheme: saved.menuTheme === 'off' || MENU_THEMES.some((theme) => theme.id === saved.menuTheme)
        ? saved.menuTheme as MenuTheme : 'theme1',
      reducedEffects: typeof saved.reducedEffects === 'boolean' ? saved.reducedEffects : false,
      language: saved.language === 'zh' ? 'zh' : 'en',
      showSkeletons: typeof saved.showSkeletons === 'boolean' ? saved.showSkeletons : false,
      showCameraSkeletons: typeof saved.showCameraSkeletons === 'boolean'
        ? saved.showCameraSkeletons
        : typeof saved.showSkeletons === 'boolean' ? saved.showSkeletons : true,
      trackHead: typeof saved.trackHead === 'boolean' ? saved.trackHead : false,
      showPoseDebug: typeof saved.showPoseDebug === 'boolean' ? saved.showPoseDebug : false,
    }
  } catch {
    return DEFAULT_GAME_SETTINGS
  }
}

export function saveGameSettings(
  settings: GameSettings,
  storage: SettingsStorage | null = browserStorage(),
) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Settings are optional; keep the active session working in private mode.
  }
}
