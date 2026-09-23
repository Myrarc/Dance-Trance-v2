type MenuAudio = Pick<HTMLMediaElement, 'currentTime' | 'volume' | 'play'>
type MenuOutput = Pick<AudioContext, 'state' | 'resume'>

export function startMenuTheme(
  audio: MenuAudio,
  options: { restart?: boolean; volume?: number; output?: MenuOutput } = {},
): Promise<void> {
  if (options.output?.state === 'suspended') void options.output.resume().catch(() => undefined)
  if (options.restart) audio.currentTime = 0
  if (options.volume !== undefined) audio.volume = options.volume
  return audio.play()
}
