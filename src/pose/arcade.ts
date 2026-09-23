import { SIDE_COLORS } from './skeleton'
import { HIT_LEAD_S, type CueEvent, type HitJoint } from './hitTargets'

export { HIT_LEAD_S } from './hitTargets'

export const HIT_COLORS: Record<HitJoint, string> = {
  head: '#7df4ff',
  leftHand: SIDE_COLORS.left,
  rightHand: SIDE_COLORS.right,
  leftFoot: SIDE_COLORS.left,
  rightFoot: SIDE_COLORS.right,
}

export function cueColor(cue: CueEvent) {
  if (cue.kind === 'clap') return '#ee665f'
  return HIT_COLORS[cue.joint]
}

export function drawHitRail(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  width: number,
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return
  const ox = (-dy / length) * width * 0.9
  const oy = (dx / length) * width * 0.9

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, width * 0.36)
  ctx.globalAlpha = 0.55
  ctx.shadowColor = color
  ctx.shadowBlur = width * 1.5
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(from.x + ox * side, from.y + oy * side)
    ctx.lineTo(to.x + ox * side, to.y + oy * side)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawArcadeHitMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  remaining: number,
  reduceMotion: boolean,
) {
  const countdown = Math.max(0, Math.min(1, remaining / HIT_LEAD_S))
  const impact = remaining <= 0 ? Math.max(0, 1 + remaining / 0.12) : 0
  const pulse = reduceMotion ? 1 : 1 + impact * 0.28
  const r = radius * pulse
  const line = Math.max(2, radius * 0.075)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'

  const halo = ctx.createRadialGradient(x, y, radius * 0.12, x, y, r * 1.5)
  halo.addColorStop(0, `${color}55`)
  halo.addColorStop(0.5, `${color}20`)
  halo.addColorStop(1, `${color}00`)
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, r * 1.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = radius * 0.28
  for (const [scale, alpha] of [[0.58, 0.9], [0.78, 0.7], [1, 0.95]] as const) {
    ctx.globalAlpha = alpha
    ctx.lineWidth = scale === 1 ? line * 1.25 : line * 0.65
    ctx.beginPath()
    ctx.arc(x, y, r * scale, 0, Math.PI * 2)
    ctx.stroke()
  }

  // The warm outer sweep is the clock: it contracts towards the hit point.
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#fff2a8'
  ctx.shadowColor = '#fff2a8'
  ctx.shadowBlur = radius * 0.22
  ctx.lineCap = 'round'
  ctx.lineWidth = line * 1.5
  ctx.beginPath()
  ctx.arc(x, y, r * 1.22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * countdown)
  ctx.stroke()

  // Four small breaks keep the marker reading as a game reticle, not a chart.
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = line * 0.55
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2
    const inner = r * 0.33
    const outer = r * 0.44
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner)
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer)
    ctx.stroke()
  }

  if (impact > 0) {
    ctx.globalAlpha = impact
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = color
    ctx.shadowBlur = radius * 0.7
    ctx.beginPath()
    ctx.arc(x, y, radius * (0.12 + impact * 0.12), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawArcadeHitLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  grade: 'perfect' | 'good',
) {
  const fontSize = Math.max(18, radius * 0.55)

  ctx.save()
  ctx.font = `800 ${fontSize}px 'Trance Display', Impact, sans-serif`
  const lineWidth = Math.max(3, fontSize * 0.16)
  const labelX = Math.min(x + radius * 0.72, ctx.canvas.width - ctx.measureText('HIT').width - lineWidth)
  const labelY = Math.max(y - radius * 0.72, fontSize + lineWidth)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.lineJoin = 'round'
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#30233f'
  ctx.strokeText('HIT', labelX, labelY)
  ctx.fillStyle = grade === 'perfect' ? '#2cb8ba' : '#e7aa33'
  ctx.fillText('HIT', labelX, labelY)
  ctx.restore()
}

export function drawCueGlyph(
  ctx: CanvasRenderingContext2D,
  cue: CueEvent,
  x: number,
  y: number,
  radius: number,
  currentTime: number,
) {
  if (cue.kind === 'spot') return
  const color = cueColor(cue)
  const line = Math.max(3, radius * 0.09)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = line
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = radius * 0.25

  if (cue.kind === 'hold') {
    const start = cue.time - cue.duration
    const progress = Math.max(0, Math.min(1, (currentTime - start) / cue.duration))
    ctx.beginPath()
    ctx.arc(x, y, radius * 1.38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
    ctx.stroke()
    ctx.font = `800 ${Math.max(12, radius * 0.3)}px 'Trance Display', Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('HOLD', x, y + radius * 1.72)
  } else if (cue.kind === 'clap') {
    for (const side of [-1, 1]) {
      const outer = x + side * radius * 0.82
      const inner = x + side * radius * 0.22
      ctx.beginPath()
      ctx.moveTo(outer, y - radius * 0.42)
      ctx.lineTo(inner, y)
      ctx.lineTo(outer, y + radius * 0.42)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Given a pose and joint, return the normalized (x, y) coordinates. */
export function jointPoint(
  pose: { x: number; y: number; visibility?: number }[],
  joint: HitJoint,
): { x: number; y: number } | null {
  if (joint === 'head') {
    const leftEar = pose[7]
    const rightEar = pose[8]
    if (leftEar && rightEar) {
      return { x: (leftEar.x + rightEar.x) / 2, y: (leftEar.y + rightEar.y) / 2 }
    }
    const nose = pose[0]
    return nose ? { x: nose.x, y: nose.y } : null
  }
  const idx =
    joint === 'leftHand'
      ? 15
      : joint === 'rightHand'
        ? 16
        : joint === 'leftFoot'
          ? 27
          : 28
  const pt = pose[idx]
  return pt ? { x: pt.x, y: pt.y } : null
}
