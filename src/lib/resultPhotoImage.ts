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

function fittedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, size: number) {
  context.font = `900 ${size}px Arial, sans-serif`
  while (context.measureText(text).width > maxWidth && size > 20) {
    size -= 2
    context.font = `900 ${size}px Arial, sans-serif`
  }
  context.fillText(text, x, y)
}

export async function composeResultPhoto(frame: HTMLCanvasElement, snapshot: PhotoScoreSnapshot): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 900
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Photo canvas is unavailable')

  context.fillStyle = '#fff1cf'
  context.fillRect(0, 0, 1600, 900)
  context.fillStyle = '#30243b'
  fittedText(context, 'DANCE TRANCE', 42, 67, 850, 49)
  context.fillStyle = '#e9ac34'
  context.fillRect(1052, 40, 505, 815)
  context.strokeStyle = '#30243b'
  context.lineWidth = 7
  context.strokeRect(1052, 40, 505, 815)

  const photoX = 42
  const photoY = 125
  const photoWidth = 962
  const photoHeight = 626
  const scale = Math.max(photoWidth / frame.width, photoHeight / frame.height)
  const sourceWidth = photoWidth / scale
  const sourceHeight = photoHeight / scale
  context.drawImage(frame, (frame.width - sourceWidth) / 2, (frame.height - sourceHeight) / 2, sourceWidth, sourceHeight, photoX, photoY, photoWidth, photoHeight)
  context.strokeStyle = '#30243b'
  context.lineWidth = 8
  context.strokeRect(photoX, photoY, photoWidth, photoHeight)
  context.fillStyle = '#25b5bd'
  context.fillRect(photoX, 773, photoWidth, 82)
  context.fillStyle = '#30243b'
  fittedText(context, snapshot.songName.replace(/\.[^.]+$/, ''), photoX + 22, 828, photoWidth - 44, 38)

  context.fillStyle = '#30243b'
  fittedText(context, 'FINAL SCORE', 1080, 114, 450, 48)
  context.font = '800 24px Arial, sans-serif'
  context.fillText(snapshot.difficulty.toUpperCase(), 1083, 151)
  snapshot.players.forEach((player, index) => {
    const y = snapshot.players.length > 1 ? 187 + index * 315 : 210
    context.fillStyle = '#fff8e8'
    context.fillRect(1080, y, 450, snapshot.players.length > 1 ? 294 : 420)
    context.strokeStyle = '#30243b'
    context.lineWidth = 4
    context.strokeRect(1080, y, 450, snapshot.players.length > 1 ? 294 : 420)
    context.fillStyle = '#f26669'
    fittedText(context, `PLAYER ${index + 1}`, 1103, y + 48, 410, 36)
    context.fillStyle = '#30243b'
    fittedText(context, player.score.toLocaleString(), 1103, y + 128, 408, 72)
    context.font = '800 27px Arial, sans-serif'
    context.fillText(`${player.accuracy}% accuracy`, 1103, y + 185)
    context.fillText(`${player.maxCombo}× max combo`, 1103, y + 225)
    context.font = '700 22px Arial, sans-serif'
    context.fillText(`P ${player.perfect}  ·  G ${player.good}  ·  M ${player.miss}`, 1103, y + 263)
  })
  context.fillStyle = '#30243b'
  context.font = '700 20px Arial, sans-serif'
  context.fillText('Saved on this device', 1084, 821)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Photo encoding failed')), 'image/jpeg', 0.9)
  })
}
