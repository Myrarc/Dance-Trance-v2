import { RecordingBadge } from './components/ScoringRecorder'
import { activeMenuSurface, menuItems, menuItemLabel, markMenuSelection, menuKeyAction } from './lib/menuNavigation'
import { useMenuMotion } from './lib/useMenuMotion'
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TargetPose } from './components/VideoPanel'
import type { ScoreDebug } from './components/WebcamPanel'
import AccountBar from './components/AccountBar'
import { ArcadeHud } from './components/ArcadeFeedback'
import Library from './components/Library'
import ResultPhotoGallery from './components/ResultPhotoGallery'
import BeatLab from './components/BeatLab'
import UpdateToast from './components/UpdateToast'
import AttractKiosk from './components/AttractKiosk'
import { createAnalysisQueue } from './lib/analysisQueue'
import { loadSongEdit, isTrimmed, type SongEdit } from './lib/songEdits'
import { Brand, HomeScreen, MenuGuide, PauseOverlay, ResultsScreen, SettingsScreen, type ResultRecord } from './components/GameShell'
import { T, L, useLangTick, getLang, setLang } from './i18n'
import { LEVEL_COLORS, SIDE_COLORS } from './pose/skeleton'
import type { Focus } from './pose/angles'
import type { PoseTrack } from './pose/track'
import { buildArcadeChart } from './pose/arcadeChart'
import { activeHitFeedback } from './pose/arcade'
import {
  addSectionPractice, forget, getArcadeRecord, getTrack, getVideo, listArcadeRecords,
  listLibrary, mergeRemote, putArcadeRecord, putArcadeRecords, remember, saveSections,
  saveTrack, touch, type LibraryEntry, type Section,
} from './lib/library'
import {
  loadArcadeRecords, loadLibraryIndex, loadSessions, onAuthChange, statsByVideo,
  syncArcadeRecords, syncLibrary, onSyncPending, retryFailedSaves, type VideoStats,
} from './playkitClient'
import { MENU_THEMES, loadGameSettings, saveGameSettings, type GameSettings } from './lib/gameSettings'
import { startMenuTheme } from './lib/menuMusic'
import { sampleBeat } from './lib/attractBeat'
import { beatPulseAt } from './lib/menuPulse'
import { beatGlowAt, loadBeatMap, songBeatKey, themeBeatKey, type BeatMap } from './lib/beatMaps'
import { spawnEdgeStars } from './lib/edgeStars'
import { playSfx } from './lib/sfx'
import { accuracy, movementResults, recordEligible, trackingCoverage, type GamePhase, type HitFeedback, type ScoredHit, type PlayerRound } from './pose/gameplay'
import type { Difficulty } from './pose/hitTargets'
import type { GestureContext, MenuGesture } from './pose/gestures'
import { gameReducer, initialGameState, type AppScreen } from './game/state'
import { advanceRoundRecovery, effectiveTrackingPhase, initialTrackingRecovery, recoveryCountdown } from './game/trackingRecovery'
import { arcadeRecordId, mergeCloudRecords, recordCompletedRound, recordsForCloud, type ArcadeRecord } from './game/records'
import { photoPrompt } from './game/resultPhoto'
import { composeResultPhoto } from './lib/resultPhotoImage'
import { saveResultPhoto } from './lib/resultPhotos'

const VideoPanel = lazy(() => import('./components/VideoPanel'))
const SongEditor = lazy(() => import('./components/SongEditor'))
const WebcamPanel = lazy(() => import('./components/WebcamPanel'))

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']
const SCORE_FOCUSES: Focus[] = ['full', 'upper', 'lower']
const MENU_MUSIC_VOLUME = 0.4
const PREVIEW_VOLUME = 0.55
const AUDIO_FADE_MS = 500

function fadeVolume(audio: HTMLMediaElement, target: number, done?: () => void) {
  const start = audio.volume
  const startedAt = performance.now()
  let frame = 0
  const step = (now: number) => {
    const progress = Math.max(0, Math.min(1, (now - startedAt) / AUDIO_FADE_MS))
    audio.volume = start + (target - start) * progress
    if (progress < 1) frame = requestAnimationFrame(step)
    else done?.()
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

function LoadingStage() {
  return <div className="loading-stage" role="status">{T('Loading the dance floor…')}</div>
}

function PickerPose({ pose }: { pose: 'left' | 'right' | 'select' | 'back' }) {
  const leftArm = pose === 'left' ? 'M23 22 7 22' : pose === 'back' ? 'M23 22 12 8' : 'M23 22 14 30'
  const rightArm = pose === 'right' ? 'M25 22 41 22' : pose === 'select' ? 'M25 22 36 8' : 'M25 22 34 30'
  return <svg className="picker-pose" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="9" r="5" />
    <path d="M24 15v20M24 34 16 46M24 34l8 12" />
    <path d={leftArm} /><path d={rightArm} />
  </svg>
}

function PickerGestureGuide() {
  const guides = [
    { pose: 'left' as const, arrow: '←', title: L('Left arm out:', '左臂平伸：'), action: L('previous song', '上一首') },
    { pose: 'right' as const, arrow: '→', title: L('Right arm out:', '右臂平伸：'), action: L('next song', '下一首') },
    { pose: 'select' as const, arrow: '↑', title: L('Right hand up:', '举右手：'), action: L('select highlighted card', '选择当前卡片') },
    { pose: 'back' as const, arrow: '↶', title: L('Left hand up:', '举左手：'), action: L('back', '返回') },
  ]
  return <div className="picker-gesture-guide" aria-label={L('Gesture controls', '手势操作')}>
    {guides.map((guide) => <div key={guide.pose} className={`picker-gesture-chip picker-gesture-${guide.pose}`}>
      <b aria-hidden="true">{guide.arrow}</b><PickerPose pose={guide.pose} />
      <span><strong>{guide.title}</strong><small>{guide.action}</small></span>
    </div>)}
  </div>
}

export default function App() {
  const [navigation, dispatch] = useReducer(gameReducer, initialGameState)
  const activeScreen = navigation.screen === 'settings' || (navigation.screen === 'tracking' && navigation.returnScreen)
    ? navigation.returnScreen ?? 'home' : navigation.screen
  const [src, setSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [records, setRecords] = useState<ArcadeRecord[]>([])
  const [resultRecords, setResultRecords] = useState<(ResultRecord | null)[]>([])
  const [recordSyncError, setRecordSyncError] = useState(false)
  const [recordSaveError, setRecordSaveError] = useState(false)
  const [recordNoticeDismissed, setRecordNoticeDismissed] = useState(false)
  const [syncPending, setSyncPending] = useState(false)
  const [stats, setStats] = useState<Map<string, VideoStats>>(new Map())
  const [current, setCurrent] = useState<LibraryEntry | null>(null)
  const [editingSong, setEditingSong] = useState<LibraryEntry | null>(null)
  const [editRevision, setEditRevision] = useState(0)
  const [songEditState, setSongEditState] = useState<{ id: string | null; edit: SongEdit | null }>({ id: null, edit: null })
  const songEdit = songEditState.id === current?.id ? songEditState.edit : null
  const songEditReady = songEditState.id === (current?.id ?? null)
  const [focus, setFocus] = useState<Focus>('full')
  const [roundScoring, setRoundScoring] = useState({ focus: 'full' as Focus, trackHead: false })
  const [track, setTrack] = useState<PoseTrack | null>(null)
  const [roundChart, setRoundChart] = useState<ReturnType<typeof buildArcadeChart> | null>(null)
  const [preparation, setPreparation] = useState<Record<string, { name: string; progress: number | null; error?: string }>>({})
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [analysisQueue] = useState(createAnalysisQueue)
  const attemptedAnalysis = useRef(new Set<string>())
  const currentAnalysisId = useRef(current?.id)
  currentAnalysisId.current = current?.id
  const currentPreparation = current ? preparation[current.id] : undefined
  const analysing = currentPreparation && !currentPreparation.error ? currentPreparation.progress ?? 0 : null
  const analysisMessage = currentPreparation?.error ?? null
  const [settings, setSettings] = useState<GameSettings>(() => ({ ...loadGameSettings(), language: getLang() }))
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [choosingScoreFocus, setChoosingScoreFocus] = useState(false)
  const [choosingDifficulty, setChoosingDifficulty] = useState(false)
  const [confirmingRound, setConfirmingRound] = useState(false)
  const [focusMotion, setFocusMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [difficultyMotion, setDifficultyMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [registrationPlayers, setRegistrationPlayers] = useState<1 | 2>(1)
  const [countdown, setCountdown] = useState(3)
  const [trackingRecovery, setTrackingRecovery] = useState(initialTrackingRecovery)
  const [trackingDigit, setTrackingDigit] = useState<number | null>(null)
  const [gameRun, setGameRun] = useState(0)
  const [lobby, setLobby] = useState({ ready: false, players: 0 })
  const [gamePlayers, setGamePlayers] = useState<PlayerRound[]>([])
  const [scoreDebug, setScoreDebug] = useState<ScoreDebug[]>([])
  const [hitFeedback, setHitFeedback] = useState<HitFeedback[]>([])
  const [selectedMenuLabel, setSelectedMenuLabel] = useState('')
  const [pickerOptionsSelected, setPickerOptionsSelected] = useState(false)
  const [pickerOptionsOpen, setPickerOptionsOpen] = useState(false)
  const [gestureSelectedId, setGestureSelectedId] = useState<string | null>(null)
  const [carouselMotion, setCarouselMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [homeSelected, setHomeSelected] = useState(0)
  const [homeMotion, setHomeMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [previewSrc, setPreviewSrc] = useState<{ id: string; url: string; edit: SongEdit | null } | null>(null)
  const [previewPaused, setPreviewPaused] = useState(false)
  const [beatLabOpen, setBeatLabOpen] = useState(false)
  const [diagnosticRequested, setDiagnosticRequested] = useState(false)
  const [kioskPlaying, setKioskPlaying] = useState(false)
  const [beatMaps, setBeatMaps] = useState<Map<string, BeatMap | null>>(new Map())
  const [filePickerNotice, setFilePickerNotice] = useState(false)
  const [cameraRunning, setCameraRunning] = useState(false)
  const [resultPhotoRound, setResultPhotoRound] = useState(0)
  const [resultPhotoPending, setResultPhotoPending] = useState(false)
  const targetRef = useRef<TargetPose>({ feature: null, history: [], time: 0, gameRun: 0, sectionId: null })
  const capturePhotoFrameRef = useRef<(() => HTMLCanvasElement | null) | null>(null)
  const onPhotoFrameReady = useCallback((capture: (() => HTMLCanvasElement | null) | null) => {
    capturePhotoFrameRef.current = capture
  }, [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileDestinationRef = useRef<AppScreen>('arcade')
  const hitFeedbackIdRef = useRef(0)
  const previewRef = useRef<HTMLVideoElement>(null)
  const gameVideoRef = useRef<HTMLVideoElement>(null)
  const previewStartRef = useRef(0)
  const selectedPreviewTimeRef = useRef(0)
  const menuMusicRef = useRef<HTMLAudioElement>(null)
  const attractRef = useRef<HTMLElement>(null)
  const edgeRef = useRef<HTMLDivElement>(null)
  const edgeStarsRef = useRef<HTMLDivElement>(null)
  const beatAudioRef = useRef<{ context: AudioContext; analyser: AnalyserNode } | null>(null)
  const menuBeatCacheRef = useRef(new Map<string, Float32Array>())
  const difficultyPreviewRef = useRef<HTMLAudioElement>(null)
  const difficultyPreviewStartRef = useRef(0)
  const wasLobbyReadyRef = useRef(false)
  const trackingRecoveryRef = useRef(initialTrackingRecovery)
  const trackingDigitRef = useRef<number | null>(null)

  const arcadePhase = navigation.arcadePhase
  const scoringLocked = activeScreen === 'arcade' && arcadePhase !== 'setup'
  const scoringFocus = scoringLocked ? roundScoring.focus : focus
  const scoringHead = scoringLocked ? roundScoring.trackHead : settings.trackHead
  const manualSongBeats = current ? beatMaps.get(songBeatKey(current.id)) : null
  const setupMotionChart = useMemo(() => buildArcadeChart(track, difficulty, focus, settings.trackHead, songEdit, manualSongBeats),
    [track, difficulty, focus, settings.trackHead, songEdit, manualSongBeats])
  const motionChart = scoringLocked && roundChart ? roundChart : setupMotionChart
  const songReady = songEditReady && !!track && analysing == null && !analysisMessage && setupMotionChart.intervals.length > 0
  const playersReady = cameraRunning && lobby.ready && lobby.players >= registrationPlayers
  const motionView = navigation.screen === 'settings' ? 'settings'
    : activeScreen === 'arcade' && arcadePhase === 'paused' ? 'pause'
    : (activeScreen === 'arcade' || activeScreen === 'practice') && !src ? 'songs'
    : activeScreen === 'arcade' && arcadePhase === 'setup' && choosingScoreFocus ? 'focus'
    : activeScreen === 'arcade' && arcadePhase === 'setup' && choosingDifficulty ? 'difficulty'
    : activeScreen === 'arcade' && arcadePhase === 'setup' && src ? 'round'
    : navigation.screen
  const menuMotionRef = useMenuMotion(motionView, settings.reducedEffects)
  const baseGamePhase: GamePhase = arcadePhase === 'setup' ? 'lobby' : arcadePhase
  const gamePhase = effectiveTrackingPhase(baseGamePhase, trackingRecovery)

  const reportSoloPresence = useCallback((present: boolean, nowMs: number) => {
    if (activeScreen !== 'arcade' || arcadePhase !== 'playing' || registrationPlayers !== 1) return
    const previous = trackingRecoveryRef.current
    const next = advanceRoundRecovery(previous, 'playing', present, nowMs)
    const digit = recoveryCountdown(next, nowMs)
    trackingRecoveryRef.current = next
    if (next.mode !== previous.mode || digit !== trackingDigitRef.current) {
      trackingDigitRef.current = digit
      setTrackingDigit(digit)
      setTrackingRecovery(next)
    }
  }, [activeScreen, arcadePhase, registrationPlayers])

  useEffect(() => {
    if (activeScreen === 'arcade' && arcadePhase === 'playing' && registrationPlayers === 1) return
    trackingRecoveryRef.current = initialTrackingRecovery
    trackingDigitRef.current = null
    setTrackingRecovery(initialTrackingRecovery)
    setTrackingDigit(null)
  }, [activeScreen, arcadePhase, registrationPlayers, gameRun])

  useEffect(() => {
    if (activeScreen !== 'arcade' || arcadePhase !== 'playing' || registrationPlayers !== 1 || cameraRunning) return
    const finding = { ...initialTrackingRecovery, mode: 'finding' as const }
    trackingRecoveryRef.current = finding
    setTrackingRecovery(finding)
  }, [activeScreen, arcadePhase, registrationPlayers, cameraRunning])

  useEffect(() => {
    setHomeMotion(null)
    if (navigation.screen === 'home') setHomeSelected(0)
  }, [navigation.screen])

  const go = (type: 'openHome' | 'openArcade' | 'openPractice' | 'openEditor' | 'openPhotos' | 'openSettings') => {
    if (type === 'openHome' && activeScreen === 'arcade' && arcadePhase === 'results' && settings.menuTheme !== 'off') {
      const audio = menuMusicRef.current
      if (audio) void startMenuTheme(audio, {
        restart: true,
        volume: MENU_MUSIC_VOLUME,
        output: beatAudioRef.current?.context,
      }).catch(() => undefined)
    }
    playSfx(type === 'openArcade' || type === 'openPractice' ? 'confirm' : 'menu', settings.soundMuted)
    if (type === 'openArcade') {
      setSrc(null)
      setChoosingScoreFocus(false)
      setChoosingDifficulty(false)
      setConfirmingRound(false)
    }
    dispatch({ type })
  }

  const chooseSong = () => {
    setSrc(null)
    setChoosingScoreFocus(false)
    setChoosingDifficulty(false)
    setConfirmingRound(false)
    setDifficultyMotion(null)
    dispatch({ type: 'chooseSong' })
  }

  const updateSettings = (next: GameSettings) => {
    if (settings.soundMuted && !next.soundMuted) playSfx('menu', false)
    setSettings(next)
    saveGameSettings(next)
    setLang(next.language)
  }

  useEffect(() => {
    document.documentElement.lang = settings.language === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.classList.toggle('reduce-effects', settings.reducedEffects)
  }, [settings.language, settings.reducedEffects])

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const refresh = useCallback(async () => {
    const [entries, localRecords] = await Promise.all([listLibrary(), listArcadeRecords()])
    setLibrary(entries)
    setRecords(localRecords)
  }, [])

  const syncFromAccount = useCallback(async () => {
    try {
      await retryFailedSaves()
      const [localLibrary, localRecords] = await Promise.all([listLibrary(), listArcadeRecords()])
      if (localLibrary.length) {
        await syncLibrary(localLibrary.map((entry) => ({ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt })))
      }
      const [sessions, remoteLibrary, remoteRecords] = await Promise.all([loadSessions(), loadLibraryIndex(), loadArcadeRecords()])
      setStats(statsByVideo(sessions))
      if (remoteLibrary.length) await mergeRemote(remoteLibrary)
      const mergedRecords = mergeCloudRecords(localRecords, remoteRecords)
      if (mergedRecords.length) await putArcadeRecords(mergedRecords)
      try {
        await syncArcadeRecords(recordsForCloud(mergedRecords))
        setRecordSyncError(false)
      } catch {
        setRecordSyncError(true)
      }
      await refresh()
    } catch {
      setRecordSyncError(true)
    }
  }, [refresh])

  useEffect(() => {
    void refresh()
    void syncFromAccount()
    return onAuthChange(() => void syncFromAccount())
  }, [refresh, syncFromAccount])

  useEffect(() => onSyncPending(setSyncPending), [])
  useEffect(() => setRecordNoticeDismissed(false), [recordSaveError, recordSyncError, syncPending])

  const currentId = current?.id ?? null
  useEffect(() => {
    let cancelled = false
    if (!currentId) { setSongEditState({ id: null, edit: null }); return }
    void loadSongEdit(currentId).then((edit) => { if (!cancelled) setSongEditState({ id: currentId, edit }) })
      .catch((error) => { if (!cancelled) setImportMessage(`Could not load saved song edits: ${String(error)}`) })
    return () => { cancelled = true }
  }, [currentId, editRevision])
  useEffect(() => {
    let cancelled = false
    setTrack(null)
    if (!currentId) return
    void getTrack(currentId).then(async (stored) => {
      const { unpackTrack } = await import('./pose/track')
      const decoded = stored ? unpackTrack(stored) : null
      if (!cancelled && decoded?.rhythmAnalysed) setTrack(decoded)
    })
    return () => { cancelled = true }
  }, [currentId])

  useEffect(() => {
    setLobby({ ready: false, players: 0 })
    setGamePlayers([])
    setResultRecords([])
  }, [currentId])

  useEffect(() => {
    if (gamePhase !== 'playing') {
      setHitFeedback([])
      setScoreDebug([])
    }
  }, [gamePhase])

  useEffect(() => {
    if (!library.length) return setGestureSelectedId(null)
    setGestureSelectedId((selected) => selected && library.some((entry) => entry.id === selected) ? selected : currentId ?? library[0].id)
  }, [currentId, library])

  useEffect(() => {
    if (navigation.screen === 'tracking' && lobby.ready && !wasLobbyReadyRef.current && !diagnosticRequested) dispatch({ type: 'closeCameraSetup' })
    wasLobbyReadyRef.current = lobby.ready
  }, [navigation.screen, lobby.ready, diagnosticRequested])

  const previewEntry = library.find((entry) => entry.id === gestureSelectedId) ?? library[0]
  const themeMapKey = settings.menuTheme === 'off' ? null : themeBeatKey(settings.menuTheme)
  const songMapKey = previewEntry ? songBeatKey(previewEntry.id) : null
  const gameMapKey = current ? songBeatKey(current.id) : null
  useEffect(() => {
    const keys = [themeMapKey, songMapKey, gameMapKey].filter((key): key is string => !!key)
    let cancelled = false
    for (const key of keys) {
      if (beatMaps.has(key)) continue
      void loadBeatMap(key).then((map) => {
        if (!cancelled) setBeatMaps((previous) => new Map(previous).set(key, map))
      }).catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [themeMapKey, songMapKey, gameMapKey, beatMaps])
  const previewId = !src && (activeScreen === 'arcade' || activeScreen === 'practice') && previewEntry?.hasVideo ? previewEntry.id : null
  useEffect(() => {
    setPreviewSrc(null)
    if (!previewId) return
    let cancelled = false
    let url: string | null = null
    void Promise.all([getVideo(previewId), loadSongEdit(previewId)]).then(([blob, edit]) => {
      if (!blob || cancelled) return
      url = URL.createObjectURL(blob)
      setPreviewSrc({ id: previewId, url, edit })
    }).catch((error) => setImportMessage(`Could not open song preview: ${String(error)}`))
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [previewId, editRevision])

  useEffect(() => setFilePickerNotice(false), [navigation.screen, arcadePhase])

  useEffect(() => {
    if (navigation.screen !== 'attract') return
    const wake = (event: KeyboardEvent) => {
      if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) return
      playSfx('coin', settings.soundMuted)
      dispatch({ type: 'wake' })
    }
    window.addEventListener('keydown', wake)
    let frame = 0
    const pollGamepad = () => {
      if (navigator.getGamepads?.().some((pad) => pad?.buttons.some((button) => button.pressed))) {
        playSfx('coin', settings.soundMuted)
        dispatch({ type: 'wake' })
        return
      }
      frame = requestAnimationFrame(pollGamepad)
    }
    frame = requestAnimationFrame(pollGamepad)
    return () => { window.removeEventListener('keydown', wake); cancelAnimationFrame(frame) }
  }, [navigation.screen, settings.soundMuted])

  useEffect(() => {
    if (arcadePhase !== 'countdown' || navigation.screen !== 'arcade') return
    setCountdown(3)
    playSfx('countdown', settings.soundMuted)
    const started = performance.now()
    let lastRemaining = 3
    const timer = window.setInterval(() => {
      const remaining = 3 - Math.floor((performance.now() - started) / 1000)
      if (remaining <= 0) {
        clearInterval(timer)
        playSfx('go', settings.soundMuted)
        dispatch({ type: 'countdownFinished' })
      } else {
        if (remaining !== lastRemaining) playSfx('countdown', settings.soundMuted)
        lastRemaining = remaining
        setCountdown(remaining)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [arcadePhase, navigation.screen, gameRun, settings.soundMuted])

  useEffect(() => {
    if (editingSong || beatLabOpen || navigation.screen !== 'arcade' || arcadePhase !== 'setup' || confirmingRound || choosingScoreFocus || choosingDifficulty || !src || !songReady || !playersReady) return
    const timer = window.setTimeout(() => {
      setGamePlayers([])
      setResultRecords([])
      setGameRun((run) => run + 1)
      setRoundScoring({ focus, trackHead: settings.trackHead })
      setRoundChart(setupMotionChart)
      dispatch({ type: 'startCountdown' })
    }, 1400)
    return () => clearTimeout(timer)
  }, [navigation.screen, arcadePhase, confirmingRound, choosingScoreFocus, choosingDifficulty, src, songReady, playersReady, editingSong, beatLabOpen, focus, settings.trackHead, setupMotionChart])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || navigation.screen !== 'arcade' || editingSong || beatLabOpen) return
      if (arcadePhase === 'playing') dispatch({ type: 'pause' })
      else if (arcadePhase === 'paused') dispatch({ type: 'resume' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [arcadePhase, navigation.screen, editingSong, beatLabOpen])

  const startRound = () => {
    if (!songReady || !playersReady) {
      setConfirmingRound(true)
      dispatch({ type: 'chooseSong' })
      return
    }
    playSfx('confirm', settings.soundMuted)
    setGamePlayers([])
    setResultRecords([])
    setGameRun((run) => run + 1)
    setRoundScoring({ focus, trackHead: settings.trackHead })
    setRoundChart(setupMotionChart)
    dispatch({ type: 'startCountdown' })
  }

  const finishRound = async (players: PlayerRound[]) => {
    if (arcadePhase !== 'playing') return
    setGamePlayers(players)
    setResultPhotoRound((round) => round + 1)
    setResultPhotoPending(true)
    dispatch({ type: 'finishRound' })
    if (!current || !players.length) return
    setRecordSaveError(false)
    try {
      const completedAt = Date.now()
      const outcomes: (ResultRecord | null)[] = []
      for (let index = 0; index < players.length; index++) {
        const player = players[index]
        if (isTrimmed(songEdit) || !recordEligible(player)) {
          outcomes.push(null)
          continue
        }
        const playerSlot = (index + 1) as 1 | 2
        const existing = await getArcadeRecord(arcadeRecordId(current.id, difficulty, playerSlot, roundScoring.focus, roundScoring.trackHead))
        const outcome = recordCompletedRound(existing, {
          videoId: current.id, difficulty, playerSlot, ...roundScoring, score: player.score,
          accuracy: accuracy(player), maxCombo: player.maxCombo, completedAt,
        })
        await putArcadeRecord(outcome.record)
        outcomes.push(outcome)
      }
      setResultRecords(outcomes)
      const fresh = await listArcadeRecords()
      setRecords(fresh)
      playSfx(outcomes.some((outcome) => outcome?.isNewBest) ? 'record' : 'result', settings.soundMuted)
      void syncArcadeRecords(recordsForCloud(fresh)).then(() => setRecordSyncError(false))
        .catch(() => setRecordSyncError(true))
    } catch {
      setRecordSaveError(true)
    }
  }

  const captureResultPhoto = async () => {
    const frame = capturePhotoFrameRef.current?.()
    if (!frame) throw new Error('Camera frame is unavailable')
    const image = await composeResultPhoto(frame, {
      songName: current?.name ?? T('Your dance'),
      difficulty,
      players: gamePlayers.map((player) => {
        const movements = movementResults(player)
        return {
          score: player.score,
          accuracy: accuracy(player),
          maxCombo: player.maxCombo,
          perfect: player.perfect,
          good: player.good,
          miss: player.miss,
          movementsScored: movements.scored,
          unscored: movements.unscored,
          trackingCoverage: trackingCoverage(player),
        }
      }),
    })
    if (!gamePlayers.length) throw new Error('Final score is unavailable')
    await saveResultPhoto({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      songName: current?.name ?? T('Your dance'),
      score: gamePlayers[0].score,
    }, image)
  }

  const updateLobby = useCallback((ready: boolean, players: number) => {
    setLobby((value) => value.ready === ready && value.players === players ? value : { ready, players })
  }, [])
  const updateGameScores = useCallback((players: PlayerRound[]) => {
    setGamePlayers(players)
  }, [])
  const updateScoreDebug = useCallback((entries: ScoreDebug[]) => {
    setScoreDebug((currentScores) => {
      const next = [...currentScores]
      for (const entry of entries) next[entry.player - 1] = entry
      return next
    })
  }, [])
  const showHits = useCallback((hits: ScoredHit[]) => {
    const at = performance.now()
    const events = hits.map((hit) => ({ ...hit, at, id: ++hitFeedbackIdRef.current }))
    setHitFeedback((previous) => [...activeHitFeedback(previous, at), ...events])
    for (const grade of new Set(hits.map((hit) => hit.grade))) playSfx(grade, settings.soundMuted)
  }, [settings.soundMuted])

  const analyseBlob = async (entry: LibraryEntry, blob?: Blob) => {
    attemptedAnalysis.current.add(entry.id)
    setPreparation((all) => ({ ...all, [entry.id]: all[entry.id] && !all[entry.id].error ? all[entry.id] : { name: entry.name, progress: null } }))
    return analysisQueue.enqueue(entry.id, async (cancelled) => {
      try {
        const source = blob ?? await getVideo(entry.id)
        if (cancelled()) return
        if (!source) throw new Error('Select the video again to prepare it')
        const { analyseVideo, packTrack } = await import('./pose/track')
        const result = await analyseVideo(source, (progress) => {
          if (!cancelled()) setPreparation((all) => ({ ...all, [entry.id]: { name: entry.name, progress } }))
        }, cancelled)
        if (!result && !cancelled()) throw new Error('No dance analysis was produced')
        if (result && !cancelled()) {
          await saveTrack(entry.id, packTrack(result))
          if (cancelled()) return
          if (!await getTrack(entry.id)) throw new Error('Could not save analysis on this device')
          if (currentAnalysisId.current === entry.id) setTrack(result)
          setPreparation((all) => { const next = { ...all }; delete next[entry.id]; return next })
          await refresh()
        }
      } catch (error) {
        console.error('Video analysis failed', error)
        if (!cancelled()) setPreparation((all) => ({ ...all, [entry.id]: { name: entry.name, progress: null, error: L('Preparation failed. Open the song to retry.', '准备失败。打开歌曲重试。') } }))
      }
    })
  }

  const analyseBlobRef = useRef(analyseBlob)
  analyseBlobRef.current = analyseBlob
  useEffect(() => {
    for (const entry of library) {
      if (entry.analysed || !entry.hasVideo || attemptedAnalysis.current.has(entry.id)) continue
      void analyseBlobRef.current(entry)
    }
  }, [library])
  useEffect(() => () => { analysisQueue.cancelAll(); attemptedAnalysis.current.clear() }, [analysisQueue])

  const analyse = async () => {
    if (!current || analysing != null) return
    setTrack(null)
    await analyseBlob(current)
  }

  const play = (blob: Blob) => {
    setSrc((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(blob)
    })
  }

  const loadFile = async (file: File | undefined | null, destination: AppScreen = 'arcade') => {
    if (!file) return
    if (!file.type.startsWith('video/')) return alert(T('Please choose a video file'))
    const entry = await remember(file)
    if (!entry) {
      setImportMessage('Could not save this video. Check available storage and try importing it again.')
      return
    }
    setImportMessage(null)
    selectedPreviewTimeRef.current = 0
    setTrack(null)
    play(file)
    setCurrent(entry)
    currentAnalysisId.current = entry?.id
    setConfirmingRound(destination === 'arcade')
    setChoosingScoreFocus(false)
    setChoosingDifficulty(false)
    setFocusMotion(null)
    setDifficultyMotion(null)
    await refresh()
    dispatch({ type: destination === 'practice' ? 'openPractice' : 'openArcade' })
    if (entry) {
      void syncLibrary([{ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt }])
      const stored = await getTrack(entry.id)
      const { unpackTrack } = await import('./pose/track')
      const decoded = stored ? unpackTrack(stored) : null
      if (decoded?.rhythmAnalysed) { if (currentAnalysisId.current === entry.id) setTrack(decoded) }
      else await analyseBlob(entry, file)
    }
  }

  const openEntry = async (entry: LibraryEntry, destination: 'arcade' | 'practice' = 'arcade') => {
    const blob = await getVideo(entry.id)
    if (!blob) {
      fileDestinationRef.current = destination
      fileInputRef.current?.click()
      return
    }
    playSfx('confirm', settings.soundMuted)
    selectedPreviewTimeRef.current = previewSrc?.id === entry.id ? previewRef.current?.currentTime ?? 0 : 0
    setTrack(null)
    play(blob)
    setCurrent(entry)
    currentAnalysisId.current = entry.id
    setConfirmingRound(destination === 'arcade')
    setChoosingScoreFocus(false)
    setChoosingDifficulty(false)
    setFocusMotion(null)
    setDifficultyMotion(null)
    await touch(entry.id)
    await refresh()
    dispatch({ type: destination === 'practice' ? 'openPractice' : 'openArcade' })
    const stored = await getTrack(entry.id)
    const { unpackTrack } = await import('./pose/track')
    const decoded = stored ? unpackTrack(stored) : null
    if (decoded?.rhythmAnalysed) { if (currentAnalysisId.current === entry.id) setTrack(decoded) }
    else await analyseBlob(entry, blob)
  }

  const loadFiles = async (files: File[], destination: AppScreen) => {
    if (files.length === 1) { await loadFile(files[0], destination); return }
    for (const [index, file] of files.entries()) {
      setImportMessage(L(`Importing ${index + 1}/${files.length}: ${file.name}`, `正在导入 ${index + 1}/${files.length}：${file.name}`))
      try {
        if (!file.type.startsWith('video/')) throw new Error('Not a video')
        const entry = await remember(file)
        if (!entry) throw new Error('Could not save video')
        await refresh()
        void syncLibrary([{ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt }])
        const stored = await getTrack(entry.id)
        if (!stored) void analyseBlob(entry, file)
      } catch (error) {
        console.error('Video import failed', error)
        setPreparation((all) => ({ ...all, [`import:${file.name}:${index}`]: { name: file.name, progress: null, error: L('Import failed. Select this video again to retry.', '导入失败。请重新选择视频重试。') } }))
      }
    }
    setImportMessage(null)
  }

  const updateSections = async (sections: Section[]) => {
    if (!current) return
    const ordered = [...sections].sort((a, b) => a.start - b.start)
    setCurrent({ ...current, sections: ordered })
    setLibrary((all) => all.map((entry) => entry.id === current.id ? { ...entry, sections: ordered } : entry))
    await saveSections(current.id, ordered)
  }

  const recordSectionPractice = async (deltas: Parameters<typeof addSectionPractice>[1]) => {
    if (!current) return
    await addSectionPractice(current.id, deltas)
    const fresh = await listLibrary()
    setLibrary(fresh)
    setCurrent(fresh.find((entry) => entry.id === current.id) ?? current)
  }

  const forgetEntry = async (entry: LibraryEntry) => {
    await analysisQueue.cancel(entry.id)
    attemptedAnalysis.current.delete(entry.id)
    setPreparation((all) => { const next = { ...all }; delete next[entry.id]; return next })
    await forget(entry.id)
    setBeatMaps((previous) => { const next = new Map(previous); next.delete(songBeatKey(entry.id)); return next })
    if (current?.id === entry.id) {
      setCurrent(null)
      setSrc(null)
    }
    await refresh()
  }

  const openFilePicker = (destination: AppScreen) => {
    fileDestinationRef.current = destination
    fileInputRef.current?.click()
  }

  const pickingSong = !src && (navigation.screen === 'arcade' || navigation.screen === 'practice')
  const menuMusicActive = !editingSong && !kioskPlaying && !beatLabOpen && !pickingSong && (navigation.screen === 'attract' || !src || (activeScreen === 'arcade' && arcadePhase === 'results') || (activeScreen !== 'arcade' && activeScreen !== 'practice'))
  const choicePreviewActive = navigation.screen === 'arcade' && arcadePhase === 'setup' && !!src && (choosingScoreFocus || choosingDifficulty)
  const menuTheme = MENU_THEMES.find((theme) => theme.id === settings.menuTheme)
  useEffect(() => {
    // Autoplay and a suspended beat analyser need recovery inside a user input,
    // even when the theme element reports that it is already playing.
    const unlockAudio = () => {
      const output = beatAudioRef.current?.context
      if (output?.state === 'suspended') void output.resume().catch(() => undefined)
      const audio = menuMusicRef.current
      if (menuMusicActive && menuTheme && audio?.paused) {
        void startMenuTheme(audio, { volume: MENU_MUSIC_VOLUME }).catch(() => undefined)
      }
    }
    window.addEventListener('pointerdown', unlockAudio, true)
    window.addEventListener('keydown', unlockAudio, true)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio, true)
      window.removeEventListener('keydown', unlockAudio, true)
    }
  }, [menuMusicActive, menuTheme])
  useEffect(() => {
    const audio = menuMusicRef.current
    if (!audio) return
    if (!menuTheme) { audio.pause(); return }
    if (menuMusicActive) {
      if (audio.paused) audio.volume = 0
      void startMenuTheme(audio, { output: beatAudioRef.current?.context }).catch(() => undefined)
      return fadeVolume(audio, MENU_MUSIC_VOLUME)
    }
    if (!audio.paused) return fadeVolume(audio, 0, () => audio.pause())
  }, [menuMusicActive, menuTheme, navigation.screen])

  useEffect(() => {
    const gameplay = activeScreen === 'arcade' && arcadePhase === 'playing' && !!src
    const songPreview = pickingSong && !!previewEntry && previewSrc?.id === previewEntry.id
    const librarySong = gameplay || songPreview || choicePreviewActive
    const audio = gameplay ? gameVideoRef.current : songPreview ? previewRef.current : choicePreviewActive ? difficultyPreviewRef.current : menuMusicActive ? menuMusicRef.current : null
    const edge = edgeRef.current
    if (!audio || !edge || beatLabOpen || settings.reducedEffects || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const key = gameplay || choicePreviewActive ? gameMapKey : songPreview ? songMapKey : themeMapKey
    const manual = key ? beatMaps.get(key) : null
    if (librarySong && !manual) return
    let beatGrid = !manual && menuTheme ? menuBeatCacheRef.current.get(menuTheme.id) ?? null : null
    let rhythmWorker: Worker | null = null
    if (!manual && menuTheme && !beatGrid) {
      rhythmWorker = new Worker(new URL('./lib/menuRhythm.worker.ts', import.meta.url), { type: 'module' })
      rhythmWorker.onmessage = (event: MessageEvent<{ beats: Float32Array | null }>) => {
        if (!event.data.beats?.length) return
        beatGrid = event.data.beats
        menuBeatCacheRef.current.set(menuTheme.id, beatGrid)
      }
      rhythmWorker.postMessage({ url: new URL(`${import.meta.env.BASE_URL}audio/${menuTheme.file}`, window.location.href).href })
    }
    let frame = 0
    let previousTime = audio.currentTime
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      edge.style.removeProperty('--beat-glow')
      edge.style.removeProperty('--beat-opacity')
      edge.style.removeProperty('--beat-color')
      edge.style.removeProperty('--beat-border')
      edgeStarsRef.current?.replaceChildren()
      attractRef.current?.removeAttribute('data-beat-active')
      attractRef.current?.style.removeProperty('--beat-logo-scale')
      attractRef.current?.style.removeProperty('--beat-button-scale')
    }
    const start = () => {
      if (frame || audio.paused) return
      previousTime = audio.currentTime <= .02 ? -.02 : audio.currentTime
      let analyser: AnalyserNode | null = null
      if (!manual) {
        if (!beatAudioRef.current) {
          const context = new AudioContext()
          const node = context.createAnalyser()
          node.fftSize = 2048
          node.smoothingTimeConstant = .35
          context.createMediaElementSource(audio).connect(node).connect(context.destination)
          beatAudioRef.current = { context, analyser: node }
        }
        analyser = beatAudioRef.current.analyser
        void beatAudioRef.current.context.resume().catch(() => undefined)
      }
      const frequencies = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
      const previousFrequencies = frequencies ? new Uint8Array(frequencies.length) : null
      let hasPrevious = false
      const tracker = { baseline: 0, previous: 0, lastBeat: -Infinity }
      attractRef.current?.setAttribute('data-beat-active', '')
      const tick = (now: number) => {
        let melody = 0
        if (analyser && frequencies && previousFrequencies) {
          analyser.getByteFrequencyData(frequencies)
          let energy = 0
          for (let bin = 2; bin <= 24; bin++) energy += frequencies[bin]
          if (!beatGrid) sampleBeat(tracker, energy / 23, now)
          let rise = 0
          for (let bin = 12; bin <= 100; bin++) rise += Math.max(0, frequencies[bin] - previousFrequencies[bin])
          melody = hasPrevious ? Math.min(.25, rise / 1400) : 0
          previousFrequencies.set(frequencies)
          hasPrevious = true
        }
        const timed = manual ? beatGlowAt(manual, audio.currentTime) : null
        if (timed?.mark.kind === 'burst' && previousTime < timed.mark.time &&
          audio.currentTime - previousTime < .5 && !audio.seeking && edgeStarsRef.current) {
          spawnEdgeStars(edgeStarsRef.current)
        }
        previousTime = audio.currentTime
        const beat = manual ? timed?.pulse ?? 0
          : beatGrid ? beatPulseAt(beatGrid, audio.currentTime)
          : Math.max(0, 1 - (now - tracker.lastBeat) / 340)
        const pulse = Math.min(1.45, beat + melody)
        const kind = timed?.mark.kind
        edge.style.setProperty('--beat-color', kind === 'burst' ? '#ffd36a' : '#43e3e9')
        edge.style.setProperty('--beat-border', kind === 'burst' ? '9px' : kind === 'accent' ? '7px' : '4px')
        edge.style.setProperty('--beat-glow', `${Math.round(pulse * (kind === 'burst' ? 112 : kind === 'accent' ? 76 : 38))}px`)
        edge.style.setProperty('--beat-opacity', String(Math.min(1, pulse * (kind === 'beat' ? .9 : 1.1))))
        attractRef.current?.style.setProperty('--beat-logo-scale', String(1 + pulse * .09))
        attractRef.current?.style.setProperty('--beat-button-scale', String(1 + pulse * .06))
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
    audio.addEventListener('play', start)
    audio.addEventListener('pause', stop)
    start()
    return () => {
      rhythmWorker?.terminate()
      audio.removeEventListener('play', start)
      audio.removeEventListener('pause', stop)
      stop()
    }
  }, [activeScreen, arcadePhase, beatLabOpen, beatMaps, choicePreviewActive, gameMapKey, menuMusicActive, menuTheme, pickingSong, previewEntry, previewSrc, settings.reducedEffects, songMapKey, src, themeMapKey])

  useEffect(() => {
    const audio = difficultyPreviewRef.current
    if (!audio) return
    if (choicePreviewActive) {
      audio.volume = PREVIEW_VOLUME
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) void audio.play().catch(() => undefined)
      return
    }
    if (!audio.paused) return fadeVolume(audio, 0, () => audio.pause())
  }, [choicePreviewActive, src])
  useEffect(() => { if (!pickingSong) setCarouselMotion(null) }, [pickingSong])
  useEffect(() => {
    if (!carouselMotion) return
    const timer = window.setTimeout(() => setCarouselMotion(null), 520)
    return () => window.clearTimeout(timer)
  }, [carouselMotion])
  useEffect(() => {
    if (!focusMotion) return
    const timer = window.setTimeout(() => setFocusMotion(null), 520)
    return () => window.clearTimeout(timer)
  }, [focusMotion])
  useEffect(() => {
    if (!difficultyMotion) return
    const timer = window.setTimeout(() => setDifficultyMotion(null), 520)
    return () => window.clearTimeout(timer)
  }, [difficultyMotion])
  useEffect(() => {
    if (!homeMotion) return
    const timer = window.setTimeout(() => setHomeMotion(null), 520)
    return () => window.clearTimeout(timer)
  }, [homeMotion])
  const playNavigationCue = (direction: 'left' | 'right') =>
    playSfx(direction === 'left' ? 'navigateLeft' : 'navigateRight', settings.soundMuted)
  const moveSong = (direction: 'left' | 'right') => {
    if (!previewEntry) return
    playNavigationCue(direction)
    const index = pickerOptionsSelected ? library.length : library.findIndex((entry) => entry.id === previewEntry.id)
    const next = (index + (direction === 'left' ? -1 : 1) + library.length + 1) % (library.length + 1)
    setPickerOptionsSelected(next === library.length)
    setCarouselMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    if (next < library.length) setGestureSelectedId(library[next].id)
  }
  const moveHome = (direction: 'left' | 'right') => {
    playNavigationCue(direction)
    setHomeMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    setHomeSelected((index) => (index + (direction === 'left' ? 5 : 1)) % 6)
  }
  const moveDifficulty = (direction: 'left' | 'right') => {
    playNavigationCue(direction)
    const index = DIFFICULTIES.indexOf(difficulty)
    setDifficultyMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    setDifficulty(DIFFICULTIES[(index + (direction === 'left' ? -1 : 1) + DIFFICULTIES.length) % DIFFICULTIES.length])
  }
  const moveScoreFocus = (direction: 'left' | 'right') => {
    playNavigationCue(direction)
    const index = SCORE_FOCUSES.indexOf(focus)
    setFocusMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    setFocus(SCORE_FOCUSES[(index + (direction === 'left' ? -1 : 1) + SCORE_FOCUSES.length) % SCORE_FOCUSES.length])
  }
  const confirmScoreFocus = () => {
    playSfx('confirm', settings.soundMuted)
    setFocusMotion(null)
    setChoosingScoreFocus(false)
    setChoosingDifficulty(true)
  }
  const backToScoreFocus = () => {
    setChoosingDifficulty(false)
    setChoosingScoreFocus(true)
  }
  const backToRound = () => {
    setChoosingScoreFocus(false)
    setChoosingDifficulty(false)
    setConfirmingRound(true)
  }
  const startSelectedDifficulty = () => {
    playSfx('confirm', settings.soundMuted)
    setDifficultyMotion(null)
    setChoosingDifficulty(false)
    setConfirmingRound(true)
  }
  useEffect(() => {
    if (navigation.screen !== 'arcade' || editingSong || beatLabOpen || arcadePhase !== 'setup' || !src || (!confirmingRound && !choosingScoreFocus && !choosingDifficulty)) return
    const onChoiceKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if ((choosingScoreFocus || choosingDifficulty) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? 'left' : 'right'
        if (choosingScoreFocus) moveScoreFocus(direction)
        else moveDifficulty(direction)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (choosingScoreFocus) backToRound()
        else if (choosingDifficulty) backToScoreFocus()
        else chooseSong()
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault()
        if (choosingScoreFocus) confirmScoreFocus()
        else if (choosingDifficulty) startSelectedDifficulty()
        else if (songReady && playersReady) setConfirmingRound(false)
      }
    }
    window.addEventListener('keydown', onChoiceKey)
    return () => window.removeEventListener('keydown', onChoiceKey)
  })
  const selectHome = (selected = homeSelected) => {
    if (selected === 0) go('openArcade')
    else if (selected === 1) go('openPractice')
    else if (selected === 2) go('openEditor')
    else if (selected === 3) go('openPhotos')
    else if (selected === 4) go('openSettings')
    else dispatch({ type: 'openCameraSetup' })
  }
  // Keyboard navigation works before camera registration; gestures use the same selected action.
  const menuContext: GestureContext | null = editingSong || beatLabOpen || (diagnosticRequested && lobby.ready) ? 'menu' :
    navigation.screen !== 'tracking' && navigation.screen !== 'attract' && !(navigation.screen === 'arcade' && src &&
      ((arcadePhase === 'results' && resultPhotoPending) || arcadePhase === 'playing' || arcadePhase === 'countdown' ||
      (arcadePhase === 'setup' && !confirmingRound && !choosingDifficulty && !choosingScoreFocus))) ? pickingSong ? 'songPicker' : 'menu' : null
  const gestureContext = lobby.ready ? menuContext : null
  const menuFocus = choosingScoreFocus ? focus : null
  const menuDifficulty = choosingDifficulty ? difficulty : null
  const menuSongReady = confirmingRound ? songReady : null
  const menuPlayersReady = confirmingRound ? playersReady : null
  const selectMenuItem = (item: HTMLElement) => {
    setFilePickerNotice(false)
    item.setAttribute('data-selection-label', T('SELECTED'))
    setSelectedMenuLabel(markMenuSelection(item))
  }

  useEffect(() => {
    if (!menuContext) return
    let frame = 0
    const ensureSelection = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const items = menuItems()
        const selected = items.find((item) => item.hasAttribute('data-gesture-selected'))
        if (selected) { setSelectedMenuLabel(menuItemLabel(selected)); return }
        const first = items.find((item) => item.hasAttribute('data-gesture-default')) ??
          items.find((item) => item.getAttribute('aria-current') === 'true') ?? items[0]
        if (first) selectMenuItem(first)
      })
    }
    document.querySelectorAll('[data-gesture-selected]').forEach((item) => item.removeAttribute('data-gesture-selected'))
    ensureSelection()
    const observer = new MutationObserver(ensureSelection)
    if (menuMotionRef.current) observer.observe(menuMotionRef.current, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'open'] })
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [menuContext, navigation.screen, arcadePhase, editingSong, beatLabOpen, pickerOptionsOpen, pickerOptionsSelected, previewEntry?.id, choosingScoreFocus, choosingDifficulty, menuFocus, menuDifficulty, menuSongReady, menuPlayersReady, menuMotionRef])

  const handleGestureAction = (gesture: MenuGesture, source: 'gesture' | 'keyboard' = 'gesture') => {
    if (!editingSong && !beatLabOpen && activeScreen === 'arcade' && arcadePhase === 'playing' && gesture === 'back') {
      dispatch({ type: 'pause' })
      return
    }
    if (!(source === 'keyboard' ? menuContext : gestureContext)) return
    const surface = activeMenuSurface()
    const overlay = Number(surface?.dataset.menuPriority ?? 0) > 0
    if (source === 'gesture' && diagnosticRequested && navigation.screen === 'tracking' && gesture !== 'back') return
    if (gesture === 'back') {
      const back = surface?.querySelector<HTMLElement>('[data-menu-back]')
      if (back) { if (!back.hasAttribute('disabled')) back.click(); return }
      if (navigation.screen === 'settings') dispatch({ type: 'closeSettings' })
      else if (activeScreen === 'arcade' && arcadePhase === 'paused') dispatch({ type: 'resume' })
      else if (activeScreen === 'arcade' && arcadePhase === 'results') chooseSong()
      else if (navigation.screen === 'arcade' && choosingDifficulty) backToScoreFocus()
      else if (navigation.screen === 'arcade' && choosingScoreFocus) backToRound()
      else if (navigation.screen === 'arcade' && confirmingRound) chooseSong()
      else if (navigation.screen === 'home') dispatch({ type: 'quitHome' })
      else dispatch({ type: 'openHome' })
      return
    }
    if (!overlay && navigation.screen === 'home') {
      if (gesture === 'confirm') selectHome()
      else moveHome(gesture === 'previous' ? 'left' : 'right')
      return
    }
    if (!overlay && navigation.screen === 'arcade' && choosingDifficulty) {
      if (gesture === 'confirm') startSelectedDifficulty()
      else moveDifficulty(gesture === 'previous' ? 'left' : 'right')
      return
    }
    if (!overlay && navigation.screen === 'arcade' && choosingScoreFocus) {
      if (gesture === 'confirm') confirmScoreFocus()
      else moveScoreFocus(gesture === 'previous' ? 'left' : 'right')
      return
    }
    if (!overlay && navigation.screen !== 'settings' && pickingSong && previewEntry) {
      if (gesture === 'confirm') {
        if (pickerOptionsSelected) setPickerOptionsOpen(true)
        else if (source === 'gesture' && !previewEntry.hasVideo) setFilePickerNotice(true)
        else void openEntry(previewEntry, navigation.screen === 'practice' ? 'practice' : 'arcade')
      } else moveSong(gesture === 'previous' ? 'left' : 'right')
      return
    }
    const items = menuItems(surface)
    if (!items.length) return
    const focused = items.indexOf(document.activeElement as HTMLElement)
    const index = focused >= 0 ? focused : Math.max(0, items.findIndex((item) => item.hasAttribute('data-gesture-selected')))
    if (gesture === 'confirm') {
      if (source === 'gesture' && items[index].hasAttribute('data-needs-file')) setFilePickerNotice(true)
      else items[index].click()
      return
    }
    const direction = gesture === 'previous' ? 'left' : 'right'
    playNavigationCue(direction)
    selectMenuItem(items[(index + (direction === 'left' ? -1 : 1) + items.length) % items.length])
  }

  const renderHeader = (title?: string) => (
    <header className="app-header" data-gesture-skip>
      <button className="brand-button" data-menu-back onClick={() => go('openHome')} aria-label={T('Home')}><Brand compact /></button>
      {title && <span className="screen-label">{T(title)}</span>}
      <nav>{activeScreen === 'practice' && !cameraRunning && <button className="btn primary practice-camera-action" onClick={() => dispatch({ type: 'openCameraSetup' })}>{T('Camera setup')}</button>}<button className="btn subtle" onClick={() => go('openEditor')}><i aria-hidden="true">▥</i>{L('Beatmap Editor', '谱面编辑器')}</button><button className="btn subtle" onClick={() => go('openPhotos')}><i aria-hidden="true">▣</i>{L('Photos', '照片')}</button><button className="btn subtle" onClick={() => go('openSettings')}><i aria-hidden="true">⚙</i>{T('Settings')}</button><AccountBar /></nav>
    </header>
  )

  const renderTrackPicker = (destination: 'arcade' | 'practice') => {
    const choices = [...library, null]
    const selectedIndex = pickerOptionsSelected ? library.length : Math.max(0, library.findIndex((entry) => entry.id === previewEntry?.id))
    return (
    <section className={`track-picker ${dragOver ? 'over' : ''}`} data-gesture-surface
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); void loadFiles(Array.from(event.dataTransfer.files), destination) }}>
      <div className="picker-heading"><h1>{L(destination === 'arcade' ? 'Select your track' : 'Select a routine', destination === 'arcade' ? '选择歌曲' : '选择练习')}</h1><PickerGestureGuide /></div>
      <div className="picker-stage">
        {library.length > 0 && <button className="carousel-paddle carousel-paddle-left" onClick={() => moveSong('left')} aria-label={L('Previous song', '上一首')}>‹</button>}
        {library.length ? <div key={carouselMotion?.turn ?? 0} className={`song-carousel${carouselMotion ? ` is-moving-${carouselMotion.direction}` : ''}`} data-count={choices.length} role="group" aria-label={L('Song picker', '歌曲选择')}>
          {([-1, 0, 1] as const).map((offset, slot) => {
            if (offset === 1 && choices.length === 2) return null
            const index = (selectedIndex + offset + choices.length) % choices.length
            const entry = choices[index]
            const select = () => {
              if (slot !== 1) moveSong(slot === 0 ? 'left' : 'right')
              else if (entry) void openEntry(entry, destination)
              else setPickerOptionsOpen(true)
            }
            if (!entry) return <button key="options" className={`song-card picker-options-card song-card-${slot === 0 ? 'left' : slot === 1 ? 'center' : 'right'}`} aria-current={slot === 1 ? 'true' : undefined} data-gesture-label="Options" onClick={select}>
              <span className="song-card-media"><img src={`${import.meta.env.BASE_URL}menu/settings.webp`} alt="" /></span><strong>Options</strong><span className="song-card-action">Settings · Photos · Track tools</span><span className="song-card-state">Select to open</span>
            </button>
            return <button
              key={entry.id}
              className={`song-card song-card-${slot === 0 ? 'left' : slot === 1 ? 'center' : 'right'}`}
              data-track-id={entry.id}
              data-gesture-label={entry.name.replace(/\.[^.]+$/, '')}
              aria-current={slot === 1 ? 'true' : undefined}
              onClick={select}
            >
            <span className="song-card-media">
              {slot === 1 && previewSrc?.id === entry.id ? <video ref={previewRef} src={previewSrc.url} poster={entry.thumb} playsInline preload="auto" onLoadedMetadata={(event) => {
              const video = event.currentTarget
              previewStartRef.current = Math.max(previewSrc.edit?.start ?? 0, Math.min(12, Math.max(0, (previewSrc.edit?.end ?? video.duration) - 8)))
              video.currentTime = previewStartRef.current
            }} onCanPlay={(event) => { void event.currentTarget.play().catch(() => setPreviewPaused(true)) }} onPlay={() => setPreviewPaused(false)} onPause={() => setPreviewPaused(true)} onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= Math.min(previewStartRef.current + 7, previewSrc.edit?.end ?? Infinity)) event.currentTarget.currentTime = previewStartRef.current
            }} /> : entry.thumb && <img src={entry.thumb} alt="" />}
            </span>
            <strong title={entry.name}>{entry.name.replace(/\.[^.]+$/, '')}</strong>
            {slot === 1 && entry.hasVideo && <span className="song-card-action"><i aria-hidden="true">▶</i><b>{L('PLAY THIS TRACK', '播放这首歌曲')}</b></span>}
            <span className="song-card-state">{slot === 1 ? entry.hasVideo ? L('Select to dance', '选择后开始跳舞') : L('Add video again to play', '重新添加视频以开始游戏') : L('Browse to this song', '浏览这首歌曲')}</span>
          </button>
          })}
        </div> : <div className="picker-empty">
          <span className="picker-empty-icon" aria-hidden="true">♪</span>
          <h2>{T('Add your first dance')}</h2>
          <p>{T('Choose a dance video. We’ll prepare its music and movements on this device.')}</p>
          <button className="btn primary" data-needs-file data-gesture-default onClick={() => openFilePicker(destination)}>{T('Add a dance video')}</button>
          <small>{T('Your videos and camera stay on this device.')}</small>
        </div>}
        {library.length > 0 && <button className="carousel-paddle carousel-paddle-right" onClick={() => moveSong('right')} aria-label={L('Next song', '下一首')}>›</button>}
        {!pickerOptionsSelected && previewPaused && previewSrc?.id === previewEntry?.id && <button className="btn primary preview-play" onClick={() => { void previewRef.current?.play() }}>{L('Play preview', '播放预览')}</button>}
      </div>
      {library.length > 0 && <nav className="carousel-controls" aria-label="Song navigation"><button className="btn" onClick={() => moveSong('left')}>{L('Previous song', '上一首')}</button><button className="btn" onClick={() => moveSong('right')}>{L('Next song', '下一首')}</button></nav>}
      <div className="picker-import"><button className="btn" onClick={() => setPickerOptionsOpen(true)}>Options</button>{library.length > 0 && <button className="btn primary" data-needs-file onClick={() => openFilePicker(destination)}>{L('+ Add a video', '+ 添加视频')}</button>}<span className={filePickerNotice ? 'is-notice' : undefined} role={filePickerNotice ? 'status' : undefined}>{filePickerNotice ? L('Use the device to choose a video file.', '请用设备选择视频文件。') : L('Drop a dance video here, or choose one to play.', '将舞蹈视频拖到这里，或选择一个开始游戏。')}</span></div>
      {pickerOptionsOpen && <div className="picker-options-overlay distance-menu" role="dialog" aria-modal="true" aria-label="Song picker options" data-gesture-surface data-menu-priority="1">
        <div className="picker-options-panel"><h2>Options</h2><div className="picker-options-actions">
          <button className="btn primary" data-gesture-default onClick={() => { setPickerOptionsOpen(false); go('openSettings') }}>Settings</button>
          <button className="btn" onClick={() => { setPickerOptionsOpen(false); go('openPhotos') }}>Photos</button>
          {previewEntry && <button className="btn" onClick={() => { setPickerOptionsOpen(false); setEditingSong(previewEntry) }}>Edit selected track</button>}
          {previewPaused && previewSrc && <button className="btn" onClick={() => { setPickerOptionsSelected(false); setPickerOptionsOpen(false); void previewRef.current?.play() }}>Play preview</button>}
          <button className="btn" data-needs-file onClick={() => openFilePicker(destination)}>Add a video</button>
          <button className="btn" data-menu-back onClick={() => setPickerOptionsOpen(false)}>Back to songs</button>
        </div>{filePickerNotice && <p className="file-picker-help" role="status">Use the device to choose a video file.</p>}<MenuGuide back="Back to songs" /></div>
      </div>}
    </section>
    )
  }

  const renderPanels = (mode: 'arcade' | 'practice') => {
    if (!src) return renderTrackPicker(mode)
    const panelPhase: GamePhase = mode === 'practice' ? 'lobby' : gamePhase
    return (
      <Suspense fallback={<LoadingStage />}>
        <main className={`panels ${mode === 'arcade' && ['countdown', 'playing', 'paused'].includes(gamePhase) ? 'game-active' : mode === 'arcade' && gamePhase === 'results' ? 'game-results-stage' : ''}`}>
          <VideoPanel distanceControls={mode === 'practice'} src={src} playbackRef={gameVideoRef} targetRef={targetRef} sections={current?.sections ?? []} sectionStats={current?.sectionStats} onSectionsChange={(sections) => void updateSections(sections)} focus={scoringFocus} track={track} songEdit={activeScreen === 'arcade' ? songEdit : null} onAnalyse={() => void analyse()} analysing={analysing} analysisMessage={analysisMessage} showSkeletons={settings.showSkeletons} trackHead={scoringHead} difficulty={difficulty} gamePhase={panelPhase} countdown={countdown} gameRun={gameRun} hitFeedback={hitFeedback} cues={activeScreen === 'arcade' ? motionChart.cues : undefined} reducedEffects={settings.reducedEffects} />
        </main>
      </Suspense>
    )
  }

  const renderSelectedSongBar = () => <div className="difficulty-song-bar">
    <span className="difficulty-song-art">{current?.thumb ? <img src={current.thumb} alt="" /> : '♪'}</span>
    <span><small>{L('Selected song', '已选歌曲')}</small><strong>{current?.name.replace(/\.[^.]+$/, '') ?? T('Your dance')}</strong></span>
    <button className="btn subtle" data-menu-back onClick={chooseSong}>{T('Change song')}</button>
  </div>

  const renderScoreFocusPicker = () => {
    const selectedIndex = SCORE_FOCUSES.indexOf(focus)
    const choices: Record<Focus, { title: string; description: string }> = {
      full: { title: T('Whole body'), description: L('Score your full-body movement.', '全身动作都会计分。') },
      upper: { title: T('Arms only'), description: L('Focus on arms and head. Legs do not score.', '只计手臂和头部，腿部不计分。') },
      lower: { title: T('Legs only'), description: L('Focus on leg movement. Arms do not score.', '只计腿部，手臂不计分。') },
    }
    return <main className="difficulty-screen score-focus-screen" data-gesture-surface>
      <div className="difficulty-heading"><h1>{L('Choose what counts.', '选择计分重点。')}</h1><p>{L('Pick the body movements to score in this round.', '选择这一局要计分的身体动作。')}</p></div>
      {renderSelectedSongBar()}
      <nav key={focusMotion?.turn ?? 0} className={`song-carousel difficulty-carousel${focusMotion ? ` is-moving-${focusMotion.direction}` : ''}`} aria-label={L('Score focus', '计分重点')}>
        {([-1, 0, 1] as const).map((offset) => {
          const mode = SCORE_FOCUSES[(selectedIndex + offset + SCORE_FOCUSES.length) % SCORE_FOCUSES.length]
          const position = offset === -1 ? 'left' : offset === 1 ? 'right' : 'center'
          return <button key={mode} className={`song-card song-card-${position} difficulty-card focus-card focus-card-${mode}`}
            aria-current={offset === 0 ? 'true' : undefined}
            aria-label={offset === 0 ? L(`Continue with ${choices[mode].title}`, `选择${choices[mode].title}并继续`) : choices[mode].title}
            data-gesture-default={offset === 0 ? '' : undefined}
            onClick={() => offset === 0 ? confirmScoreFocus() : moveScoreFocus(offset === -1 ? 'left' : 'right')}>
            <span>{L('Score focus', '计分重点')}</span>
            <strong>{choices[mode].title}</strong>
            <small>{choices[mode].description}</small>
            <i aria-hidden="true">{offset === 0 ? L('CONTINUE', '继续') : offset === -1 ? '←' : '→'}</i>
          </button>
        })}
      </nav>
      <nav className="carousel-controls" aria-label="Score focus navigation"><button className="btn" onClick={backToRound}>{T('Back to round')}</button><button className="btn" onClick={() => moveScoreFocus('left')}>{L('Previous focus', '上一项')}</button><button className="btn" onClick={() => moveScoreFocus('right')}>{L('Next focus', '下一项')}</button></nav>
      <p className="difficulty-navigation-hint">{L('← Previous · Next → · Right hand up or Enter to continue', '← 上一个 · 下一个 → · 举右手或按 Enter 继续')}</p>
    </main>
  }

  const renderDifficultyPicker = () => {
    const selectedIndex = DIFFICULTIES.indexOf(difficulty)
    const descriptions: Record<Difficulty, string> = {
      easy: L('Fewer cues. Find the rhythm.', '更少提示，先找到节奏。'),
      normal: L('One clear cue at a time.', '每次一个清晰提示。'),
      hard: L('More cues. Keep every move sharp.', '更多提示，每个动作都要精准。'),
    }
    return <main className="difficulty-screen" data-gesture-surface>
      <div className="difficulty-heading"><h1>{L('Choose your difficulty.', '选择难度。')}</h1><p>{T('Pick your pace, then continue to your round.')}</p></div>
      {renderSelectedSongBar()}
      <nav key={difficultyMotion?.turn ?? 0} className={`song-carousel difficulty-carousel${difficultyMotion ? ` is-moving-${difficultyMotion.direction}` : ''}`} aria-label={T('Difficulty')}>
        {([-1, 0, 1] as const).map((offset) => {
          const level = DIFFICULTIES[(selectedIndex + offset + DIFFICULTIES.length) % DIFFICULTIES.length]
          const position = offset === -1 ? 'left' : offset === 1 ? 'right' : 'center'
          return <button
            key={level}
            className={`song-card song-card-${position} difficulty-card difficulty-card-${level}`}
            aria-current={offset === 0 ? 'true' : undefined}
            aria-label={offset === 0 ? `Continue with ${T(level)}` : T(level)}
            data-gesture-default={offset === 0 ? '' : undefined}
            onClick={() => offset === 0 ? startSelectedDifficulty() : moveDifficulty(offset === -1 ? 'left' : 'right')}
          >
            <span>{L('Difficulty', '难度')}</span>
            <strong>{T(level)}</strong>
            <small>{descriptions[level]}</small>
            <i aria-hidden="true">{offset === 0 ? T('CONTINUE') : offset === -1 ? '←' : '→'}</i>
          </button>
        })}
      </nav>
      <nav className="carousel-controls" aria-label="Difficulty navigation"><button className="btn" onClick={backToScoreFocus}>{T('Back to focus')}</button><button className="btn" onClick={() => moveDifficulty('left')}>{T('Previous difficulty')}</button><button className="btn" onClick={() => moveDifficulty('right')}>{T('Next difficulty')}</button></nav>
      <p className="difficulty-navigation-hint">{T('← Previous · Next → · Right hand up or Enter to continue')}</p>
    </main>
  }

  const renderArcade = () => {
    if (arcadePhase === 'setup') {
      return <div className="destination-wrap">{renderHeader()}{!src ? renderTrackPicker('arcade') : choosingScoreFocus ? renderScoreFocusPicker() : choosingDifficulty ? renderDifficultyPicker() : (
        <main className="song-loading-screen distance-menu" data-gesture-surface><div className="song-loading-card">
          <div className="song-loading-art">{current?.thumb ? <img src={current.thumb} alt="" /> : <span>♪</span>}</div>
          <div className="song-loading-copy"><span className="kicker">{L('Up next', '即将开始')}</span><h1>{current?.name.replace(/\.[^.]+$/, '') ?? T('Your dance')}</h1>
            <div className="round-options"><span>{T(focus === 'full' ? 'Whole body' : focus === 'upper' ? 'Arms only' : 'Legs only')}</span><span>{T(difficulty)}</span><span>{T(settings.trackHead ? 'Head scoring on' : 'Head scoring off')}</span></div>
            <div className="round-readiness" role="status" aria-live="polite">
              <p><b>{T('Song')}:</b> {(analysisMessage ? T('Preparation failed — retry analysis.') : null) ?? (analysing != null ? `Preparing · ${Math.round(analysing * 100)}%` : !track || !songEditReady ? T('Preparing…') : !songReady ? T('No playable moves — change options or song.') : T('Ready'))}</p>
              <p><b>{T('Camera')}:</b> {T(!cameraRunning ? 'Off — open Camera setup to play.' : !playersReady ? 'Register your players in Camera setup.' : `${lobby.players} player${lobby.players === 1 ? '' : 's'} ready`)}</p>
            </div>
            {analysisMessage && <details className="round-error-detail" data-gesture-skip><summary>Technical details</summary><p>{analysisMessage}</p></details>}
            {analysing != null && <div className="song-loading-progress" role="progressbar" aria-label="Song preparation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(analysing * 100)}><i style={{ width: `${Math.round(analysing * 100)}%` }} /></div>}
            <div className="round-setup-actions">
              {confirmingRound && <button className="btn primary" data-gesture-default disabled={!songReady || !playersReady} onClick={() => { playSfx('confirm', settings.soundMuted); setConfirmingRound(false) }}>{T('Start dancing')}</button>}
              {!playersReady && <button className={`btn${songReady ? ' primary' : ''}`} data-gesture-default onClick={() => dispatch({ type: 'openCameraSetup' })}>{T('Camera setup')}</button>}
              {(analysisMessage || (track && analysing == null && !songReady)) && <button className="btn" onClick={() => void analyse()}>{T('Retry analysis')}</button>}
              {current && !songReady && songEdit?.charts[difficulty] !== undefined && <button className="btn" onClick={() => setEditingSong(current)}>{T('Edit markers')}</button>}
              <button className="btn" onClick={() => { setConfirmingRound(false); setChoosingScoreFocus(true) }}>{T('Change options')}</button>
              <button className="btn subtle" data-menu-back onClick={chooseSong}>{T('Change song')}</button>
            </div>
            {!confirmingRound && songReady && playersReady && <p className="round-start-notice" role="status">{T('Get ready — the countdown is starting.')}</p>}
          </div>
        </div><MenuGuide back="Change song" /></main>
      )}</div>
    }
    return (
      <div className={`destination-wrap ${['countdown', 'playing', 'paused'].includes(arcadePhase) ? 'game-screen-active' : ''}`}>
        {renderHeader()}
        {['countdown', 'playing', 'paused'].includes(arcadePhase) && <ArcadeHud key={gameRun} players={gamePlayers} playerCount={registrationPlayers} phase={baseGamePhase} soundMuted={settings.soundMuted} scoreDebug={scoreDebug} onPause={() => dispatch({ type: 'pause' })} />}
        {arcadePhase === 'results' && <section className="game-flow game-results" aria-live="polite" data-gesture-surface><ResultsScreen players={gamePlayers} difficulty={difficulty} records={resultRecords} reducedEffects={settings.reducedEffects} photoRound={resultPhotoRound} photoPrompt={photoPrompt(resultPhotoRound - 1)} takePhoto={settings.resultPhotos} onCapture={captureResultPhoto} onPhotoPendingChange={setResultPhotoPending} onReplay={startRound} onChooseSong={chooseSong} onHome={() => go('openHome')} /></section>}
        {renderPanels('arcade')}
        {arcadePhase === 'playing' && trackingRecovery.mode !== 'playing' && <div className="tracking-recovery" data-recovery-mode={trackingRecovery.mode} role="status" aria-live="polite">
          <span className="kicker">{L('Tracking paused', '追踪已暂停')}</span>
          <h2>{!cameraRunning ? L('Camera off', '摄像头已关闭') : trackingRecovery.mode === 'finding' ? L('Finding you', '正在寻找你') : trackingDigit}</h2>
          <p>{!cameraRunning ? L('Return to camera setup to reconnect.', '返回摄像头设置以重新连接。') : trackingRecovery.mode === 'finding' ? L('Step into the camera. The song will wait.', '站进画面，歌曲会等你。') : L('Get ready to dance again!', '准备好继续跳舞！')}</p>
          {!cameraRunning && <button className="btn primary" onClick={() => dispatch({ type: 'openCameraSetup' })}>{L('Camera setup', '摄像头设置')}</button>}
        </div>}
        {arcadePhase === 'paused' && navigation.screen !== 'settings' && <PauseOverlay onResume={() => dispatch({ type: 'resume' })} onRestart={startRound} onSettings={() => dispatch({ type: 'openSettings' })} onQuit={() => dispatch({ type: 'openHome' })} />}
      </div>
    )
  }

  const renderPractice = () => <div className="destination-wrap practice-distance" data-gesture-surface data-menu-scope="practice">{renderHeader('Practice Studio')}{renderPanels('practice')}{src && <footer className="practice-legend"><span className="legend-group"><span className="legend-title">{T('Reference')}</span><span className="legend-item"><i style={{ background: SIDE_COLORS.left }} /> {T("dancer's left")}</span><span className="legend-item"><i style={{ background: SIDE_COLORS.right }} /> {T("dancer's right")}</span></span><span className="legend-group"><span className="legend-title">{T('You')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.ok }} /> {T('matching')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.warn }} /> {T('a bit off')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.bad }} /> {T('way off')}</span></span></footer>}{src && <MenuGuide back="Home" />}</div>

  const renderEditor = () => <div className="destination-wrap">{renderHeader(L('Beatmap Editor', '谱面编辑器'))}<main className="destination-screen library-screen editor-screen" data-gesture-surface><div className="screen-title-row"><h1>{L('Beatmap Editor', '谱面编辑器')}</h1><button className="btn primary" data-needs-file onClick={() => openFilePicker('arcade')}>{T('Add a dance')}</button></div><p className="editor-screen-description">{L('Choose a song to trim its video, adjust visual markers, and edit lighting.', '选择歌曲，裁剪视频、调整视觉标记并编辑灯光。')}</p><Library intent="edit" entries={library} stats={stats} records={records} currentId={currentId} selectedId={gestureSelectedId} onPreview={(entry) => setGestureSelectedId(entry.id)} onOpen={setEditingSong} onForget={forgetEntry} emptyHint={L('Add a dance video to start editing.', '添加舞蹈视频以开始编辑。')} /></main></div>
  const renderPhotos = () => <div className="destination-wrap">{renderHeader(T('Photos'))}<main className="destination-screen library-screen photos-screen"><ResultPhotoGallery onBack={() => go('openHome')} onPlay={() => go('openArcade')} /></main></div>

  useEffect(() => { setPickerOptionsOpen(false); setPickerOptionsSelected(false) }, [activeScreen, src])

  useLangTick()
  return (
    <div ref={menuMotionRef} className={`app-shell${activeScreen === 'arcade' && arcadePhase === 'results' && resultPhotoPending ? ' results-photo-active' : ''}${navigation.screen === 'tracking' && navigation.returnScreen ? ' camera-setup-open' : ''}`} onFocusCapture={(event) => {
      const item = event.target as HTMLElement
      if (menuItems().includes(item)) setSelectedMenuLabel(markMenuSelection(item, false))
    }} onKeyDownCapture={(event) => {
      if (event.key === 'Escape' && navigation.screen === 'tracking' && !lobby.ready) {
        event.preventDefault(); setDiagnosticRequested(false); dispatch({ type: 'closeCameraSetup' }); return
      }
      if (!menuContext || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
      const target = event.target as HTMLElement
      const surface = activeMenuSurface()
      if (event.key === 'Tab' && [1, 3].includes(Number(surface?.dataset.menuPriority))) {
        const items = menuItems(surface)
        const first = items[0], last = items.at(-1)
        if (first && ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first) || !items.includes(document.activeElement as HTMLElement))) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return
        }
      }
      const editable = !!target.closest('textarea, select, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"])')
      if (target.closest('[data-gesture-skip]') || (Number(surface?.dataset.menuPriority ?? 0) >= 2 && !surface?.contains(target))) return
      const action = menuKeyAction(event.key, editable, event.repeat)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      handleGestureAction(action, 'keyboard')
    }}>
      <UpdateToast deferred={navigation.screen !== 'home' && !(pickingSong && !pickerOptionsOpen)} />
      <div ref={edgeRef} className="edge-light" aria-hidden="true" />
      <div ref={edgeStarsRef} className="edge-stars" aria-hidden="true" />
      <audio ref={menuMusicRef} src={menuTheme ? `${import.meta.env.BASE_URL}audio/${menuTheme.file}` : undefined} loop preload="none" />
      {src && activeScreen === 'arcade' && arcadePhase === 'setup' && <audio ref={difficultyPreviewRef} src={src} preload="auto" onLoadedMetadata={(event) => {
        const audio = event.currentTarget
        difficultyPreviewStartRef.current = Math.max(songEdit?.start ?? 0, Math.min(12, Math.max(0, (songEdit?.end ?? audio.duration) - 8)))
        audio.currentTime = Math.max(songEdit?.start ?? 0, Math.min(selectedPreviewTimeRef.current || difficultyPreviewStartRef.current, (songEdit?.end ?? audio.duration) - .01))
      }} onCanPlay={(event) => { if (choicePreviewActive) void event.currentTarget.play().catch(() => undefined) }} onTimeUpdate={(event) => {
        if (event.currentTarget.currentTime >= Math.min(difficultyPreviewStartRef.current + 7, songEdit?.end ?? Infinity)) event.currentTarget.currentTime = difficultyPreviewStartRef.current
      }} />}
      <RecordingBadge />
      {editingSong && <Suspense fallback={<div className="editor-loading">Opening song editor…</div>}><SongEditor key={editingSong.id} entry={editingSong} reducedEffects={settings.reducedEffects} onClose={() => setEditingSong(null)} onSaved={() => {
        setEditRevision((value) => value + 1)
        setBeatMaps((previous) => { const next = new Map(previous); next.delete(songBeatKey(editingSong.id)); return next })
        void refresh()
      }} /></Suspense>}
      <input ref={fileInputRef} hidden type="file" accept="video/*" multiple onChange={(event) => { void loadFiles(Array.from(event.target.files ?? []), fileDestinationRef.current); event.target.value = '' }} />
      {(importMessage || Object.keys(preparation).length > 0) && <aside className="preparation-status" aria-label={L('Song preparation', '歌曲准备')}>
        <details>
          <summary>{importMessage ?? L(`Preparing songs · ${Object.values(preparation).filter((job) => !job.error).length} pending`, `准备歌曲 · ${Object.values(preparation).filter((job) => !job.error).length} 首待处理`)}{Object.values(preparation).some((job) => job.error) && L(' · Needs attention', ' · 需要处理')}</summary>
          <p>{L('Keep the app open. You can browse while songs prepare.', '请保持应用打开。歌曲准备期间可以浏览菜单。')}</p>
          {Object.entries(preparation).map(([id, job]) => <p key={id}><strong>{job.name}</strong><br />{job.error ?? (job.progress == null ? L('Queued', '等待中') : `${Math.round(job.progress * 100)}%`)}{job.error && <button onClick={() => setPreparation((all) => { const next = { ...all }; delete next[id]; return next })}>{L('Dismiss', '关闭')}</button>}</p>)}
        </details>
      </aside>}
      {navigation.screen === 'attract' && <main ref={attractRef} className={`attract-screen${kioskPlaying ? ' is-demo' : ''}`} onClick={(event) => { if (event.detail === 0) return; playSfx('coin', settings.soundMuted); dispatch({ type: 'wake' }) }}>
        <AttractKiosk library={library} reducedEffects={settings.reducedEffects} onPlayingChange={setKioskPlaying} />
        <div className="attract-rays" aria-hidden="true" />
        <Brand />
        <div className="attract-showcase" aria-hidden="true">
          <div className="attract-orbit orbit-one" /><div className="attract-orbit orbit-two" />
          <img className="attract-dancer" src={`${import.meta.env.BASE_URL}menu/play.webp`} alt="" draggable={false} />
          <span className="attract-sticker sticker-left">{L('FEEL THE BEAT', '感受节拍')}</span>
          <span className="attract-sticker sticker-right">{L('MAKE YOUR MOVE', '舞动起来')}</span>
          <div className="attract-notes">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ '--note-index': index } as React.CSSProperties}>✦</i>)}</div>
        </div>
        <button className="attract-start">{L('PRESS ANY BUTTON', '按任意键开始')}</button>
        <p>{L('Your dance. Your game. One or two players.', '你的舞蹈，你的游戏。一人或两人同玩。')}</p>
      </main>}
      {navigation.screen === 'tracking' && <main className="tracking-screen">
        <h1>{!cameraRunning ? L('Turn on your camera.', '打开摄像头。') : lobby.players === 0 ? L('Step into the frame.', '站进画面。') : L('Raise your right hand.', '举起右手。')}</h1>
        <p>{!cameraRunning ? L('Use the button in the camera view to begin.', '点击摄像头画面中的按钮开始。') : lobby.players === 0 ? L('Step back until your head and both hands fit in the picture.', '向后站，确保头部和双手都在画面内。') : L('Keep your left hand down. Hold your right hand above your head until confirmed.', '放下左手，举起右手高过头顶，保持姿势直到确认。')}</p>
        <div className="tracking-pose-card">
          <img src={`${import.meta.env.BASE_URL}menu/nav-select.webp`} alt="" aria-hidden="true" draggable={false} />
          <strong>{L('RIGHT HAND UP', '举起右手')}</strong>
        </div>
        <div className="tracking-setup">
          <div className="tracking-auto-players" aria-live="polite">
            <span>{L('Automatic player setup', '自动识别玩家')}</span>
            <strong>{!cameraRunning ? L('Camera is off', '摄像头未开启') : lobby.players === 0 ? L('Looking for players', '正在寻找玩家') : L(`${lobby.players} player${lobby.players === 1 ? '' : 's'} in frame`, `${lobby.players} 位玩家在画面中`)}</strong>
            <small>{L('Each player confirms with their right hand.', '每位玩家举起右手分别确认。')}</small>
          </div>
        </div>
        {!diagnosticRequested && <button className="btn subtle tracking-diagnostic" onClick={() => setDiagnosticRequested(true)}>{L('Run camera diagnostics', '运行摄像头检测')}</button>}
        {diagnosticRequested && !lobby.ready && <p className="tracking-diagnostic-wait">{L('Confirm each player to begin the test.', '确认每位玩家后开始检测。')}</p>}
        <button className="btn subtle tracking-back" onClick={() => { setDiagnosticRequested(false); dispatch({ type: 'closeCameraSetup' }) }}>{T(navigation.returnScreen === 'arcade' ? 'Back to round' : navigation.returnScreen === 'practice' ? 'Back to practice' : 'Back to menu')}</button>
      </main>}
      {activeScreen === 'home' && <HomeScreen trackingReady={lobby.ready} selected={homeSelected} motion={homeMotion} onMove={moveHome} onSelect={() => selectHome()} onChoose={selectHome} account={<AccountBar />} />}
      {activeScreen === 'arcade' && renderArcade()}
      {activeScreen === 'practice' && renderPractice()}
      {activeScreen === 'editor' && renderEditor()}
      {activeScreen === 'photos' && renderPhotos()}
      {(navigation.screen === 'home' || (activeScreen === 'arcade' && arcadePhase === 'results' && !resultPhotoPending)) && !recordNoticeDismissed && recordSaveError && <div className="record-sync-warning distance-menu" role="alert" data-gesture-surface data-menu-priority="3">The round finished, but its personal best could not be saved on this device. <button className="btn" data-menu-back data-gesture-default onClick={() => setRecordNoticeDismissed(true)}>Dismiss</button></div>}
      {(navigation.screen === 'home' || (activeScreen === 'arcade' && arcadePhase === 'results' && !resultPhotoPending)) && !recordNoticeDismissed && !recordSaveError && (recordSyncError || syncPending) && <div className="record-sync-warning distance-menu" role="alert" data-gesture-surface data-menu-priority="3">{syncPending ? 'Some account updates could not sync. Retry before closing the app.' : L('Personal bests are saved here, but account sync failed.', '个人最佳成绩已保存在本机，但账号同步失败。')} <button className="btn" data-gesture-default onClick={() => void syncFromAccount()}>{L('Retry', '重试')}</button><button className="btn" data-menu-back onClick={() => setRecordNoticeDismissed(true)}>Dismiss</button></div>}
      {navigation.screen !== 'attract' && <Suspense fallback={null}><div className={`camera-dock camera-${navigation.screen === 'tracking' ? 'tracking' : activeScreen === 'arcade' ? arcadePhase : activeScreen === 'practice' && !src ? 'setup' : activeScreen}${cameraRunning ? '' : ' camera-off'}`}>
        <WebcamPanel selectedMenuLabel={selectedMenuLabel} distanceControls={activeScreen === 'practice' && !!src} motionChart={motionChart} gesturesSuspended={navigation.screen === 'arcade' && arcadePhase === 'results' && resultPhotoPending} targetRef={targetRef} playbackRef={gameVideoRef} track={track} songEdit={activeScreen === 'arcade' ? songEdit : null} videoId={current?.id} videoName={current?.name} onSectionPractice={(deltas) => void recordSectionPractice(deltas)} focus={scoringFocus} onFocusChange={setFocus} showSkeletons={settings.showCameraSkeletons} trackHead={scoringHead} showPoseDebug={settings.showPoseDebug} onPhotoFrameReady={onPhotoFrameReady} gamePhase={activeScreen === 'arcade' ? gamePhase : 'lobby'} gameRun={gameRun} difficulty={difficulty} onLobbyChange={updateLobby} onGameScores={updateGameScores} onGameEnd={(players) => void finishRound(players)} onHits={showHits} onScoreDebug={import.meta.env.DEV ? updateScoreDebug : undefined} onSoloPresence={reportSoloPresence} registrationPlayers={registrationPlayers} onRegistrationPlayersChange={setRegistrationPlayers} registrationScreen={navigation.screen === 'tracking'} diagnosticRequested={diagnosticRequested} onDiagnosticsClose={() => { setDiagnosticRequested(false); dispatch({ type: 'closeCameraSetup' }) }} gestureContext={gestureContext} onGestureAction={handleGestureAction} soundMuted={settings.soundMuted} onRunningChange={setCameraRunning} />
      </div></Suspense>}
      {navigation.screen === 'settings' && (beatLabOpen
        ? <BeatLab library={library} initialTheme={settings.menuTheme} onClose={() => setBeatLabOpen(false)} onMapChange={(key, map) => setBeatMaps((previous) => new Map(previous).set(key, map))} />
        : <SettingsScreen settings={settings} onChange={updateSettings} onClose={() => dispatch({ type: 'closeSettings' })} onOpenBeatLab={() => setBeatLabOpen(true)} onOpenDiagnostics={() => { setDiagnosticRequested(true); dispatch({ type: 'openCameraSetup' }) }} />)}
    </div>
  )
}
