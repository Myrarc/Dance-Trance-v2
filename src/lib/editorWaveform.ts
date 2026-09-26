/** Small local amplitude overview; never retain decoded audio for the whole song. */
export async function editorWaveform(blob: Blob, duration: number, stopped: () => boolean): Promise<number[]> {
  const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } = await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
  const peaks = Array<number>(800).fill(0)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !await track.canDecode()) throw new Error('No decodable audio waveform.')
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        if (stopped()) return []
        const plane = new Float32Array(sample.numberOfFrames)
        sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
        for (let i = 0; i < plane.length; i += 8) {
          const index = Math.floor((sample.timestamp + i / sample.sampleRate) / duration * peaks.length)
          if (index >= 0 && index < peaks.length) peaks[index] = Math.max(peaks[index], Math.abs(plane[i]))
        }
      } finally { sample.close() }
    }
    const max = Math.max(...peaks, 0.001)
    return peaks.map((peak) => peak / max)
  } finally { input.dispose() }
}
