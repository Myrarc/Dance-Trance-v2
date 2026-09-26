import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnalysisQueue } from '../src/lib/analysisQueue.ts'

test('batch preparation runs one song at a time and deduplicates opening a queued song', async () => {
  const queue = createAnalysisQueue()
  const events: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const first = queue.enqueue('a', async () => { events.push('a'); await gate })
  assert.equal(queue.enqueue('a', async () => { events.push('duplicate') }), first)
  const second = queue.enqueue('b', async () => { events.push('b') })
  await Promise.resolve()
  assert.deepEqual(events, ['a'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(events, ['a', 'b'])
})

test('failed and forgotten songs do not block later imports', async () => {
  const queue = createAnalysisQueue()
  const failed = queue.enqueue('bad', async () => { throw new Error('bad video') })
  const forgotten = queue.enqueue('removed', async () => { assert.fail('must not analyse a forgotten song') })
  queue.cancel('removed')
  let ready = false
  const next = queue.enqueue('good', async () => { ready = true })
  await assert.rejects(failed)
  await Promise.all([forgotten, next])
  assert.equal(ready, true)
})

test('forgetting a running song waits for cancellation before deleting its saved data', async () => {
  const queue = createAnalysisQueue()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let saved = false
  const run = queue.enqueue('active', async (cancelled) => { await gate; saved = !cancelled() })
  const queued = queue.enqueue('queued', async () => { assert.fail('cancelled pending import') })
  await Promise.resolve()
  await queue.cancel('queued')
  const cancelled = queue.cancel('active')
  release()
  await Promise.all([run, queued, cancelled])
  assert.equal(saved, false)
})
