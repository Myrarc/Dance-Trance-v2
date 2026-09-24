import { gradeFromAccuracy } from '../game/records'

export interface PhotoPlayerScore {
  score: number
  accuracy: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
}

export interface PhotoScoreSnapshot {
  songName: string
  difficulty: string
  players: PhotoPlayerScore[]
}

const INK = '#30243b'
const PAPER = '#fff4d8'
const CORAL = '#f26669'
const CYAN = '#2cb8ba'
const GOLD = '#e9ac34'

function fittedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, size: number, family = 'Lilita One') {
  context.font = `${family === 'Trance Display' ? '800' : '400'} ${size}px '${family}', sans-serif`
  while (context.measureText(text).width > maxWidth && size > 20) {
    size -= 2
    context.font = `${family === 'Trance Display' ? '800' : '400'} ${size}px '${family}', sans-serif`
  }
  context.fillText(text, x, y, maxWidth)
}

function playerCard(context: CanvasRenderingContext2D, player: PhotoPlayerScore, index: number, y: number, compact: boolean) {
  const x = 1080
  const width = 448
  const height = compact ? 291 : 584
  context.fillStyle = INK
  context.fillRect(x + 8, y + 8, width, height)
  context.fillStyle = '#fff9ea'
  context.fillRect(x, y, width, height)
  context.strokeStyle = INK
  context.lineWidth = 5
  context.strokeRect(x, y, width, height)

  context.fillStyle = CORAL
  fittedText(context, `PLAYER ${index + 1}`, x + 23, y + 49, 254, 36)
  context.fillStyle = INK
  context.beginPath()
  context.arc(x + width - 59, y + 49, 39, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = GOLD
  context.beginPath()
  context.arc(x + width - 59, y + 49, 33, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = INK
  context.textAlign = 'center'
  fittedText(context, gradeFromAccuracy(player.accuracy), x + width - 59, y + 66, 58, 48, 'Trance Display')
  context.textAlign = 'left'

  context.fillStyle = INK
  fittedText(context, player.score.toLocaleString(), x + 23, y + (compact ? 110 : 151), width - 46, compact ? 61 : 76, 'Trance Display')
  context.fillStyle = CYAN
  context.fillRect(x + 23, y + (compact ? 125 : 172), width - 46, 5)
  context.fillStyle = INK
  fittedText(context, `${player.accuracy}% ACCURACY`, x + 23, y + (compact ? 160 : 220), width - 46, compact ? 25 : 35)
  fittedText(context, `${player.maxCombo}× MAX COMBO`, x + 23, y + (compact ? 190 : 266), width - 46, compact ? 25 : 35)

  const rows = [
    ['PERFECT', player.perfect, CYAN],
    ['GOOD', player.good, GOLD],
    ['MISS', player.miss, CORAL],
  ] as const
  rows.forEach(([label, count, color], row) => {
    const rowY = y + (compact ? 226 + row * 22 : 301 + row * 83)
    if (compact) {
      context.fillStyle = color
      context.fillRect(x + 23, rowY - 15, 15, 15)
      context.fillStyle = INK
      fittedText(context, label, x + 48, rowY, 220, 20)
      context.textAlign = 'right'
      fittedText(context, count.toLocaleString(), x + width - 23, rowY, 90, 23)
      context.textAlign = 'left'
    } else {
      context.fillStyle = color
      context.fillRect(x + 23, rowY, width - 46, 70)
      context.strokeStyle = INK
      context.lineWidth = 3
      context.strokeRect(x + 23, rowY, width - 46, 70)
      context.fillStyle = INK
      fittedText(context, label, x + 39, rowY + 47, 250, 35)
      context.textAlign = 'right'
      fittedText(context, count.toLocaleString(), x + width - 41, rowY + 48, 100, 39, 'Trance Display')
      context.textAlign = 'left'
    }
  })
}

export async function composeResultPhoto(frame: HTMLCanvasElement, snapshot: PhotoScoreSnapshot): Promise<Blob> {
  const logo = new Image()
  logo.src = `${import.meta.env.BASE_URL}logo.png`
  await Promise.all([
    logo.decode(),
    document.fonts.load("400 36px 'Lilita One'"),
    document.fonts.load("800 76px 'Trance Display'"),
  ])

  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 900
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Photo canvas is unavailable')

  context.fillStyle = PAPER
  context.fillRect(0, 0, 1600, 900)
  context.strokeStyle = INK
  context.lineWidth = 8
  context.strokeRect(18, 18, 1564, 864)
  context.drawImage(logo, 100, 90, 1900, 500, 48, 26, 422, 112)
  context.fillStyle = CORAL
  context.fillRect(753, 84, 77, 13)
  context.fillStyle = GOLD
  context.fillRect(844, 84, 77, 13)
  context.fillStyle = CYAN
  context.fillRect(935, 84, 77, 13)

  const photoX = 54
  const photoY = 172
  const photoWidth = 946
  const photoHeight = 532
  context.fillStyle = CYAN
  context.fillRect(photoX + 12, photoY + 12, photoWidth, photoHeight)
  const scale = Math.max(photoWidth / frame.width, photoHeight / frame.height)
  const sourceWidth = photoWidth / scale
  const sourceHeight = photoHeight / scale
  context.drawImage(frame, (frame.width - sourceWidth) / 2, (frame.height - sourceHeight) / 2, sourceWidth, sourceHeight, photoX, photoY, photoWidth, photoHeight)
  context.strokeStyle = INK
  context.lineWidth = 8
  context.strokeRect(photoX, photoY, photoWidth, photoHeight)
  context.fillStyle = INK
  context.fillRect(photoX + 10, 744 + 10, photoWidth, 91)
  context.fillStyle = CYAN
  context.fillRect(photoX, 744, photoWidth, 91)
  context.fillStyle = INK
  context.font = "23px 'Lilita One'"
  context.fillText('THE TRACK', photoX + 22, 774)
  fittedText(context, snapshot.songName.replace(/\.[^.]+$/, ''), photoX + 22, 817, photoWidth - 44, 38)

  context.fillStyle = INK
  context.fillRect(1059, 45, 497, 810)
  context.fillStyle = GOLD
  context.fillRect(1050, 36, 497, 810)
  context.strokeStyle = INK
  context.lineWidth = 6
  context.strokeRect(1050, 36, 497, 810)
  context.fillStyle = INK
  fittedText(context, 'FINAL SCORE', 1078, 103, 350, 48)
  context.fillStyle = CORAL
  context.fillRect(1079, 118, 175, 36)
  context.fillStyle = INK
  fittedText(context, snapshot.difficulty.toUpperCase(), 1093, 145, 148, 24)
  snapshot.players.forEach((player, index) => {
    playerCard(context, player, index, snapshot.players.length > 1 ? 173 + index * 308 : 176, snapshot.players.length > 1)
  })
  context.fillStyle = INK
  fittedText(context, 'SAVED ON THIS DEVICE', 1080, 824, 440, 22)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Photo encoding failed')), 'image/jpeg', 0.9)
  })
}
