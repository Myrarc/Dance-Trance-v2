import { L, T } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import { createPoseLandmarker } from '../pose/landmarker'
import { drawSkeleton, LEVEL_COLORS, LM } from '../pose/skeleton'
import { computeAngles, compareToHistory, levelConnectionColors, dimmedSegments, HEAD, type Focus, type LagState, type PoseFeature } from '../pose/angles'
import { LandmarkSmoother } from '../pose/filter'
import { framingProblems } from '../pose/checkup'
import { FrameMeter, frameTimestampMs, type FrameMetrics } from '../pose/frameMeter'
import { advanceRegistration, initialRegistration, selectRegistrationCount } from '../pose/registration'
import { advanceCalibration, beginCalibration, type CalibrationIssue, type CalibrationState } from '../pose/calibration'
import { createPlayerLock, matchPlayerLock, primarySoloCandidate, registrationCandidates, type ColorSignature, type LockReason, type PlayerLock } from '../pose/playerLock'
import { CameraRequestTimeoutError, requestCameraStream } from '../lib/cameraStream'
import { playSfx } from '../lib/sfx'
import Checkup from './Checkup'
import {
  advanceGestureFromPose,
  advancePauseHold,
  gestureLabel,
  inPlayerZone,
  isCrossedArms,
  isRightHandRaised,
  playerScreenX,
  type GestureContext,
  type GestureHold,
  type MenuGesture,
} from '../pose/gestures'
import {
  advanceMotionRound,
  isGameRunReady,
  newMotionRound,
  type CueFrame,
  type GamePhase,
  type HitGrade,
  type MotionRound,
  type PlayerRound,
} from '../pose/gameplay'
import { advanceScoringClock, buildMotionIntervals, evaluateMotionInterval, liveMotionFrame, motionLagLimit, referenceMotionFrames, type MotionFrame } from '../pose/motionScore'
import type { Difficulty } from '../pose/hitTargets'
import type { PoseTrack } from '../pose/track'

/** Whether to mirror the comparison; 'auto' follows the reference's facing. */
type MirrorMode = 'auto' | 'mirror' | 'direct'
const LIVE_INFERENCE_INTERVAL_MS = 33
const LIVE_INPUT_WIDTH = 960
const APPEARANCE_SAMPLE_SIZE = 8
const EMPTY_GESTURE_HOLD: GestureHold = { candidate: null, since: 0, latched: false, beeps: 0, lastBeepAt: 0 }

/** A tiny chest crop helps distinguish dancers without storing or sending camera images. */
function sampleTorsoColor(input: HTMLCanvasElement, sample: HTMLCanvasElement, pose: NormalizedLandmark[]): ColorSignature | null {
  const [left, right, leftHip, rightHip] = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].map((index) => pose[index])
  if ([left, right, leftHip, rightHip].some((point) => !point || (point.visibility ?? 1) < 0.5)) return null
  const shoulderY = (left.y + right.y) / 2
  const hipY = (leftHip.y + rightHip.y) / 2
  const shoulderWidth = Math.abs(left.x - right.x)
  if (hipY <= shoulderY || shoulderWidth < 0.04) return null
  const centerX = (left.x + right.x) / 2
  const x0 = Math.max(0, centerX - shoulderWidth * 0.2)
  const x1 = Math.min(1, centerX + shoulderWidth * 0.2)
  const y0 = Math.max(0, shoulderY + (hipY - shoulderY) * 0.25)
  const y1 = Math.min(1, shoulderY + (hipY - shoulderY) * 0.65)
  if ((x1 - x0) * input.width < 4 || (y1 - y0) * input.height < 4) return null
  if (sample.width !== APPEARANCE_SAMPLE_SIZE || sample.height !== APPEARANCE_SAMPLE_SIZE) {
    sample.width = APPEARANCE_SAMPLE_SIZE
    sample.height = APPEARANCE_SAMPLE_SIZE
  }
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(input, x0 * input.width, y0 * input.height, (x1 - x0) * input.width, (y1 - y0) * input.height,
    0, 0, APPEARANCE_SAMPLE_SIZE, APPEARANCE_SAMPLE_SIZE)
  const pixels = ctx.getImageData(0, 0, APPEARANCE_SAMPLE_SIZE, APPEARANCE_SAMPLE_SIZE).data
  let r = 0, g = 0, b = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    r += pixels[offset]
    g += pixels[offset + 1]
    b += pixels[offset + 2]
  }
  const count = APPEARANCE_SAMPLE_SIZE ** 2
  return { r: r / count, g: g / count, b: b / count }
}
const CALIBRATION_ADVICE: Record<CalibrationIssue, string> = {
  missing: 'Step into view and keep the camera clear.',
  zone: 'Move into your marked player area.',
  body: 'Keep your shoulders and hips visible.',
  arms: 'Keep both elbows and wrists inside the picture.',
  feet: 'Step back until both knees and ankles are visible.',
  head: 'Keep your head visible and face the camera.',
  distance: 'Move until your shoulders and hips fit clearly.',
  sideways: 'Face the camera more directly.',
  motion: 'Lower your right arm, then raise your right hand above your head.',
  slow: 'Tracking is too slow for a reliable check. Close other camera apps.',
}

interface PlayerSetup {
  count: number
  detected: boolean[]
  confirmed: boolean[]
  progress: number[]
  inZone: boolean[]
  rightHandRaised: boolean[]
}

interface PoseDiagnostic {
  raw: number
  eligible: number
  torso: (number | null)[]
  reason: LockReason | 'registering'
  gapMs: number
  recentRejection: LockReason | null
}
import type { TargetPose } from './VideoPanel'
import { recordSession } from '../playkitClient'

/** Practice accumulated against one phrase during a single session. */
export interface SectionPractice {
  seconds: number
  sumMatch: number
  samples: number
  bestMatch: number
}

interface Props {
  targetRef: React.MutableRefObject<TargetPose>
  playbackRef?: React.MutableRefObject<HTMLVideoElement | null>
  track?: PoseTrack | null
  /** Which dance is loaded, so practice is filed against it in the library. */
  videoId?: string
  videoName?: string
  /** Called when the camera stops, with what was practised per phrase. */
  onSectionPractice?: (deltas: Record<string, SectionPractice>) => void
  /** Which half of the body is being practised. */
  focus: Focus
  onFocusChange: (focus: Focus) => void
  showSkeletons: boolean
  trackHead?: boolean
  showPoseDebug?: boolean
  onPhotoFrameReady?: (capture: (() => HTMLCanvasElement | null) | null) => void
  gamePhase?: GamePhase
  gameRun?: number
  difficulty?: Difficulty
  onLobbyChange?: (ready: boolean, players: number) => void
  onGameScores?: (players: PlayerRound[]) => void
  onHit?: (grade: HitGrade, time: number, keys: string[]) => void
  onScoreDebug?: (entries: ScoreDebug[]) => void
  onSoloPresence?: (present: boolean, nowMs: number) => void
  requireCalibration?: boolean
  registrationPlayers?: 1 | 2
  onRegistrationPlayersChange?: (count: 1 | 2) => void
  registrationScreen?: boolean
  onCalibrationChange?: (state: CalibrationState | null) => void
  gestureContext?: GestureContext | null
  onGestureAction?: (gesture: MenuGesture) => void
  soundMuted?: boolean
  onRunningChange?: (running: boolean) => void
}

export interface ScoreDebug {
  player: number
  cue: 'move' | 'hold'
  movement: number | null
  match: number | null
  lag: number
  grade: HitGrade | 'unscored'
}

export default function WebcamPanel({
  targetRef,
  playbackRef,
  track,
  videoId,
  videoName,
  onSectionPractice,
  focus,
  onFocusChange,
  showSkeletons,
  trackHead = true,
  showPoseDebug = false,
  onPhotoFrameReady,
  gamePhase = 'lobby',
  gameRun = 0,
  difficulty = 'normal',
  onLobbyChange,
  onGameScores,
  onHit,
  onScoreDebug,
  onSoloPresence,
  requireCalibration = false,
  registrationPlayers = 1,
  onRegistrationPlayersChange,
  registrationScreen = false,
  onCalibrationChange,
  gestureContext = null,
  onGestureAction,
  soundMuted = false,
  onRunningChange,
}: Props) {
  const focusRef = useRef<Focus>('full')
  focusRef.current = focus
  const trackHeadRef = useRef(trackHead)
  trackHeadRef.current = trackHead
  const difficultyRef = useRef(difficulty)
  difficultyRef.current = difficulty
  const motionChart = useMemo(() => {
    const frames = track ? referenceMotionFrames(track) : []
    return { frames, intervals: buildMotionIntervals(frames, focus, trackHead) }
  }, [track, focus, trackHead])
  const motionChartRef = useRef(motionChart)
  motionChartRef.current = motionChart
  const playbackRefRef = useRef(playbackRef)
  playbackRefRef.current = playbackRef
  // Per-phrase totals for this session, plus the clock used to charge time to
  // whichever phrase was on screen.
  const sectionAccumRef = useRef<Record<string, SectionPractice>>({})
  const sectionClockRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const showPoseDebugRef = useRef(showPoseDebug)
  showPoseDebugRef.current = showPoseDebug
  useEffect(() => {
    if (!onPhotoFrameReady) return
    onPhotoFrameReady(() => {
      const video = videoRef.current
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null
      const frame = document.createElement('canvas')
      frame.width = video.videoWidth
      frame.height = video.videoHeight
      const context = frame.getContext('2d')
      if (!context) return null
      context.translate(frame.width, 0)
      context.scale(-1, 1)
      context.drawImage(video, 0, 0, frame.width, frame.height)
      return frame
    })
    return () => onPhotoFrameReady(null)
  }, [onPhotoFrameReady])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const appearanceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const emaRef = useRef<number | null>(null)
  const lagRef = useRef<number | null>(null)
  // The lag estimate persists between frames so it can settle.
  const lagStatesRef = useRef<LagState[]>([{ lag: 0 }, { lag: 0 }])
  const movementHistoryRef = useRef<{ t: number; value: CueFrame }[][]>([[], []])
  const motionHistoryRef = useRef<MotionFrame[][]>([[], []])
  const playbackEndedAtRef = useRef(0)
  const playerSmoothersRef = useRef([new LandmarkSmoother(), new LandmarkSmoother()])
  const playerWorldSmoothersRef = useRef([new LandmarkSmoother(), new LandmarkSmoother()])
  const registrationStateRef = useRef(initialRegistration(0))
  const lobbyReadyRef = useRef(false)
  const playerLockRef = useRef<PlayerLock | null>(null)
  const lastRejectionRef = useRef<{ reason: LockReason; at: number } | null>(null)
  const poseDiagnosticRef = useRef<PoseDiagnostic | null>(null)
  const registrationPlayersRef = useRef(registrationPlayers)
  registrationPlayersRef.current = registrationPlayers
  const registeredPlayerCountRef = useRef(1)
  const roundsRef = useRef<MotionRound[]>([newMotionRound(), newMotionRound()])
  const gestureHoldRef = useRef<GestureHold>({ ...EMPTY_GESTURE_HOLD })
  const pauseHoldRef = useRef<ReturnType<typeof advancePauseHold>['hold']>(null)
  const gestureContextRef = useRef(gestureContext)
  const onGestureActionRef = useRef(onGestureAction)
  const onSoloPresenceRef = useRef(onSoloPresence)
  onSoloPresenceRef.current = onSoloPresence
  const soundMutedRef = useRef(soundMuted)
  // Latest reading, so the guided check can sample without its own detector.
  const latestRef = useRef<{ feature: PoseFeature; framing: string[] } | null>(null)
  const lastUiRef = useRef(0)
  const lastInferenceAtRef = useRef(0)
  const calibrationRef = useRef<CalibrationState | null>(null)
  const requireCalibrationRef = useRef(requireCalibration)
  requireCalibrationRef.current = requireCalibration
  const mirrorModeRef = useRef<MirrorMode>('auto')

  // Aggregates for the practice session, so a signed-in dancer keeps a history
  // instead of a number that vanishes when the camera stops.
  const sessionRef = useRef({ startedAt: 0, sum: 0, count: 0, best: 0 })

  const [running, setRunning] = useState(false)
  useEffect(() => onRunningChange?.(running), [running, onRunningChange])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMode, setMirrorMode] = useState<MirrorMode>('auto')
  const [mirroredNow, setMirroredNow] = useState(true)
  const [score, setScore] = useState<number | null>(null)
  const [lag, setLag] = useState<number | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [framing, setFraming] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [capture, setCapture] = useState({ width: 0, height: 0 })
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null)
  const [calibration, setCalibration] = useState<CalibrationState | null>(null)
  const [trackingLost, setTrackingLost] = useState(false)
  const [poseDiagnostic, setPoseDiagnostic] = useState<PoseDiagnostic | null>(null)
  const [playerSetup, setPlayerSetup] = useState<PlayerSetup>({
    count: registrationPlayers,
    detected: [],
    confirmed: [],
    progress: [],
    inZone: [],
    rightHandRaised: [],
  })
  const [lobbyReady, setLobbyReady] = useState(false)
  const [gestureFeedback, setGestureFeedback] = useState<{ gesture: MenuGesture | null; beeps: number; latched: boolean }>({
    gesture: null,
    beeps: 0,
    latched: false,
  })
  const [pauseProgress, setPauseProgress] = useState(0)
  const livePlayerCountRef = useRef(0)

  mirrorModeRef.current = mirrorMode
  gestureContextRef.current = gestureContext
  onGestureActionRef.current = onGestureAction
  soundMutedRef.current = soundMuted
  const gameplaySkeletonsVisible = showSkeletons || calibration?.phase === 'framing' || calibration?.phase === 'movement'

  const beginCheck = () => {
    const count = playerLockRef.current?.slots.length ?? livePlayerCountRef.current
    if (!running || (count !== 1 && count !== 2)) return
    const next = beginCalibration(count, performance.now(), focusRef.current)
    calibrationRef.current = next
    gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'confirm', latched: true }
    setCalibration(next)
    onCalibrationChange?.(next)
  }

  const resetPlayers = useCallback(() => {
    playerLockRef.current = null
    lastRejectionRef.current = null
    poseDiagnosticRef.current = null
    registeredPlayerCountRef.current = 1
    registrationStateRef.current = initialRegistration(performance.now())
    registrationPlayersRef.current = 1
    lobbyReadyRef.current = false
    livePlayerCountRef.current = 0
    playerSmoothersRef.current.forEach((smoother) => smoother.reset())
    playerWorldSmoothersRef.current.forEach((smoother) => smoother.reset())
    gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
    pauseHoldRef.current = null
    setPauseProgress(0)
    latestRef.current = null
    emaRef.current = null
    lagRef.current = null
    setScore(null)
    setLag(null)
    calibrationRef.current = null
    setCalibration(null)
    setLobbyReady(false)
    setTrackingLost(false)
    setPlayerSetup({ count: 1, detected: [], confirmed: [], progress: [], inZone: [], rightHandRaised: [] })
    onRegistrationPlayersChange?.(1)
    onCalibrationChange?.(null)
    onLobbyChange?.(false, 0)
  }, [onCalibrationChange, onLobbyChange, onRegistrationPlayersChange])

  // A confirmed lock survives menus and rounds. Opening camera setup starts a fresh check.
  useEffect(() => {
    if (running && (registrationScreen || !lobbyReadyRef.current)) resetPlayers()
  }, [running, registrationScreen, resetPlayers])

  useEffect(() => {
    if (!gestureHoldRef.current.latched) {
      gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
    }
    setGestureFeedback({ gesture: null, beeps: 0, latched: false })
  }, [gestureContext])

  useEffect(() => {
    if (gamePhase !== 'countdown') return
    // The reference video may still expose the previous round's final time for
    // one camera frame while it is being rewound. Do not let that stale clock
    // consume the new round's targets as misses.
    registeredPlayerCountRef.current = playerLockRef.current?.slots.length ?? registrationPlayersRef.current
    const expected = motionChartRef.current.intervals.length
    roundsRef.current = [newMotionRound(expected), newMotionRound(expected)]
    playbackEndedAtRef.current = 0
    lagStatesRef.current = [{ lag: 0 }, { lag: 0 }]
    movementHistoryRef.current = [[], []]
    motionHistoryRef.current = [[], []]
    onGameScores?.(roundsRef.current.slice(0, registeredPlayerCountRef.current))
  }, [gamePhase, gameRun, onGameScores])

  // Asking every session is friction for something already agreed to, so if
  // the permission is on record the camera comes up by itself. Browsers that
  // do not answer the query simply keep the button.
  useEffect(() => {
    let cancelled = false
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === 'granted') void start()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      landmarkerRef.current?.close()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      landmarkerRef.current ??= await createPoseLandmarker(2, 'full')
      const stream = await requestCameraStream(navigator.mediaDevices, {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },
          facingMode: 'user',
        },
        audio: false,
      })
      streamRef.current = stream
      const settings = stream.getVideoTracks()[0]?.getSettings()
      setCapture({
        width: settings?.width ?? 0,
        height: settings?.height ?? 0,
      })
      const v = videoRef.current!
      v.srcObject = stream
      await v.play()
      sessionRef.current = { startedAt: performance.now(), sum: 0, count: 0, best: 0 }
      registrationStateRef.current = initialRegistration(performance.now())
      playerLockRef.current = null
      lastRejectionRef.current = null
      poseDiagnosticRef.current = null
      lobbyReadyRef.current = false
      gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
      setLobbyReady(false)
      setRunning(true)
    } catch (e) {
      console.error('webcam start failed', e)
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? T('Camera permission denied — allow it in your browser settings')
          : e instanceof CameraRequestTimeoutError
            ? T('Camera did not respond — check browser permission and try again')
          : T('Could not start the camera'),
      )
    } finally {
      setStarting(false)
    }
  }

  const stop = () => {
    // Save before tearing down, while the aggregates are still intact.
    const s = sessionRef.current
    const seconds = s.startedAt ? Math.round((performance.now() - s.startedAt) / 1000) : 0
    // Ignore accidental blips — a two-second session is not practice.
    if (s.count > 0 && seconds >= 10) {
      void recordSession({
        at: new Date().toISOString(),
        seconds,
        averageMatch: Math.round(s.sum / s.count),
        bestMatch: Math.round(s.best),
        videoId,
        videoName,
      })
    }
    sessionRef.current = { startedAt: 0, sum: 0, count: 0, best: 0 }

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    const perSection = sectionAccumRef.current
    if (Object.keys(perSection).length) onSectionPractice?.(perSection)
    sectionAccumRef.current = {}
    sectionClockRef.current = 0

    emaRef.current = null
    lagRef.current = null
    lagStatesRef.current = [{ lag: 0 }, { lag: 0 }]
    movementHistoryRef.current = [[], []]
    playerSmoothersRef.current.forEach((smoother) => smoother.reset())
    playerWorldSmoothersRef.current.forEach((smoother) => smoother.reset())
    registrationStateRef.current = initialRegistration(performance.now())
    lobbyReadyRef.current = false
    gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD }
    setRunning(false)
    setLobbyReady(false)
    setPlayerSetup({ count: 1, detected: [], confirmed: [], progress: [], inZone: [], rightHandRaised: [] })
    playerLockRef.current = null
    lastRejectionRef.current = null
    poseDiagnosticRef.current = null
    setPoseDiagnostic(null)
    livePlayerCountRef.current = 0
    setTrackingLost(false)
    onLobbyChange?.(false, 0)
    setScore(null)
    setLag(null)
    setProblems([])
    setMetrics(null)
    calibrationRef.current = null
    setCalibration(null)
    onCalibrationChange?.(null)
    const cv = canvasRef.current
    cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
  }

  useEffect(() => {
    if (!running) return
    lastInferenceAtRef.current = 0
    let handle = 0
    let fallbackFrames = 0
    let lastMetricsAt = performance.now()
    const meter = new FrameMeter()

    const loop = (frameNow: number, metadata?: VideoFrameCallbackMetadata) => {
      const v = videoRef.current
      if (v) {
        if ('requestVideoFrameCallback' in v) handle = v.requestVideoFrameCallback(loop)
        else handle = requestAnimationFrame((time) => loop(time))
      }
      const cv = canvasRef.current
      const lmk = landmarkerRef.current
      if (!v || !cv || !lmk || v.readyState < 2 || v.videoWidth === 0) return
      if (frameNow - lastInferenceAtRef.current < LIVE_INFERENCE_INTERVAL_MS) return
      lastInferenceAtRef.current = frameNow

      const presentedFrames = metadata?.presentedFrames ?? ++fallbackFrames
      meter.record(presentedFrames, frameNow)
      const timestampMs = frameTimestampMs(metadata?.mediaTime ?? Number.NaN, frameNow)
      const input = (inferenceCanvasRef.current ??= document.createElement('canvas'))
      const playbackVideo = playbackRefRef.current?.current
      const scoringClock = advanceScoringClock(
        playbackVideo?.currentTime ?? targetRef.current.time,
        playbackVideo?.ended ?? false,
        frameNow,
        playbackEndedAtRef.current,
      )
      playbackEndedAtRef.current = scoringClock.endedAt
      const playbackTime = scoringClock.time
      const inputHeight = Math.round(LIVE_INPUT_WIDTH * v.videoHeight / v.videoWidth)
      if (input.width !== LIVE_INPUT_WIDTH || input.height !== inputHeight) {
        input.width = LIVE_INPUT_WIDTH
        input.height = inputHeight
      }
      input.getContext('2d')!.drawImage(v, 0, 0, input.width, input.height)
      const inferenceStarted = performance.now()
      const res = lmk.detectForVideo(input, timestampMs)
      meter.recordInference(performance.now() - inferenceStarted)
      if (cv.width !== v.videoWidth || cv.height !== v.videoHeight) {
        cv.width = v.videoWidth
        cv.height = v.videoHeight
      }
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, cv.width, cv.height)

      const detected = res.landmarks
        .map((pose, index) => ({ pose, world: res.worldLandmarks[index], x: playerScreenX(pose) }))
        .filter((player) => player.x !== null)
        .map((player) => ({ ...player, x: player.x!, appearance: sampleTorsoColor(
          input, appearanceCanvasRef.current ??= document.createElement('canvas'), player.pose,
        ) }))
      const lock = playerLockRef.current
      let registrationIndices: (number | null)[] = []
      if (!lock) {
        const poses = detected.map((player) => player.pose)
        const solo = registrationCandidates(poses, 1)
        const pair = registrationCandidates(poses, 2)
        const observed = pair.every((index) => index !== null) ? 2 : solo[0] !== null ? 1 : 0
        const next = selectRegistrationCount(registrationStateRef.current, observed, frameNow)
        if (next.count !== registrationStateRef.current.count) {
          registrationPlayersRef.current = next.count
          playerSmoothersRef.current.forEach((smoother) => smoother.reset())
          playerWorldSmoothersRef.current.forEach((smoother) => smoother.reset())
          onRegistrationPlayersChange?.(next.count)
        }
        registrationStateRef.current = next
        registrationIndices = next.count === 2 ? pair : solo
      }
      const soloReady = registrationPlayersRef.current === 1 && lobbyReadyRef.current
      const soloIndex = soloReady ? primarySoloCandidate(detected.map((player) => player.pose)) : null
      const match = lock && !soloReady ? matchPlayerLock(lock, detected.map((player) => player.pose), frameNow, detected.map((player) => player.appearance)) : null
      if (showPoseDebugRef.current && registrationPlayersRef.current === 1) {
        const reason = soloReady ? (soloIndex === null ? 'no pose' : 'matched') : match?.reasons[0] ?? 'registering'
        if (reason !== 'matched' && reason !== 'registering') lastRejectionRef.current = { reason, at: frameNow }
        const matchedIndex = soloReady ? soloIndex : match?.indices[0]
        const rawPose = matchedIndex === null || matchedIndex === undefined
          ? res.landmarks[0] : detected[matchedIndex]?.pose
        poseDiagnosticRef.current = {
          raw: res.landmarks.length,
          eligible: detected.length,
          torso: [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip]
            .map((index) => {
              const visibility = rawPose?.[index]?.visibility
              return visibility === undefined ? null : Math.round(visibility * 100)
            }),
          reason,
          gapMs: soloReady ? 0 : lock ? Math.round(frameNow - (match?.state.slots[0].lastSeenAt ?? lock.slots[0].lastSeenAt)) : 0,
          recentRejection: lastRejectionRef.current && frameNow - lastRejectionRef.current.at < 4000
            ? lastRejectionRef.current.reason : null,
        }
      }
      if (lock && match && match.indices[0] !== null && frameNow - lock.slots[0].lastSeenAt > 750) {
        gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'confirm', since: frameNow, latched: true }
      }
      if (match) playerLockRef.current = match.state
      const indices = soloReady ? [soloIndex] : match?.indices ?? registrationIndices
      const matched = indices.map((index) => index === null ? null : detected[index])
      const count = matched.filter(Boolean).length
      livePlayerCountRef.current = count
      const registeredPlayerCount = registeredPlayerCountRef.current
      const players = matched.map((player, slot) => player ? {
          ...player,
          pose: playerSmoothersRef.current[slot].filter(player.pose, timestampMs / 1000),
          world: player.world
            ? playerWorldSmoothersRef.current[slot].filter(player.world, timestampMs / 1000)
            : undefined,
        } : null)
      const setup: PlayerSetup = { count: registrationPlayersRef.current, detected: [], confirmed: [], progress: [], inZone: [], rightHandRaised: [] }
      const poses = players.map((player, index) => {
        const pose = player?.pose
        const inZone = !!player && inPlayerZone(player.x, index, registrationPlayersRef.current)
        const rightHandRaised = !!pose && isRightHandRaised(pose)
        setup.detected.push(!!pose)
        setup.inZone.push(inZone)
        setup.rightHandRaised.push(rightHandRaised)
        return pose ?? null
      })

      if (!lobbyReadyRef.current) {
        const result = advanceRegistration(registrationStateRef.current, setup.detected.map((present, index) => ({
          present, inZone: setup.inZone[index], raised: setup.rightHandRaised[index],
        })), frameNow)
        registrationStateRef.current = result.state
        setup.confirmed = result.state.slots.slice(0, result.state.count).map((slot) => slot.confirmed)
        setup.progress = result.progress
        if (result.ready && count === registrationPlayersRef.current) {
          playerLockRef.current = createPlayerLock(matched.map((player) => player!.pose), frameNow,
            matched.map((player) => player!.appearance))
          gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'confirm', since: frameNow, latched: true }
          registeredPlayerCountRef.current = registrationPlayersRef.current
          lobbyReadyRef.current = true
          setLobbyReady(true)
        }
      }

      if (lobbyReadyRef.current && requireCalibrationRef.current && calibrationRef.current?.focus !== focusRef.current) {
        const next = beginCalibration(registrationPlayersRef.current, frameNow, focusRef.current)
        calibrationRef.current = next
        setCalibration(next)
        onCalibrationChange?.(next)
      }
      const activeCheck = calibrationRef.current
      if (activeCheck && (activeCheck.phase === 'framing' || activeCheck.phase === 'movement')) {
        const checkPoses = matched.map((player) => player?.pose ?? null)
        const next = advanceCalibration(activeCheck, checkPoses, frameNow, trackHeadRef.current)
        calibrationRef.current = next
        if (next.phase !== activeCheck.phase) {
          setCalibration(next)
          onCalibrationChange?.(next)
        }
      }

      const pose = poses[0]
      const world = players[0]?.world
      const pauseReading = advancePauseHold(pauseHoldRef.current,
        gamePhase === 'playing' && lobbyReadyRef.current && isCrossedArms(pose),
        pose ? playerScreenX(pose) : null, frameNow)
      pauseHoldRef.current = pauseReading.hold
      if (pauseReading.fired) {
        gestureHoldRef.current = { ...EMPTY_GESTURE_HOLD, candidate: 'back', latched: true }
        onGestureActionRef.current?.('back')
      }
      let gestureReading = {
        ...gestureHoldRef.current,
        progress: gestureHoldRef.current.latched ? 1 : 0,
        beep: null as 1 | 2 | 3 | null,
        fired: null as MenuGesture | null,
      }
      if (lobbyReadyRef.current && gestureContextRef.current && calibrationRef.current?.phase !== 'framing' && calibrationRef.current?.phase !== 'movement') {
        gestureReading = advanceGestureFromPose(gestureHoldRef.current, pose ?? undefined, frameNow)
        gestureHoldRef.current = gestureReading
        if (gestureReading.beep) playSfx(
          gestureReading.beep === 1 ? 'gestureOne' : gestureReading.beep === 2 ? 'gestureTwo' : 'gestureThree',
          soundMutedRef.current,
        )
        if (gestureReading.fired) onGestureActionRef.current?.(gestureReading.fired)
      }
      const target = targetRef.current
      let frameScore: number | null = null
      const playerFrames: (CueFrame | null)[] = Array.from({ length: registeredPlayerCount }, () => null)
      let frameProblems: string[] = []
      let frameLag: number | null = null
      if (pose && world && lobbyReadyRef.current) {
        const user = computeAngles(world)
        const framingNow = framingProblems(pose, focusRef.current)
        latestRef.current = { feature: user, framing: framingNow }
        // You always face your own camera, so mirroring is only right when the
        // reference dancer faces theirs.
        const mirrored =
          mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
        const cmp = compareToHistory(
          user,
          target.history,
          target.time,
          mirrored,
          lagStatesRef.current[0],
          focusRef.current,
          trackHeadRef.current,
        )
        drawSkeleton(ctx, pose, cv.width, cv.height, {
          color: LEVEL_COLORS.na,
          lineWidth: 7,
          connectionColors: target.feature ? levelConnectionColors(cmp.levels, LEVEL_COLORS) : undefined,
          headColor: target.feature ? LEVEL_COLORS[cmp.levels[HEAD] ?? 'na'] : undefined,
          dimmed: dimmedSegments(focusRef.current),
        })
        frameScore = cmp.score
        playerFrames[0] = { feature: user, landmarks: pose }
        frameProblems = cmp.problems
        frameLag = cmp.lag
      }
      if (lobbyReadyRef.current && poses[1] && players[1]?.world) {
        const second = computeAngles(players[1].world)
        const mirrored =
          mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
        const cmp = compareToHistory(
          second,
          target.history,
          target.time,
          mirrored,
          lagStatesRef.current[1],
          focusRef.current,
          trackHeadRef.current,
        )
        playerFrames[1] = { feature: second, landmarks: poses[1] }
        drawSkeleton(ctx, poses[1], cv.width, cv.height, {
          color: LEVEL_COLORS.na,
          lineWidth: 7,
          connectionColors: target.feature ? levelConnectionColors(cmp.levels, LEVEL_COLORS) : undefined,
          headColor: target.feature ? LEVEL_COLORS[cmp.levels[HEAD] ?? 'na'] : undefined,
          dimmed: dimmedSegments(focusRef.current),
        })
      }

      if (lobbyReadyRef.current && registrationPlayersRef.current === 1) {
        onSoloPresenceRef.current?.(playerFrames[0] !== null, frameNow)
      }

      if (gamePhase === 'playing' && isGameRunReady(target.gameRun, gameRun) && motionChartRef.current.intervals.length) {
        const cameraTime = frameNow / 1000
        for (let index = 0; index < registeredPlayerCount; index++) {
          const frame = playerFrames[index]
          if (!frame) continue
          const history = movementHistoryRef.current[index]
          history.push({ t: cameraTime, value: frame })
          while (history.length > 1 && history[0].t < cameraTime - 2.2) history.shift()
          const motionHistory = motionHistoryRef.current[index]
          motionHistory.push(liveMotionFrame(playbackTime, frame.feature, frame.landmarks))
          while (motionHistory.length > 1 && motionHistory[0].t < playbackTime - 2.5) motionHistory.shift()
        }
        let changed = false
        let hitGrade: HitGrade | null = null
        let hitTime = 0
        let hitKeys: string[] = []
        const scoreDebug: ScoreDebug[] = []
        for (let index = 0; index < registeredPlayerCount; index++) {
          let before = roundsRef.current[index]
          const mirrored = mirrorModeRef.current === 'auto'
            ? target.facing !== 'back'
            : mirrorModeRef.current === 'mirror'
          const { frames, intervals } = motionChartRef.current
          while (before.nextTarget < intervals.length) {
            const interval = intervals[before.nextTarget]
            if (playbackTime < interval.end + motionLagLimit(difficultyRef.current) + 0.02) break
            const reading = evaluateMotionInterval(
              interval, frames, motionHistoryRef.current[index], difficultyRef.current, before.lag, mirrored,
              before.judged > 0,
            )
            const after = advanceMotionRound(before, reading, interval.kind)
            scoreDebug.push({
              player: index + 1,
              cue: interval.kind,
              movement: null,
              match: reading.quality === null ? null : Math.round(reading.quality * 100),
              lag: reading.lag,
              grade: reading.quality === null ? 'unscored' : after.lastGrade ?? 'miss',
            })
            if (after.perfect > before.perfect) {
              hitGrade = 'perfect'
              hitTime = playbackTime
              hitKeys = interval.keys
            } else if (after.good > before.good && hitGrade !== 'perfect') {
              hitGrade = 'good'
              hitTime = playbackTime
              hitKeys = interval.keys
            } else if (after.miss > before.miss && hitGrade === null) {
              hitGrade = 'miss'
              hitTime = playbackTime
              hitKeys = interval.keys
            }
            before = after
            changed = true
          }
          roundsRef.current[index] = before
        }
        if (hitGrade) onHit?.(hitGrade, hitTime, hitKeys)
        if (scoreDebug.length) onScoreDebug?.(scoreDebug)
        if (changed) onGameScores?.(roundsRef.current.slice(0, registeredPlayerCount))
      }
      if (!lobbyReadyRef.current) {
        for (const playerPose of poses) {
          if (!playerPose) continue
          drawSkeleton(ctx, playerPose, cv.width, cv.height, {
            color: LEVEL_COLORS.na,
            lineWidth: 7,
          })
        }
      }

      // Charge elapsed time to the phrase that was playing, but only while a
      // score exists — standing off-camera between takes is not practice.
      const clockNow = performance.now()
      const elapsed = sectionClockRef.current ? (clockNow - sectionClockRef.current) / 1000 : 0
      sectionClockRef.current = clockNow
      const sid = target.sectionId
      if (sid && frameScore !== null && elapsed > 0 && elapsed < 1) {
        const acc = (sectionAccumRef.current[sid] ??= {
          seconds: 0,
          sumMatch: 0,
          samples: 0,
          bestMatch: 0,
        })
        acc.seconds += elapsed
        acc.sumMatch += frameScore
        acc.samples++
        if (frameScore > acc.bestMatch) acc.bestMatch = frameScore
      }

      if (frameScore !== null) {
        emaRef.current = emaRef.current === null ? frameScore : emaRef.current * 0.85 + frameScore * 0.15
        // Accumulate on the smoothed value: a single noisy frame shouldn't
        // become someone's "best match".
        const s = sessionRef.current
        s.sum += emaRef.current
        s.count++
        if (emaRef.current > s.best) s.best = emaRef.current
      } else {
        emaRef.current = null
      }
      // Lag is smoothed hard: it is a tendency worth naming, not a per-frame
      // number, and a twitchy readout would be unusable mid-dance.
      if (frameLag !== null) {
        lagRef.current = lagRef.current === null ? frameLag : lagRef.current * 0.9 + frameLag * 0.1
      }

      const now = performance.now()
      if (now - lastUiRef.current > 200) {
        lastUiRef.current = now
        if (showPoseDebugRef.current && registrationPlayersRef.current === 1) setPoseDiagnostic(poseDiagnosticRef.current)
        setScore(emaRef.current === null ? null : Math.round(emaRef.current))
        setProblems(frameProblems)
        setLag(lagRef.current)
        setFraming(latestRef.current?.framing ?? [])
        setMirroredNow(
          mirrorModeRef.current === 'auto'
            ? targetRef.current.facing !== 'back'
            : mirrorModeRef.current === 'mirror',
        )
        if (gamePhase === 'lobby') setPlayerSetup(setup)
        setTrackingLost(registrationPlayersRef.current === 2 && !!playerLockRef.current?.slots.some((slot) => frameNow - slot.lastSeenAt > 750))
        if (calibrationRef.current?.phase === 'framing' || calibrationRef.current?.phase === 'movement') {
          setCalibration(calibrationRef.current)
        }
        onLobbyChange?.(lobbyReadyRef.current, count)
        setGestureFeedback({ gesture: gestureReading.candidate, beeps: gestureReading.beeps, latched: gestureReading.latched })
        setPauseProgress(pauseReading.progress)
      }
      if (frameNow - lastMetricsAt >= 1000) {
        lastMetricsAt = frameNow
        setMetrics(meter.snapshot(frameNow))
      }
    }
    const v = videoRef.current
    if (v && 'requestVideoFrameCallback' in v) handle = v.requestVideoFrameCallback(loop)
    else handle = requestAnimationFrame((time) => loop(time))
    return () => {
      if (v && 'cancelVideoFrameCallback' in v) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
  }, [running, targetRef, gamePhase, gameRun, onGameScores, onHit, onLobbyChange, onScoreDebug, onCalibrationChange, onRegistrationPlayersChange])

  const calibrationGuide = running && gamePhase === 'lobby' && lobbyReady && calibration && !checking && (
    <div className="calibration-card" role="status" aria-live="polite">
      <strong>{calibration.phase === 'framing' && calibration.focus === 'upper'
        ? L('Checking arm tracking', '正在检查手臂追踪')
        : T(calibration.phase === 'framing' ? 'Checking full-body tracking' : calibration.phase === 'movement' ? 'Checking movement tracking' : calibration.phase === 'passed' ? 'Tracking check passed' : 'Tracking needs attention')}</strong>
      <p>{calibration.phase === 'framing' && calibration.focus === 'upper'
        ? L('Keep your shoulders, hips, elbows and wrists in view. Legs can stay out of frame.', '保持肩部、髋部、肘部和手腕在画面内。双腿可以不在画面内。')
        : T(calibration.phase === 'framing' ? 'Stand in your area with your whole body visible.' : calibration.phase === 'movement' ? 'Lower your right arm, then raise your right hand above your head.' : calibration.phase === 'passed' ? 'Your pose stayed visible and your right arm movement was detected.' : 'Adjust your camera setup and try again. You can still play with reduced tracking quality.')}</p>
      {(calibration.phase === 'passed' || calibration.phase === 'failed') && (
        <ul>
          {calibration.players.map((player, index) => (
            <li key={index}>
              <b>{L(`Player ${index + 1}`, `玩家 ${index + 1}`)}</b>
              <span>{player.reason ? T(CALIBRATION_ADVICE[player.reason]) : calibration.focus === 'upper'
                ? L(`${Math.round(player.goodFrames / Math.max(1, player.frames) * 100)}% arm visibility`, `手臂可见率 ${Math.round(player.goodFrames / Math.max(1, player.frames) * 100)}%`)
                : L(`${Math.round(player.goodFrames / Math.max(1, player.frames) * 100)}% full-body visibility`, `全身可见率 ${Math.round(player.goodFrames / Math.max(1, player.frames) * 100)}%`)}</span>
            </li>
          ))}
        </ul>
      )}
      {(calibration.phase === 'passed' || calibration.phase === 'failed') && <button className="btn subtle" onClick={beginCheck}>{T('Check again')}</button>}
    </div>
  )

  const activeGesture = gestureFeedback.gesture
  const showGestureCue = running && lobbyReady && gestureContext && activeGesture && gestureFeedback.beeps > 0 &&
    !checking && calibration?.phase !== 'framing' && calibration?.phase !== 'movement'
  const gesturePose = activeGesture === 'confirm' ? L('RIGHT HAND UP', '举起右手')
    : activeGesture === 'back' ? L('BACK GESTURE', '返回手势')
      : activeGesture === 'previous' ? L('LEFT ARM OUT', '左臂平伸') : L('RIGHT ARM OUT', '右臂平伸')

  return (
    <>
    <section className="panel">
      <div className="panel-head">
        <h2>{T('You')}</h2>
        <span className="hint">
          {!running
            ? T('Turn on your camera to follow along')
            : lobbyReady
              ? L(`${playerSetup.count || 1} player${playerSetup.count === 1 ? '' : 's'} ready`, `${playerSetup.count || 1} 位玩家已准备`)
              : T('Player check')}
        </span>
      </div>

      <div className="stage mirrored webcam-stage">
        <video ref={videoRef} playsInline muted aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className={gameplaySkeletonsVisible ? undefined : 'skeleton-hidden'}
          aria-hidden={!gameplaySkeletonsVisible}
        />
        {running && !lobbyReady && (
          <div className={`player-lobby ${playerSetup.count === 1 ? 'solo' : ''}`} aria-live="polite">
            {(playerSetup.count === 1 ? [0] : [0, 1]).map((index) => {
              const detected = playerSetup.detected[index] ?? false
              const progress = playerSetup.progress[index] ?? 0
              const confirmed = playerSetup.confirmed[index] ?? false
              const instruction = !detected
                ? T('Step into this area')
                : !playerSetup.inZone[index]
                  ? T('Move inside the area')
                  : confirmed
                    ? L('Confirmed', '已确认')
                  : !playerSetup.rightHandRaised[index]
                    ? T('Right hand up · left hand down')
                    : `${Math.round(progress * 100)}%`
              return (
                <div key={index} className={`player-zone ${confirmed && playerSetup.inZone[index] ? 'ready' : ''}`}>
                  <strong>{playerSetup.count === 1 ? T('PLAYER') : `${T('PLAYER')} ${index + 1}`}</strong>
                  <span>{instruction}</span>
                  <i style={{ transform: `scaleX(${progress})` }} />
                </div>
              )
            })}
          </div>
        )}
        {!running && (
          <div className="stage-overlay">
            <button className="btn primary" onClick={start} disabled={starting}>
              {T(starting ? 'Starting…' : 'Turn on camera')}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {running && lobbyReady && framing.length > 0 && !checking && !requireCalibration && (
          <div className="framing-warning">
            {framing.map((f) => (
              <p key={f}>{T(f)}</p>
            ))}
          </div>
        )}
        {!requireCalibration && calibrationGuide}
        {running && lobbyReady && trackingLost && !requireCalibration && (
          <div className="tracking-lock-warning" role="status">
            {T('Tracking lost — return to your area and hold your right hand up to relock.')}
          </div>
        )}
        {import.meta.env.DEV && running && checking && (
          <div className="stage-overlay checkup-overlay">
            <Checkup read={() => latestRef.current} onClose={() => setChecking(false)} />
          </div>
        )}
        {running && lobbyReady && !checking && !requireCalibration && (
          <div className="score-badge">
            <span className="score-num">{score ?? '—'}</span>
            <span className="score-label">{T('match')}</span>
            {lag !== null && (
              <span className="score-lag">
                {lag < 0.15 ? T('in time') : L(`${lag.toFixed(1)}s behind`, `慢 ${lag.toFixed(1)} 秒`)}
              </span>
            )}
          </div>
        )}
        {gamePhase === 'playing' && pauseProgress > 0 && <div className="pause-gesture-progress" role="status">{T('Hold crossed arms to pause')} <i style={{ transform: `scaleX(${pauseProgress})` }} /></div>}
        {running && metrics && !requireCalibration && (
          <div className="tracking-diagnostics">
            {capture.width}×{capture.height} · camera {metrics.cameraFps} fps · tracking{' '}
            {metrics.trackingFps} fps
            {metrics.droppedFrames > 0 ? ` · skipped ${metrics.droppedFrames}` : ''}
          </div>
        )}
      </div>

      {requireCalibration && calibrationGuide}

      <div className="controls">
        <div className="ctrl-group">
          {running && (
            <button className="btn" onClick={stop}>
              {T('Stop camera')}
            </button>
          )}
          {running && gamePhase === 'lobby' && lobbyReady && (
            <button className="btn" onClick={resetPlayers}>{T('Register players again')}</button>
          )}
          {running && gamePhase === 'lobby' && lobbyReady && !requireCalibration && (calibration?.phase !== 'framing' && calibration?.phase !== 'movement') && (
            <button className="btn" onClick={beginCheck}>{T('Check tracking')}</button>
          )}
          {!requireCalibration && <span className="ctrl-label">{T('Practise')}</span>}
          {!requireCalibration && (
            [
              ['full', T('Whole body'), T('Score everything')],
              ['upper', T('Arms only'), T('Only arms and head are scored — your legs need not be in frame')],
              ['lower', T('Legs only'), T('Only legs are scored — stand back so your feet are visible')],
            ] as const
          ).map(([mode, label, tip]) => (
            <button
              key={mode}
              className={`btn ${focus === mode ? 'active' : ''}`}
              onClick={() => onFocusChange(mode)}
              title={tip}
            >
              {label}
            </button>
          ))}
          {import.meta.env.DEV && running && !checking && !requireCalibration && (
            <button className="btn subtle" onClick={() => setChecking(true)} title={T('Try a few moves to check scoring')}>
              {T('Check accuracy')}
            </button>
          )}
          {/* Auto is right almost always, so this is one button that reports
              what it decided rather than three that ask you to decide. */}
          {!requireCalibration && <button
            className={`btn subtle ${mirrorMode === 'auto' ? '' : 'active'}`}
            onClick={() =>
              setMirrorMode(
                mirrorMode === 'auto' ? 'mirror' : mirrorMode === 'mirror' ? 'direct' : 'auto',
              )
            }
            title={T('Choose whether your moves mirror the dancer. Auto follows their direction.')}
          >
            {mirrorMode === 'auto'
              ? `${T('Sides: auto')} · ${mirroredNow ? T('mirrored') : T('same side')}`
              : mirrorMode === 'mirror'
                ? T('Sides: mirrored')
                : T('Sides: same side')}
          </button>}
        </div>
        {!requireCalibration && <div className="ctrl-group problems" aria-live="polite">
          <span className="hint watch-message" title={problems.join('、')}>
            {running && problems.length > 0 ? (
              <>{T('Watch')}: <b>{problems.join('、')}</b></>
            ) : '\u00a0'}
          </span>
        </div>}
      </div>
    </section>
    {showPoseDebug && running && registrationPlayers === 1 && poseDiagnostic && createPortal(
      <div className={`pose-debug${poseDiagnostic.reason === 'matched' ? ' is-matched' : ''}`} aria-label="Pose tracking diagnostics">
        <strong>POSE DEBUG · FULL · {LIVE_INPUT_WIDTH}px</strong>
        <span>Raw {poseDiagnostic.raw} · eligible {poseDiagnostic.eligible}</span>
        <span>Torso visibility % · shoulders {poseDiagnostic.torso[0] ?? '—'}/{poseDiagnostic.torso[1] ?? '—'} · hips {poseDiagnostic.torso[2] ?? '—'}/{poseDiagnostic.torso[3] ?? '—'}</span>
        <span>Selection: {poseDiagnostic.reason} · gap {poseDiagnostic.gapMs}ms</span>
        {metrics && <span>Camera {metrics.cameraFps} fps · tracking {metrics.trackingFps} fps · inference p95 {metrics.inferenceP95Ms}ms</span>}
        {poseDiagnostic.recentRejection && <span>Recent rejection: {poseDiagnostic.recentRejection}</span>}
      </div>,
      document.body,
    )}
    {showGestureCue && createPortal(
      <div className={`gesture-cue gesture-cue-${activeGesture}`}>
        <div className="gesture-cue-heading">
          <span className="gesture-cue-symbol" aria-hidden="true">{activeGesture === 'previous' ? '←' : activeGesture === 'next' ? '→' : activeGesture === 'back' ? '×' : '↑'}</span>
          <div><span className="gesture-cue-pose">{gesturePose}</span><strong aria-live="polite">{T(gestureLabel(activeGesture, gestureContext))}</strong></div>
          <b className="gesture-cue-count" aria-hidden="true">{gestureFeedback.beeps}<small>/ 3</small></b>
        </div>
        <div className="gesture-cue-steps" role="progressbar" aria-label={L('Gesture confirmation', '手势确认进度')} aria-valuemin={0} aria-valuemax={3} aria-valuenow={gestureFeedback.beeps}>{[1, 2, 3].map((step) => <i key={step} className={step <= gestureFeedback.beeps ? 'is-lit' : ''} />)}</div>
        <p>{gestureFeedback.latched
          ? activeGesture === 'previous' || activeGesture === 'next'
            ? L('Keep holding to browse · lower to stop', '保持姿势继续浏览 · 放下即停止')
            : L('Lower your hand to choose again', '放下手后可再次选择')
          : L('Hold steady for three beats', '保持姿势，等待三声提示')}</p>
      </div>, document.body,
    )}
    </>
  )
}
