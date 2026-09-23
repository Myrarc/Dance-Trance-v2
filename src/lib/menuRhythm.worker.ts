/// <reference lib="webworker" />

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { analyseRhythm } from '../pose/rhythm'

const worker = self as unknown as DedicatedWorkerGlobalScope

worker.onmessage = async (event: MessageEvent<{ url: string }>) => {
  try {
    const response = await fetch(event.data.url)
    if (!response.ok) throw new Error('Theme audio unavailable')
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await response.blob()) })
    try {
      const rhythm = await analyseRhythm(input)
      worker.postMessage({ beats: rhythm?.beats ?? null })
    } finally {
      input.dispose()
    }
  } catch {
    worker.postMessage({ beats: null })
  }
}
