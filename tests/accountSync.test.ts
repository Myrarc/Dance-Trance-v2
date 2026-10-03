import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('account writes serialize, retry conflicts, retain failures, and stay with their original account', async (t) => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
    define: { 'import.meta.env.VITE_PLAYKIT_URL': JSON.stringify('https://audit.invalid') },
  })
  let save = { data: { sessions: [] as any[], library: [] as any[] }, version: 0 }
  let userId = 'first-player'
  let conflicts = 0
  let writes = 0
  let fail = false
  let reading: (() => Promise<void>) | null = null
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(url.startsWith('https://audit.invalid/'), 'the test must never contact a live account')
    if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'test', user: { id: userId } })
    assert.ok(url.endsWith('/games/dance-trainer/save'))
    if (init.method !== 'PUT') {
      const snapshot = structuredClone(save)
      await reading?.()
      return Response.json({ save: snapshot })
    }
    writes++
    if (fail) throw new Error('Network unavailable')
    const body = JSON.parse(init.body as string)
    if (conflicts > 0) {
      conflicts--
      save.version++
      save.data.library.push({ id: `other-device-${save.version}`, name: 'Other device' })
      return Response.json({ error: 'version_conflict', currentVersion: save.version }, { status: 409 })
    }
    if (body.version !== save.version) return Response.json({ error: 'version_conflict', currentVersion: save.version }, { status: 409 })
    save = { data: body.data, version: save.version + 1 }
    return Response.json({ save: { version: save.version, updatedAt: 'now' } })
  })
  try {
    const client = await server.ssrLoadModule('/src/playkitClient.ts')
    await client.playkit.login('test', 'test')
    let pending = false
    const unsubscribe = client.onSyncPending((value: boolean) => { pending = value })
    await Promise.all([
      client.syncLibrary([{ id: 'a', name: 'A' }]),
      client.syncLibrary([{ id: 'b', name: 'B' }]),
    ])
    assert.deepEqual(save.data.library.map((item) => item.id).sort(), ['a', 'b'])
    conflicts = 2
    const before = writes
    await client.syncLibrary([{ id: 'c', name: 'C' }])
    assert.equal(writes - before, 3)
    assert.equal(save.data.library.length, 5, 'retry merges the other device changes too')

    fail = true
    const session = { at: '2026-09-30T00:00:00Z', seconds: 60, averageMatch: 80, bestMatch: 90, videoId: 'a' }
    await client.recordSession(session)
    assert.equal(pending, true)
    fail = false
    await client.syncLibrary([{ id: 'd', name: 'D' }])
    await client.retryFailedSaves()
    assert.equal(pending, false)
    assert.equal(save.data.sessions.length, 1)
    await client.recordSession(session)
    assert.equal(save.data.sessions.length, 1, 'an uncertain response cannot duplicate a retried session')

    conflicts = 4
    const bounded = writes
    await client.syncLibrary([{ id: 'retry-later', name: 'Retry later' }])
    assert.equal(writes - bounded, 3, 'conflict retries are bounded')
    assert.equal(pending, true)
    conflicts = 0
    await client.retryFailedSaves()
    assert.equal(pending, false)

    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    reading = async () => { entered(); await gate }
    const oldUpdate = client.syncLibrary([{ id: 'private-to-first', name: 'First player' }])
    await started
    userId = 'second-player'
    await client.playkit.login('second', 'test')
    release()
    await oldUpdate
    reading = null
    await client.retryFailedSaves()
    assert.equal(save.data.library.some((item) => item.id === 'private-to-first'), false)
    unsubscribe()
  } finally { await server.close() }
})
