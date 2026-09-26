import { SIDE_COLORS } from './skeleton.ts'
import { HIT_LEAD_S, type CueEvent, type HitJoint } from './hitTargets.ts'

export { HIT_LEAD_S } from './hitTargets.ts'

export const HIT_COLORS: Record<HitJoint, string> = {
  head: '#7df4ff',
  leftHand: SIDE_COLORS.left,
  rightHand: SIDE_COLORS.right,
  leftFoot: SIDE_COLORS.left,
  rightFoot: SIDE_COLORS.right,
}

export const HIT_BURST_DURATION_S = 0.48

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
  ctx.globalAlpha = 0.95
  ctx.lineWidth = line * 1.25
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()

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
  grade: 'perfect' | 'good' | 'miss',
) {
  const fontSize = Math.max(12, radius * 0.42)
  const label = grade.toUpperCase()

  ctx.save()
  ctx.font = `800 ${fontSize}px 'Trance Display', Impact, sans-serif`
  const lineWidth = Math.max(2, fontSize * 0.12)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#30233f'
  ctx.strokeText(label, x, y, radius * 1.65)
  ctx.fillStyle = grade === 'perfect' ? '#2cb8ba' : grade === 'good' ? '#e7aa33' : '#f06b68'
  ctx.fillText(label, x, y, radius * 1.65)
  ctx.restore()
}

export function drawArcadeHitBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  grade: 'perfect' | 'good' | 'miss',
  age: number,
  reduceMotion: boolean,
) {
  if (age < 0 || age > HIT_BURST_DURATION_S) return
  const progress = age / HIT_BURST_DURATION_S
  const eased = 1 - (1 - progress) ** 3
  const strength = grade === 'perfect' ? 1 : grade === 'good' ? 0.72 : 0.36
  const color = grade === 'perfect' ? '#7df4ff' : grade === 'good' ? '#ffd166' : '#f06b68'
  const rayCount = reduceMotion || grade === 'miss' ? 0 : grade === 'perfect' ? 12 : 8

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = radius * strength
  ctx.globalAlpha = (1 - progress) * strength
  ctx.lineWidth = Math.max(3, radius * 0.11 * (1 - progress * 0.55))

  ctx.beginPath()
  ctx.arc(x, y, radius * (0.72 + eased * 1.65), 0, Math.PI * 2)
  ctx.stroke()

  if (!reduceMotion) {
    const pop = 1 + Math.sin(Math.min(1, progress * 2) * Math.PI) * strength * 0.58
    ctx.beginPath()
    ctx.arc(x, y, radius * pop, 0, Math.PI * 2)
    ctx.stroke()
  }

  for (let index = 0; index < rayCount; index++) {
    const angle = index / rayCount * Math.PI * 2
    const inner = radius * (0.82 + eased * 0.72)
    const outer = inner + radius * (0.34 + strength * 0.42) * (1 - progress)
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner)
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer)
    ctx.stroke()
  }

  const flash = Math.max(0, 1 - progress * 4)
  if (flash > 0) {
    ctx.globalAlpha = flash * strength
    ctx.beginPath()
    ctx.arc(x, y, radius * (0.25 + flash * 0.42), 0, Math.PI * 2)
    ctx.fill()
  }
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
