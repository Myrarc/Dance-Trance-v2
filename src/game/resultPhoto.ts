export const PHOTO_PROMPTS = [
  'Wave to the camera!',
  'Say cheese!',
  'Smile for the camera!',
  'Strike a pose!',
  'Show us your best pose!',
] as const

export function photoPrompt(round: number): string {
  return PHOTO_PROMPTS[((round % PHOTO_PROMPTS.length) + PHOTO_PROMPTS.length) % PHOTO_PROMPTS.length]
}

export function photoStage(elapsedMs: number): { phase: 'waiting' | 'posing' | 'capture'; digit: number | null } {
  if (elapsedMs < 3000) return { phase: 'waiting', digit: null }
  if (elapsedMs < 6000) return { phase: 'posing', digit: 3 - Math.floor((elapsedMs - 3000) / 1000) }
  return { phase: 'capture', digit: null }
}
