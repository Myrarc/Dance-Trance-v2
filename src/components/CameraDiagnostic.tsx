import { useEffect, useRef, useState } from 'react'
import type { CueLandmark } from '../pose/gameplay'
import { accuracy } from '../pose/gameplay'
import { DIAGNOSTIC_DURATION, DIAGNOSTIC_STEPS, diagnosticCoverage, scoreDiagnostic, type DiagnosticResult } from '../pose/cameraDiagnostic'
import { liveMotionFrame, type MotionFrame } from '../pose/motionScore'
import type { PoseFeature } from '../pose/angles'
import { framingProblems } from '../pose/checkup'

export interface DiagnosticReading {
  at: number
  feature: PoseFeature
  landmarks: CueLandmark[]
  framing: string[]
}

interface Props {
  read: () => (DiagnosticReading | null)[]
  playerCount: number
  capture: { width: number; height: number }
  onClose: () => void
}

const COUNTDOWN_MS = 3000

function targetPoint(reading: DiagnosticReading | null, step: string): { x: number; y: number }[] {
  const landmarks = reading?.landmarks
  if (!landmarks) return []
  const left = landmarks[11]
  const right = landmarks[12]
  const hip = landmarks[24]
  const ankle = landmarks[28]
  if (!left || !right || !hip) return []
  const width = Math.max(0.1, Math.abs(left.x - right.x))
  const height = Math.max(0.15, hip.y - right.y)
  if (step === 'right-arm') return [{ x: right.x, y: right.y - height * 0.95 }]
  if (step === 'both-arms') return [
    { x: left.x - width * 0.95, y: left.y },
    { x: right.x + width * 0.95, y: right.y },
  ]
  return ankle ? [{ x: hip.x + width * 0.95, y: ankle.y }] : []
}

function markerPosition(point: { x: number; y: number }, capture: Props['capture'], stage: HTMLElement | null) {
  if (!stage || !capture.width || !capture.height) return { left: `${(1 - point.x) * 100}%`, top: `${point.y * 100}%` }
  const { width, height } = stage.getBoundingClientRect()
  const scale = Math.min(width / capture.width, height / capture.height)
  const videoWidth = capture.width * scale
  const videoHeight = capture.height * scale
  return {
    left: `${((width - videoWidth) / 2 + (1 - point.x) * videoWidth) / width * 100}%`,
    top: `${((height - videoHeight) / 2 + point.y * videoHeight) / height * 100}%`,
  }
}

export default function CameraDiagnostic({ read, playerCount, capture, onClose }: Props) {
  const readRef = useRef(read)
  readRef.current = read
  const [elapsed, setElapsed] = useState(-COUNTDOWN_MS / 1000)
  const [readings, setReadings] = useState<(DiagnosticReading | null)[]>([])
  const [results, setResults] = useState<DiagnosticResult[] | null>(null)
  const [feedback, setFeedback] = useState<{ step: number; quality: (number | null)[] } | null>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  const startRef = useRef(performance.now() + COUNTDOWN_MS)
  const framesRef = useRef<MotionFrame[][]>(Array.from({ length: playerCount }, () => []))
  const lastAtRef = useRef<number[]>(Array.from({ length: playerCount }, () => -1))
  const nextFeedbackRef = useRef(0)
  const framingRef = useRef(new Set<string>())

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      const time = (now - startRef.current) / 1000
      const current = readRef.current()
      setReadings(current)
      setElapsed(time)
      if (time >= 0 && time <= DIAGNOSTIC_DURATION + 0.5) {
        for (let player = 0; player < playerCount; player++) {
          const reading = current[player]
          if (!reading || reading.at <= lastAtRef.current[player] || reading.at < startRef.current) continue
          lastAtRef.current[player] = reading.at
          framesRef.current[player].push(liveMotionFrame((reading.at - startRef.current) / 1000, reading.feature, reading.landmarks))
          framingProblems(reading.landmarks, 'full').forEach((warning) => framingRef.current.add(warning))
        }
      }
      const due = DIAGNOSTIC_STEPS[nextFeedbackRef.current]
      if (due && time >= due.end + 0.5) {
        const step = nextFeedbackRef.current++
        setFeedback({ step, quality: scoreDiagnostic(framesRef.current).map((result) => result.steps[step].quality) })
      }
      if (time >= DIAGNOSTIC_DURATION + 0.5) {
        setResults(scoreDiagnostic(framesRef.current))
        window.clearInterval(timer)
      }
    }, 50)
    stageRef.current = document.querySelector('.camera-tracking .webcam-stage')
    return () => window.clearInterval(timer)
  }, [playerCount])

  const active = DIAGNOSTIC_STEPS.find((step) => elapsed >= step.start - 0.7 && elapsed < step.end + 0.5)
  const next = DIAGNOSTIC_STEPS.find((step) => elapsed < step.start)

  if (results) return (
    <div className="diagnostic-results" role="status">
      <h3>Camera diagnostics</h3>
      {results.map((result, index) => (
        <div className="diagnostic-player-result" key={index}>
          <strong>Player {index + 1} · {accuracy(result.round)}% movement match</strong>
          <span>Tracking coverage {diagnosticCoverage(result)}%</span>
          {result.steps.map((step, stepIndex) => <span key={step.id}>
            {DIAGNOSTIC_STEPS[stepIndex].label}: {step.quality === null ? 'Not tracked' : `${Math.round(step.quality * 100)}%`}
            {step.quality !== null && Math.abs(step.lag) >= 0.15 ? ` · ${step.lag > 0 ? 'late' : 'early'} ${Math.abs(step.lag).toFixed(2)}s` : ''}
          </span>)}
          {diagnosticCoverage(result) < 70 && <em>Move fully into view, then try again. Missing tracking is not counted as a miss.</em>}
          {diagnosticCoverage(result) >= 70 && accuracy(result.round) < 45 && <em>Tracking is clear. Try a fuller movement along each marker path.</em>}
        </div>
      ))}
      {framingRef.current.size > 0 && <p>{[...framingRef.current].join(' · ')}</p>}
      <button className="btn primary" onClick={onClose}>Done</button>
    </div>
  )

  return <div className="diagnostic-hud" role="status">
    <div className="diagnostic-instruction">
      <span>{elapsed < 0 ? `Starting in ${Math.ceil(-elapsed)}` : active ? 'Follow the marker' : 'Get ready'}</span>
      <strong>{elapsed < 0 ? 'Stand ready, arms down' : active?.label ?? next?.label ?? 'Finish strong'}</strong>
      <small>{Math.max(0, Math.min(100, Math.round(elapsed / DIAGNOSTIC_DURATION * 100)))}% · Move with the circles, then return to rest</small>
    </div>
    {active && readings.slice(0, playerCount).flatMap((reading, player) =>
      targetPoint(reading, active.id).map((point, index) => (
        <div className="diagnostic-marker" key={`${player}-${index}`} style={markerPosition(point, capture, stageRef.current)}>
          <span>{playerCount === 2 ? `P${player + 1}` : '●'}</span>
        </div>
      )),
    )}
    {feedback && elapsed < (DIAGNOSTIC_STEPS[feedback.step + 1]?.start ?? DIAGNOSTIC_DURATION) + 0.3 &&
      <div className="diagnostic-feedback">{feedback.quality.map((quality, player) =>
        <span key={player}>{playerCount === 2 ? `P${player + 1}: ` : ''}{quality === null ? 'Tracking lost' : quality >= 0.8 ? 'Perfect!' : quality >= 0.45 ? 'Good!' : 'Keep practising'}</span>,
      )}</div>}
    <button className="btn diagnostic-stop" onClick={onClose}>Stop test</button>
  </div>
}
