import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('fallback metadata handles already-loaded media, errors, cancellation, and timeout', async (t) => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  try {
    const { waitForVideoMetadata } = await server.ssrLoadModule('/src/pose/track.ts')
    const video = () => Object.assign(new EventTarget(), { readyState: 0, error: null })
    const loaded = video()
    loaded.readyState = 1
    assert.equal(await waitForVideoMetadata(loaded, () => false), true, 'metadata before listener registration must not hang')
    const loading = video()
    const ready = waitForVideoMetadata(loading, () => false)
    loading.dispatchEvent(new Event('loadedmetadata'))
    assert.equal(await ready, true)
    const broken = video()
    const failure = assert.rejects(waitForVideoMetadata(broken, () => false), /decode/)
    broken.dispatchEvent(new Event('error'))
    await failure
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    let cancelled = false
    const cancellation = waitForVideoMetadata(video(), () => cancelled)
    cancelled = true
    t.mock.timers.tick(100)
    assert.equal(await cancellation, false)
    const timeout = assert.rejects(waitForVideoMetadata(video(), () => false), /timed out/)
    t.mock.timers.tick(10_000)
    await timeout
  } finally {
    t.mock.timers.reset()
    await server.close()
  }
})
