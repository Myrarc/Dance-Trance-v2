import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { TargetPose } from './components/VideoPanel'
import type { ScoreDebug } from './components/WebcamPanel'
import AccountBar from './components/AccountBar'
import Library from './components/Library'
import UpdateToast from './components/UpdateToast'
import { Brand, HomeScreen, PauseOverlay, ResultsScreen, SettingsScreen, type ResultRecord } from './components/GameShell'
import { T, L, useLangTick, LangGlobe, getLang, setLang } from './i18n'
import { LEVEL_COLORS, SIDE_COLORS } from './pose/skeleton'
import type { Focus } from './pose/angles'
import type { PoseTrack } from './pose/track'
import {
  addSectionPractice, forget, getArcadeRecord, getTrack, getVideo, listArcadeRecords,
  listLibrary, mergeRemote, putArcadeRecord, putArcadeRecords, remember, saveSections,
  saveTrack, touch, type LibraryEntry, type Section,
} from './lib/library'
import {
  loadArcadeRecords, loadLibraryIndex, loadSessions, onAuthChange, statsByVideo,
  syncArcadeRecords, syncLibrary, type VideoStats,
} from './playkitClient'
import { MENU_THEMES, loadGameSettings, saveGameSettings, type GameSettings } from './lib/gameSettings'
import { sampleBeat } from './lib/attractBeat'
import { playSfx } from './lib/sfx'
import { accuracy, type GamePhase, type HitGrade, type PlayerRound } from './pose/gameplay'
import type { CueEvent, Difficulty } from './pose/hitTargets'
import type { GestureContext, MenuGesture } from './pose/gestures'
import { gameReducer, initialGameState, type AppScreen } from './game/state'
import { advanceRoundRecovery, effectiveTrackingPhase, initialTrackingRecovery, recoveryCountdown } from './game/trackingRecovery'
import { mergeCloudRecords, recordCompletedRound, recordsForCloud, type ArcadeRecord } from './game/records'

const VideoPanel = lazy(() => import('./components/VideoPanel'))
const WebcamPanel = lazy(() => import('./components/WebcamPanel'))

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']
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

export default function App() {
  const [navigation, dispatch] = useReducer(gameReducer, initialGameState)
  const activeScreen = navigation.screen === 'settings' ? navigation.returnScreen ?? 'home' : navigation.screen
  const [src, setSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [records, setRecords] = useState<ArcadeRecord[]>([])
  const [resultRecords, setResultRecords] = useState<ResultRecord[]>([])
  const [stats, setStats] = useState<Map<string, VideoStats>>(new Map())
  const [current, setCurrent] = useState<LibraryEntry | null>(null)
  const [focus, setFocus] = useState<Focus>('full')
  const [track, setTrack] = useState<PoseTrack | null>(null)
  const [analysing, setAnalysing] = useState<number | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null)
  const [settings, setSettings] = useState<GameSettings>(() => ({ ...loadGameSettings(), language: getLang() }))
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [choosingDifficulty, setChoosingDifficulty] = useState(false)
  const [difficultyMotion, setDifficultyMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [registrationPlayers, setRegistrationPlayers] = useState<1 | 2>(1)
  const [countdown, setCountdown] = useState(3)
  const [trackingRecovery, setTrackingRecovery] = useState(initialTrackingRecovery)
  const [trackingDigit, setTrackingDigit] = useState<number | null>(null)
  const [gameRun, setGameRun] = useState(0)
  const [lobby, setLobby] = useState({ ready: false, players: 0 })
  const [gamePlayers, setGamePlayers] = useState<PlayerRound[]>([])
  const [scoreDebug, setScoreDebug] = useState<ScoreDebug[]>([])
  const [hitFeedback, setHitFeedback] = useState<{ id: number; grade: Exclude<HitGrade, 'miss'>; target: CueEvent } | null>(null)
  const [gestureSelectedId, setGestureSelectedId] = useState<string | null>(null)
  const [carouselMotion, setCarouselMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [homeSelected, setHomeSelected] = useState(0)
  const [homeMotion, setHomeMotion] = useState<{ direction: 'left' | 'right'; turn: number } | null>(null)
  const [previewSrc, setPreviewSrc] = useState<{ id: string; url: string } | null>(null)
  const [previewPaused, setPreviewPaused] = useState(false)
  const [filePickerNotice, setFilePickerNotice] = useState(false)
  const [cameraRunning, setCameraRunning] = useState(false)
  const targetRef = useRef<TargetPose>({ feature: null, history: [], time: 0, gameRun: 0, facing: null, sectionId: null })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileDestinationRef = useRef<AppScreen>('arcade')
  const hitFeedbackIdRef = useRef(0)
  const comboMilestonesRef = useRef<number[]>([])
  const previewRef = useRef<HTMLVideoElement>(null)
  const previewStartRef = useRef(0)
  const selectedPreviewTimeRef = useRef(0)
  const menuMusicRef = useRef<HTMLAudioElement>(null)
  const attractRef = useRef<HTMLElement>(null)
  const beatAudioRef = useRef<{ context: AudioContext; analyser: AnalyserNode } | null>(null)
  const difficultyPreviewRef = useRef<HTMLAudioElement>(null)
  const difficultyPreviewStartRef = useRef(0)
  const wasLobbyReadyRef = useRef(false)
  const trackingRecoveryRef = useRef(initialTrackingRecovery)
  const trackingDigitRef = useRef<number | null>(null)

  const arcadePhase = navigation.arcadePhase
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

  const go = (type: 'openHome' | 'openArcade' | 'openPractice' | 'openLibrary' | 'openSettings') => {
    playSfx('menu', settings.soundMuted)
    if (type === 'openArcade') {
      setSrc(null)
      setChoosingDifficulty(false)
    }
    dispatch({ type })
  }

  const chooseSong = () => {
    setSrc(null)
    setChoosingDifficulty(false)
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
    const [localLibrary, localRecords] = await Promise.all([listLibrary(), listArcadeRecords()])
    if (localLibrary.length) {
      await syncLibrary(localLibrary.map((entry) => ({ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt })))
    }
    if (localRecords.length) await syncArcadeRecords(recordsForCloud(localRecords))
    const [sessions, remoteLibrary, remoteRecords] = await Promise.all([loadSessions(), loadLibraryIndex(), loadArcadeRecords()])
    setStats(statsByVideo(sessions))
    if (remoteLibrary.length) await mergeRemote(remoteLibrary)
    if (remoteRecords.length) await putArcadeRecords(mergeCloudRecords(localRecords, remoteRecords))
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    void syncFromAccount()
    return onAuthChange(() => void syncFromAccount())
  }, [refresh, syncFromAccount])

  const currentId = current?.id ?? null
  useEffect(() => {
    let cancelled = false
    setTrack(null)
    setAnalysisMessage(null)
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
    comboMilestonesRef.current = []
  }, [currentId])

  useEffect(() => {
    if (gamePhase !== 'playing') {
      setHitFeedback(null)
      setScoreDebug([])
    }
  }, [gamePhase])

  useEffect(() => {
    if (!library.length) return setGestureSelectedId(null)
    setGestureSelectedId((selected) => selected && library.some((entry) => entry.id === selected) ? selected : currentId ?? library[0].id)
  }, [currentId, library])

  useEffect(() => {
    if (navigation.screen === 'tracking' && lobby.ready && !wasLobbyReadyRef.current) dispatch({ type: 'openHome' })
    wasLobbyReadyRef.current = lobby.ready
  }, [navigation.screen, lobby.ready])

  const previewEntry = library.find((entry) => entry.id === gestureSelectedId) ?? library[0]
  const previewId = !src && (activeScreen === 'arcade' || activeScreen === 'practice') && previewEntry?.hasVideo ? previewEntry.id : null
  useEffect(() => {
    setPreviewSrc(null)
    if (!previewId) return
    let cancelled = false
    let url: string | null = null
    void getVideo(previewId).then((blob) => {
      if (!blob || cancelled) return
      url = URL.createObjectURL(blob)
      setPreviewSrc({ id: previewId, url })
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [previewId])

  useEffect(() => setFilePickerNotice(false), [navigation.screen, arcadePhase])

  useEffect(() => {
    if (navigation.screen !== 'attract') return
    const wake = (event: KeyboardEvent) => {
      if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) return
      playSfx('menu', settings.soundMuted)
      dispatch({ type: 'wake' })
    }
    window.addEventListener('keydown', wake)
    let frame = 0
    const pollGamepad = () => {
      if (navigator.getGamepads?.().some((pad) => pad?.buttons.some((button) => button.pressed))) {
        playSfx('menu', settings.soundMuted)
        dispatch({ type: 'wake' })
        return
      }
      frame = requestAnimationFrame(pollGamepad)
    }
    frame = requestAnimationFrame(pollGamepad)
    return () => { window.removeEventListener('keydown', wake); cancelAnimationFrame(frame) }
  }, [navigation.screen, settings.soundMuted])

  useEffect(() => {
    if (arcadePhase !== 'countdown') return
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
  }, [arcadePhase, gameRun, settings.soundMuted])

  useEffect(() => {
    if (activeScreen !== 'arcade' || arcadePhase !== 'setup' || choosingDifficulty || !src || !track || !cameraRunning || !lobby.ready || lobby.players < registrationPlayers) return
    const timer = window.setTimeout(() => {
      setGamePlayers([])
      setResultRecords([])
      comboMilestonesRef.current = []
      setGameRun((run) => run + 1)
      dispatch({ type: 'startCountdown' })
    }, 1400)
    return () => clearTimeout(timer)
  }, [activeScreen, arcadePhase, choosingDifficulty, src, track, cameraRunning, lobby.ready, lobby.players, registrationPlayers])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeScreen !== 'arcade' || navigation.screen === 'settings') return
      if (arcadePhase === 'playing') dispatch({ type: 'pause' })
      else if (arcadePhase === 'paused') dispatch({ type: 'resume' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeScreen, arcadePhase, navigation.screen])

  const startRound = () => {
    if (!track || !cameraRunning || !lobby.ready || lobby.players < registrationPlayers) return
    setGamePlayers([])
    setResultRecords([])
    comboMilestonesRef.current = []
    setGameRun((run) => run + 1)
    dispatch({ type: 'startCountdown' })
  }

  const finishRound = async () => {
    if (arcadePhase !== 'playing') return
    dispatch({ type: 'finishRound' })
    if (!current || !gamePlayers.length) return
    const completedAt = Date.now()
    const outcomes: ResultRecord[] = []
    for (let index = 0; index < gamePlayers.length; index++) {
      const player = gamePlayers[index]
      const playerSlot = (index + 1) as 1 | 2
      const existing = await getArcadeRecord(`${current.id}:${difficulty}:${playerSlot}`)
      const outcome = recordCompletedRound(existing, {
        videoId: current.id, difficulty, playerSlot, score: player.score,
        accuracy: accuracy(player), maxCombo: player.maxCombo, completedAt,
      })
      await putArcadeRecord(outcome.record)
      outcomes.push(outcome)
    }
    setResultRecords(outcomes)
    const fresh = await listArcadeRecords()
    setRecords(fresh)
    playSfx(outcomes.some((outcome) => outcome.isNewBest) ? 'record' : 'result', settings.soundMuted)
    void syncArcadeRecords(recordsForCloud(fresh))
  }

  const updateLobby = useCallback((ready: boolean, players: number) => {
    setLobby((value) => value.ready === ready && value.players === players ? value : { ready, players })
  }, [])
  const updateGameScores = useCallback((players: PlayerRound[]) => {
    players.forEach((player, index) => {
      const previous = comboMilestonesRef.current[index] ?? 0
      if (player.combo >= 5 && player.combo % 5 === 0 && player.combo !== previous) {
        playSfx('combo', settings.soundMuted)
      }
      comboMilestonesRef.current[index] = player.combo
    })
    setGamePlayers(players)
  }, [settings.soundMuted])
  const updateScoreDebug = useCallback((entries: ScoreDebug[]) => {
    setScoreDebug((currentScores) => {
      const next = [...currentScores]
      for (const entry of entries) next[entry.player - 1] = entry
      return next
    })
  }, [])
  const showHit = useCallback((grade: Exclude<HitGrade, 'miss'>, target: CueEvent) => {
    setHitFeedback({ id: ++hitFeedbackIdRef.current, grade, target })
    playSfx(grade, settings.soundMuted)
  }, [settings.soundMuted])

  const analyseBlob = async (entry: LibraryEntry, blob: Blob) => {
    if (analysing != null) return
    setAnalysing(0)
    setAnalysisMessage(null)
    try {
      const { analyseVideo, packTrack } = await import('./pose/track')
      const result = await analyseVideo(blob, setAnalysing, () => false, undefined,
        () => setAnalysisMessage(L('Preparing your song a different way…', '正在用另一种方式准备歌曲…')))
      if (result) {
        await saveTrack(entry.id, packTrack(result))
        setTrack(result)
        setAnalysisMessage(null)
        await refresh()
      }
    } catch (error) {
      console.error('Video analysis failed', error)
      setAnalysisMessage(L('Could not prepare this video. Try another file.', '无法准备此视频，请试试其他文件。'))
    } finally {
      setAnalysing(null)
    }
  }

  const analyse = async () => {
    if (!current || analysing != null) return
    const blob = await getVideo(current.id)
    if (blob) await analyseBlob(current, blob)
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
    selectedPreviewTimeRef.current = 0
    setTrack(null)
    play(file)
    const entry = await remember(file)
    setCurrent(entry)
    setChoosingDifficulty(destination === 'arcade')
    setDifficultyMotion(null)
    await refresh()
    dispatch({ type: destination === 'practice' ? 'openPractice' : 'openArcade' })
    if (entry) {
      void syncLibrary([{ id: entry.id, name: entry.name, duration: entry.duration, lastOpenedAt: entry.lastOpenedAt }])
      const stored = await getTrack(entry.id)
      const { unpackTrack } = await import('./pose/track')
      const decoded = stored ? unpackTrack(stored) : null
      if (decoded?.rhythmAnalysed) setTrack(decoded)
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
    selectedPreviewTimeRef.current = previewSrc?.id === entry.id ? previewRef.current?.currentTime ?? 0 : 0
    setTrack(null)
    play(blob)
    setCurrent(entry)
    setChoosingDifficulty(destination === 'arcade')
    setDifficultyMotion(null)
    await touch(entry.id)
    await refresh()
    dispatch({ type: destination === 'practice' ? 'openPractice' : 'openArcade' })
    const stored = await getTrack(entry.id)
    const { unpackTrack } = await import('./pose/track')
    const decoded = stored ? unpackTrack(stored) : null
    if (decoded?.rhythmAnalysed) setTrack(decoded)
    else await analyseBlob(entry, blob)
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
    await forget(entry.id)
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

  const pickingSong = !src && navigation.screen !== 'settings' && (activeScreen === 'arcade' || activeScreen === 'practice')
  const menuMusicActive = !pickingSong && (navigation.screen === 'attract' || !src || (activeScreen === 'arcade' && arcadePhase === 'results') || (activeScreen !== 'arcade' && activeScreen !== 'practice'))
  const menuTheme = MENU_THEMES.find((theme) => theme.id === settings.menuTheme)
  useEffect(() => {
    const audio = menuMusicRef.current
    if (!audio) return
    if (!menuTheme) { audio.pause(); return }
    if (menuMusicActive) {
      if (audio.paused) audio.volume = 0
      void audio.play().catch(() => undefined)
      return fadeVolume(audio, MENU_MUSIC_VOLUME)
    }
    if (!audio.paused) return fadeVolume(audio, 0, () => audio.pause())
  }, [menuMusicActive, menuTheme, navigation.screen])

  useEffect(() => {
    const audio = menuMusicRef.current
    const attract = attractRef.current
    if (!audio || !attract || !menuTheme || settings.reducedEffects || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      attract.removeAttribute('data-beat-active')
      attract.style.removeProperty('--beat-logo-scale')
      attract.style.removeProperty('--beat-button-scale')
      attract.style.removeProperty('--beat-glow')
      attract.style.removeProperty('--beat-opacity')
    }
    const start = () => {
      if (frame || audio.paused) return
      if (!beatAudioRef.current) {
        const context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = .35
        context.createMediaElementSource(audio).connect(analyser).connect(context.destination)
        beatAudioRef.current = { context, analyser }
      }
      const { context, analyser } = beatAudioRef.current
      void context.resume().catch(() => undefined)
      const frequencies = new Uint8Array(analyser.frequencyBinCount)
      const tracker = { baseline: 0, previous: 0, lastBeat: -Infinity }
      attract.setAttribute('data-beat-active', '')
      const tick = (now: number) => {
        analyser.getByteFrequencyData(frequencies)
        let energy = 0
        for (let bin = 2; bin <= 24; bin++) energy += frequencies[bin]
        sampleBeat(tracker, energy / 23, now)
        const pulse = Math.max(0, 1 - (now - tracker.lastBeat) / 340)
        attract.style.setProperty('--beat-logo-scale', String(1 + pulse * .09))
        attract.style.setProperty('--beat-button-scale', String(1 + pulse * .06))
        attract.style.setProperty('--beat-glow', `${Math.round(pulse * 38)}px`)
        attract.style.setProperty('--beat-opacity', String(pulse * .9))
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
    audio.addEventListener('play', start)
    audio.addEventListener('pause', stop)
    start()
    return () => {
      audio.removeEventListener('play', start)
      audio.removeEventListener('pause', stop)
      stop()
    }
  }, [navigation.screen, menuTheme, settings.reducedEffects])

  useEffect(() => {
    const audio = difficultyPreviewRef.current
    if (!audio) return
    if (choosingDifficulty) {
      audio.volume = PREVIEW_VOLUME
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) void audio.play().catch(() => undefined)
      return
    }
    if (!audio.paused) return fadeVolume(audio, 0, () => audio.pause())
  }, [choosingDifficulty, src, activeScreen, arcadePhase])
  useEffect(() => { if (!pickingSong) setCarouselMotion(null) }, [pickingSong])
  useEffect(() => {
    if (!carouselMotion) return
    const timer = window.setTimeout(() => setCarouselMotion(null), 520)
    return () => window.clearTimeout(timer)
  }, [carouselMotion])
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
    if (!previewEntry || library.length < 2) return
    playNavigationCue(direction)
    const index = library.findIndex((entry) => entry.id === previewEntry.id)
    setCarouselMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    setGestureSelectedId(library[(index + (direction === 'left' ? -1 : 1) + library.length) % library.length].id)
  }
  const moveHome = (direction: 'left' | 'right') => {
    playNavigationCue(direction)
    setHomeMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    setHomeSelected((index) => (index + (direction === 'left' ? 4 : 1)) % 5)
  }
  const moveDifficulty = (direction: 'left' | 'right') => {
    playNavigationCue(direction)
    const index = DIFFICULTIES.indexOf(difficulty)
    setDifficultyMotion((motion) => ({ direction, turn: (motion?.turn ?? 0) + 1 }))
    setDifficulty(DIFFICULTIES[(index + (direction === 'left' ? -1 : 1) + DIFFICULTIES.length) % DIFFICULTIES.length])
  }
  const startSelectedDifficulty = () => {
    setDifficultyMotion(null)
    setChoosingDifficulty(false)
  }
  const selectHome = () => {
    if (homeSelected === 0) go('openArcade')
    else if (homeSelected === 1) go('openPractice')
    else if (homeSelected === 2) go('openLibrary')
    else if (homeSelected === 3) go('openSettings')
    else dispatch({ type: 'wake' })
  }
  const gestureContext: GestureContext | null = lobby.ready && navigation.screen !== 'tracking' &&
    navigation.screen !== 'attract' && !(activeScreen === 'arcade' && src && arcadePhase !== 'results' && !choosingDifficulty) ? pickingSong ? 'songPicker' : 'menu' : null
  const hasTrack = !!track

  const menuItems = () => {
    const surfaces = document.querySelectorAll<HTMLElement>('[data-gesture-surface]')
    const surface = surfaces[surfaces.length - 1]
    return surface ? [...surface.querySelectorAll<HTMLElement>('button:not(:disabled), input[type="checkbox"]')]
      .filter((item) => !item.closest('[data-gesture-skip]') && item.getClientRects().length > 0) : []
  }

  const selectMenuItem = (item: HTMLElement) => {
    setFilePickerNotice(false)
    document.querySelectorAll('[data-gesture-selected]').forEach((old) => old.removeAttribute('data-gesture-selected'))
    item.setAttribute('data-gesture-selected', 'true')
    item.setAttribute('data-selection-label', L('SELECTED', '已选择'))
    item.focus({ preventScroll: true })
    if (!item.closest('.song-carousel')) item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  useEffect(() => {
    if (!gestureContext || navigation.screen === 'home') return
    const frame = requestAnimationFrame(() => {
      const items = menuItems()
      const first = (pickingSong ? items.find((item) => item.getAttribute('data-track-id') === previewEntry?.id) : null) ??
        items.find((item) => item.hasAttribute('data-gesture-default')) ??
        (activeScreen === 'arcade' || activeScreen === 'practice' || activeScreen === 'library' ? items.find((item) => item.hasAttribute('data-track-id')) : null) ?? items[0]
      if (first) selectMenuItem(first)
    })
    return () => cancelAnimationFrame(frame)
  }, [navigation.screen, arcadePhase, currentId, library.length, hasTrack, gestureContext, activeScreen, pickingSong, previewEntry?.id, choosingDifficulty, difficulty])

  const handleGestureAction = (gesture: MenuGesture) => {
    if (activeScreen === 'arcade' && arcadePhase === 'playing' && gesture === 'back') {
      dispatch({ type: 'pause' })
      return
    }
    if (!gestureContext) return
    if (gesture === 'back') {
      if (navigation.screen === 'settings') dispatch({ type: 'closeSettings' })
      else if (activeScreen === 'arcade' && arcadePhase === 'paused') dispatch({ type: 'resume' })
      else if (activeScreen === 'arcade' && arcadePhase === 'results') chooseSong()
      else if (choosingDifficulty) chooseSong()
      else if (navigation.screen === 'home') dispatch({ type: 'quitHome' })
      else dispatch({ type: 'openHome' })
      return
    }
    if (navigation.screen === 'home') {
      if (gesture === 'confirm') selectHome()
      else moveHome(gesture === 'previous' ? 'left' : 'right')
      return
    }
    if (choosingDifficulty) {
      if (gesture === 'confirm') startSelectedDifficulty()
      else moveDifficulty(gesture === 'previous' ? 'left' : 'right')
      return
    }
    if (pickingSong && previewEntry) {
      if (gesture === 'confirm') void openEntry(previewEntry, activeScreen)
      else moveSong(gesture === 'previous' ? 'left' : 'right')
      return
    }
    const items = menuItems()
    if (!items.length) return
    const index = Math.max(0, items.findIndex((item) => item.hasAttribute('data-gesture-selected')))
    if (gesture === 'confirm') {
      if (items[index].hasAttribute('data-needs-file')) setFilePickerNotice(true)
      else items[index].click()
      return
    }
    if (items.length < 2) return
    const direction = gesture === 'previous' ? 'left' : 'right'
    playNavigationCue(direction)
    selectMenuItem(items[(index + (direction === 'left' ? -1 : 1) + items.length) % items.length])
  }

  const renderHeader = (title: string) => (
    <header className="app-header">
      <button className="brand-button" onClick={() => go('openHome')} aria-label={T('Home')}><Brand compact /></button>
      <span className="screen-label">{T(title)}</span>
      <nav><button className="btn subtle" onClick={() => go('openLibrary')}>{L(`Library (${library.length})`, `舞蹈库（${library.length}）`)}</button><button className="btn subtle" onClick={() => go('openSettings')}>{T('Settings')}</button><AccountBar /></nav>
    </header>
  )

  const renderTrackPicker = (destination: 'arcade' | 'practice') => (
    <section className={`track-picker ${dragOver ? 'over' : ''}`} data-gesture-surface
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); void loadFile(event.dataTransfer.files?.[0], destination) }}>
      <div className="picker-heading"><h1>{L(destination === 'arcade' ? 'Select your track' : 'Select a routine', destination === 'arcade' ? '选择歌曲' : '选择练习')}</h1><p>{L('Left arm out: previous song · Right arm out: next song · Right hand up: play · Left hand up: back', '左臂平伸：上一首 · 右臂平伸：下一首 · 举右手：开始 · 举左手：返回')}</p></div>
      <div className="picker-stage">
        {library.length ? <div key={carouselMotion?.turn ?? 0} className={`song-carousel${carouselMotion ? ` is-moving-${carouselMotion.direction}` : ''}`} data-count={library.length} role="group" aria-label={L('Song picker', '歌曲选择')}>
          {([library.length > 1 ? library[(library.findIndex((entry) => entry.id === previewEntry.id) - 1 + library.length) % library.length] : null, previewEntry, library.length > 2 ? library[(library.findIndex((entry) => entry.id === previewEntry.id) + 1) % library.length] : null] as const).map((entry, slot) => entry ? <button
            key={entry.id}
            className={`song-card song-card-${slot === 0 ? 'left' : slot === 1 ? 'center' : 'right'}`}
            data-track-id={entry.id}
            data-gesture-label={entry.name.replace(/\.[^.]+$/, '')}
            aria-current={slot === 1 ? 'true' : undefined}
            onClick={() => { if (slot === 1) void openEntry(entry, destination); else moveSong(slot === 0 ? 'left' : 'right') }}
          >
            <span className="song-card-media">
              {slot === 1 && previewSrc?.id === entry.id ? <video ref={previewRef} src={previewSrc.url} poster={entry.thumb} playsInline preload="auto" onLoadedMetadata={(event) => {
              const video = event.currentTarget
              previewStartRef.current = Math.min(12, Math.max(0, video.duration - 8))
              video.currentTime = previewStartRef.current
            }} onCanPlay={(event) => { void event.currentTarget.play().catch(() => setPreviewPaused(true)) }} onPlay={() => setPreviewPaused(false)} onPause={() => setPreviewPaused(true)} onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= previewStartRef.current + 7) event.currentTarget.currentTime = previewStartRef.current
            }} /> : entry.thumb && <img src={entry.thumb} alt="" />}
            </span>
            <strong title={entry.name}>{entry.name.replace(/\.[^.]+$/, '')}</strong>
            <span>{slot === 1 ? entry.hasVideo ? L('Preview loops · select to dance', '循环预览 · 选择后开始跳舞') : L('Add video again to play', '重新添加视频以开始游戏') : L('Browse to this song', '浏览这首歌曲')}</span>
          </button> : null)}
        </div> : <p className="library-empty">{T('Your prepared songs will appear here.')}</p>}
        {previewPaused && previewSrc?.id === previewEntry?.id && <button className="btn primary preview-play" onClick={() => { void previewRef.current?.play() }}>{L('Play preview', '播放预览')}</button>}
      </div>
      <div className="picker-import"><button className="btn primary" data-needs-file onClick={() => openFilePicker(destination)}>{L('+ Add a video', '+ 添加视频')}</button><span className={filePickerNotice ? 'is-notice' : undefined} role={filePickerNotice ? 'status' : undefined}>{filePickerNotice ? L('Use the device to choose a video file.', '请用设备选择视频文件。') : L('Drop a dance video here, or choose one to play.', '将舞蹈视频拖到这里，或选择一个开始游戏。')}</span></div>
    </section>
  )

  const renderPanels = (mode: 'arcade' | 'practice') => {
    if (!src) return renderTrackPicker(mode)
    const panelPhase: GamePhase = mode === 'practice' ? 'lobby' : gamePhase
    return (
      <Suspense fallback={<LoadingStage />}>
        <main className={`panels ${mode === 'arcade' && ['countdown', 'playing', 'paused'].includes(gamePhase) ? 'game-active' : mode === 'arcade' && gamePhase === 'results' ? 'game-results-stage' : ''}`}>
          <VideoPanel src={src} targetRef={targetRef} sections={current?.sections ?? []} sectionStats={current?.sectionStats} onSectionsChange={(sections) => void updateSections(sections)} focus={focus} track={track} onAnalyse={() => void analyse()} analysing={analysing} analysisMessage={analysisMessage} showSkeletons={settings.showSkeletons} trackHead={settings.trackHead} difficulty={difficulty} gamePhase={panelPhase} countdown={countdown} gameRun={gameRun} onGameEnd={() => void finishRound()} hitFeedback={hitFeedback} />
        </main>
      </Suspense>
    )
  }

  const renderDifficultyPicker = () => {
    const selectedIndex = DIFFICULTIES.indexOf(difficulty)
    const descriptions: Record<Difficulty, string> = {
      easy: L('Fewer cues. Find the rhythm.', '更少提示，先找到节奏。'),
      normal: L('One clear cue at a time.', '每次一个清晰提示。'),
      hard: L('More cues. Keep every move sharp.', '更多提示，每个动作都要精准。'),
    }
    return <main className="difficulty-screen" data-gesture-surface onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        moveDifficulty(event.key === 'ArrowLeft' ? 'left' : 'right')
      } else if (event.key === 'Escape') {
        event.preventDefault()
        chooseSong()
      }
    }}>
      <div className="difficulty-heading"><h1>{L('Choose your difficulty.', '选择难度。')}</h1><p>{L('Pick your pace, then raise your right hand or press Enter to start.', '选择节奏，然后举起右手或按 Enter 开始。')}</p></div>
      <div className="difficulty-song-bar">
        <span className="difficulty-song-art">{current?.thumb ? <img src={current.thumb} alt="" /> : '♪'}</span>
        <span><small>{L('Selected song', '已选歌曲')}</small><strong>{current?.name.replace(/\.[^.]+$/, '') ?? T('Your dance')}</strong></span>
        <button className="btn subtle" onClick={chooseSong}>{T('Change song')}</button>
      </div>
      <nav key={difficultyMotion?.turn ?? 0} className={`song-carousel difficulty-carousel${difficultyMotion ? ` is-moving-${difficultyMotion.direction}` : ''}`} aria-label={T('Difficulty')}>
        {([-1, 0, 1] as const).map((offset) => {
          const level = DIFFICULTIES[(selectedIndex + offset + DIFFICULTIES.length) % DIFFICULTIES.length]
          const position = offset === -1 ? 'left' : offset === 1 ? 'right' : 'center'
          return <button
            key={level}
            className={`song-card song-card-${position} difficulty-card difficulty-card-${level}`}
            aria-current={offset === 0 ? 'true' : undefined}
            aria-label={offset === 0 ? L(`Start ${level}`, `开始${T(level)}`) : T(level)}
            data-gesture-default={offset === 0 ? '' : undefined}
            onClick={() => offset === 0 ? startSelectedDifficulty() : moveDifficulty(offset === -1 ? 'left' : 'right')}
          >
            <span>{L('Difficulty', '难度')}</span>
            <strong>{T(level)}</strong>
            <small>{descriptions[level]}</small>
            <i aria-hidden="true">{offset === 0 ? L('START', '开始') : offset === -1 ? '←' : '→'}</i>
          </button>
        })}
      </nav>
      <p className="difficulty-navigation-hint">{L('← Easier · Harder → · Right hand up or Enter to start', '← 更简单 · 更困难 → · 举右手或按 Enter 开始')}</p>
    </main>
  }

  const renderArcade = () => {
    if (arcadePhase === 'setup') {
      return <div className="destination-wrap">{renderHeader('Arcade')}{!src ? renderTrackPicker('arcade') : choosingDifficulty ? renderDifficultyPicker() : (
        <main className="song-loading-screen" role="status" aria-live="polite"><div className="song-loading-card">
          <div className="song-loading-art">{current?.thumb ? <img src={current.thumb} alt="" /> : <span>♪</span>}</div>
          <div className="song-loading-copy"><span className="kicker">{L('Up next', '即将开始')}</span><h1>{current?.name.replace(/\.[^.]+$/, '') ?? T('Your dance')}</h1>
            <p>{analysisMessage ?? (analysing != null ? L(`Getting your song ready · ${Math.round(analysing * 100)}%`, `正在准备歌曲 · ${Math.round(analysing * 100)}%`) : !track ? L('Getting your song ready…', '正在准备歌曲…') : !cameraRunning ? L('Turn on your camera to play.', '打开摄像头开始游戏。') : !lobby.ready || lobby.players < registrationPlayers ? L('Step back into view to start.', '回到画面中即可开始。') : L('Get ready to dance!', '准备好跳舞！'))}</p>
            <div className="song-loading-progress"><i style={{ width: `${Math.round((analysing ?? (track ? 1 : 0.08)) * 100)}%` }} /></div>
            <button className="btn" onClick={chooseSong}>{T('Change song')}</button>
          </div>
        </div></main>
      )}</div>
    }
    return (
      <div className={`destination-wrap ${['countdown', 'playing', 'paused'].includes(arcadePhase) ? 'game-screen-active' : ''}`}>
        {renderHeader('Arcade')}
        {arcadePhase === 'playing' && <section className="game-flow game-playing" aria-live="polite"><div className="game-score-strip">{(gamePlayers.length ? gamePlayers : Array.from({ length: Math.max(1, lobby.players) }, () => null)).map((player, index) => <span key={index}><b>P{index + 1}</b> {player?.score.toLocaleString() ?? '0'}<small>{player?.combo ? `${player.combo}× ${T('combo')}` : T('build your combo')}</small>{import.meta.env.DEV && scoreDebug[index] && <small className="score-debug">{scoreDebug[index].cue} · {scoreDebug[index].grade} · {Math.round(scoreDebug[index].lag * 1000)}ms</small>}</span>)}</div><button className="pause-button" onClick={() => dispatch({ type: 'pause' })} aria-label={T('Pause')}>Ⅱ</button></section>}
        {arcadePhase === 'results' && <section className="game-flow game-results" aria-live="polite" data-gesture-surface><ResultsScreen players={gamePlayers} difficulty={difficulty} records={resultRecords} reducedEffects={settings.reducedEffects} onReplay={startRound} onChooseSong={chooseSong} onHome={() => dispatch({ type: 'openHome' })} /></section>}
        {renderPanels('arcade')}
        {arcadePhase === 'playing' && trackingRecovery.mode !== 'playing' && <div className="tracking-recovery" role="status" aria-live="polite">
          <span className="kicker">{L('Tracking paused', '追踪已暂停')}</span>
          <h2>{!cameraRunning ? L('Camera off', '摄像头已关闭') : trackingRecovery.mode === 'finding' ? L('Finding you', '正在寻找你') : trackingDigit}</h2>
          <p>{!cameraRunning ? L('Return to camera setup to reconnect.', '返回摄像头设置以重新连接。') : trackingRecovery.mode === 'finding' ? L('Step into the camera. The song will wait.', '站进画面，歌曲会等你。') : L('Get ready to dance again!', '准备好继续跳舞！')}</p>
          {!cameraRunning && <button className="btn primary" onClick={() => dispatch({ type: 'wake' })}>{L('Camera setup', '摄像头设置')}</button>}
        </div>}
        {arcadePhase === 'paused' && navigation.screen !== 'settings' && <PauseOverlay onResume={() => dispatch({ type: 'resume' })} onRestart={() => { setGameRun((run) => run + 1); dispatch({ type: 'restart' }) }} onSettings={() => dispatch({ type: 'openSettings' })} onQuit={() => dispatch({ type: 'openHome' })} />}
      </div>
    )
  }

  const renderPractice = () => <div className="destination-wrap" data-gesture-surface>{renderHeader('Practice Studio')}{renderPanels('practice')}{src && <footer className="practice-legend"><span className="legend-group"><span className="legend-title">{T('Reference')}</span><span className="legend-item"><i style={{ background: SIDE_COLORS.left }} /> {T("dancer's left")}</span><span className="legend-item"><i style={{ background: SIDE_COLORS.right }} /> {T("dancer's right")}</span></span><span className="legend-group"><span className="legend-title">{T('You')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.ok }} /> {T('matching')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.warn }} /> {T('a bit off')}</span><span className="legend-item"><i style={{ background: LEVEL_COLORS.bad }} /> {T('way off')}</span></span></footer>}</div>

  const renderLibrary = () => <div className="destination-wrap">{renderHeader('Library')}<main className="destination-screen library-screen" data-gesture-surface><div className="screen-title-row"><h1>{L('Your songs', '你的歌曲')}</h1><button className="btn primary" data-needs-file onClick={() => openFilePicker('arcade')}>{T('Add a dance')}</button></div>{filePickerNotice && <p className="file-picker-notice" role="status">{L('Use the device to choose a video file.', '请用设备选择视频文件。')}</p>}<Library entries={library} stats={stats} records={records} currentId={currentId} selectedId={gestureSelectedId} onPreview={(entry) => setGestureSelectedId(entry.id)} onOpen={(entry) => void openEntry(entry)} onForget={(entry) => void forgetEntry(entry)} emptyHint={T('No songs yet. Add a dance video to build your library.')} /></main></div>

  useLangTick()
  return (
    <div className="app-shell">
      <LangGlobe />
      <UpdateToast />
      <audio ref={menuMusicRef} src={menuTheme ? `${import.meta.env.BASE_URL}audio/${menuTheme.file}` : undefined} loop preload="none" />
      {src && activeScreen === 'arcade' && arcadePhase === 'setup' && <audio ref={difficultyPreviewRef} src={src} preload="auto" onLoadedMetadata={(event) => {
        const audio = event.currentTarget
        difficultyPreviewStartRef.current = Math.min(12, Math.max(0, audio.duration - 8))
        audio.currentTime = selectedPreviewTimeRef.current || difficultyPreviewStartRef.current
      }} onCanPlay={(event) => { if (choosingDifficulty) void event.currentTarget.play().catch(() => undefined) }} onTimeUpdate={(event) => {
        if (event.currentTarget.currentTime >= difficultyPreviewStartRef.current + 7) event.currentTarget.currentTime = difficultyPreviewStartRef.current
      }} />}
      <input ref={fileInputRef} hidden type="file" accept="video/*" onChange={(event) => { void loadFile(event.target.files?.[0], fileDestinationRef.current); event.target.value = '' }} />
      {navigation.screen === 'attract' && <main ref={attractRef} className="attract-screen" onClick={(event) => { if (event.detail === 0) return; playSfx('menu', settings.soundMuted); dispatch({ type: 'wake' }) }}>
        <Brand />
        <div className="attract-demo" aria-hidden="true">
          <span className="demo-player demo-one">P1</span><span className="demo-player demo-two">P2</span>
          <span className="demo-hit">PERFECT!</span><span className="demo-combo">12× COMBO</span>
          <span className="demo-rail"><i /><i /><i /><i /></span>
        </div>
        <button className="attract-start">{L('PRESS ANY BUTTON', '按任意键开始')}</button>
        <p>{L('Your dance. Your game. One or two players.', '你的舞蹈，你的游戏。一人或两人同玩。')}</p>
      </main>}
      {navigation.screen === 'tracking' && <main className="tracking-screen">
        <h1>{L('Get in the picture.', '进入画面。')}</h1>
        <p>{L('Turn on the camera. Step into the box, raise your right hand, then lower it to enter.', '打开摄像头。站进框内，举起右手，再放下即可进入。')}</p>
        <div className="tracking-setup">
          <fieldset className="tracking-player-choice">
            <legend>{T('Players')}</legend>
            <div>{([1, 2] as const).map((count) => <button key={count} className={`btn${registrationPlayers === count ? ' active' : ''}`} aria-pressed={registrationPlayers === count} onClick={() => setRegistrationPlayers(count)}>{L(`${count} player${count === 1 ? '' : 's'}`, `${count} 位玩家`)}</button>)}</div>
          </fieldset>
          <fieldset>
            <legend>{L('Score focus', '计分重点')}</legend>
            <div>{([['full', T('Whole body')], ['upper', T('Arms only')], ['lower', T('Legs only')]] as const).map(([mode, label]) => <button key={mode} className={`btn${focus === mode ? ' active' : ''}`} aria-pressed={focus === mode} onClick={() => setFocus(mode)}>{label}</button>)}</div>
          </fieldset>
        </div>
        <button className="btn subtle tracking-back" onClick={() => dispatch({ type: 'openHome' })}>{L('Back to menu', '返回菜单')}</button>
      </main>}
      {activeScreen === 'home' && <HomeScreen trackingReady={lobby.ready} selected={homeSelected} motion={homeMotion} onMove={moveHome} onSelect={selectHome} account={<AccountBar />} />}
      {activeScreen === 'arcade' && renderArcade()}
      {activeScreen === 'practice' && renderPractice()}
      {activeScreen === 'library' && renderLibrary()}
      {navigation.screen !== 'attract' && <Suspense fallback={null}><div className={`camera-dock camera-${navigation.screen === 'tracking' ? 'tracking' : activeScreen === 'arcade' ? arcadePhase : activeScreen}${cameraRunning ? '' : ' camera-off'}`}>
        <WebcamPanel targetRef={targetRef} videoId={current?.id} videoName={current?.name} onSectionPractice={(deltas) => void recordSectionPractice(deltas)} focus={focus} onFocusChange={setFocus} showSkeletons={settings.showCameraSkeletons} onShowSkeletonsChange={(visible) => updateSettings({ ...settings, showCameraSkeletons: visible })} trackHead={settings.trackHead} gamePhase={activeScreen === 'arcade' ? gamePhase : 'lobby'} gameRun={gameRun} onLobbyChange={updateLobby} onGameScores={updateGameScores} onHit={showHit} onScoreDebug={import.meta.env.DEV ? updateScoreDebug : undefined} onSoloPresence={reportSoloPresence} registrationPlayers={registrationPlayers} onRegistrationPlayersChange={activeScreen === 'practice' ? setRegistrationPlayers : undefined} gestureContext={gestureContext} onGestureAction={handleGestureAction} soundMuted={settings.soundMuted} onRunningChange={setCameraRunning} />
      </div></Suspense>}
      {navigation.screen === 'settings' && <SettingsScreen settings={settings} onChange={updateSettings} onClose={() => dispatch({ type: 'closeSettings' })} />}
    </div>
  )
}
