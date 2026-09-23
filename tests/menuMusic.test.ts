import assert from 'node:assert/strict'
import test from 'node:test'
import { startMenuTheme } from '../src/lib/menuMusic.ts'

test('returning home after results restarts the menu theme from its beginning', async () => {
  let startedAt = -1
  const audio = {
    currentTime: 38,
    volume: 0.4,
    play: () => {
      startedAt = audio.currentTime
      return Promise.resolve()
    },
  }

  await startMenuTheme(audio, { restart: true })

  assert.equal(startedAt, 0)
  assert.equal(audio.currentTime, 0)
})

test('ordinary menu playback keeps its current theme position', async () => {
  let startedAt = -1
  const audio = {
    currentTime: 38,
    volume: 0.4,
    play: () => {
      startedAt = audio.currentTime
      return Promise.resolve()
    },
  }

  await startMenuTheme(audio)

  assert.equal(startedAt, 38)
  assert.equal(audio.currentTime, 38)
})

test('returning home restores audible volume and resumes a suspended theme output', async () => {
  const events: string[] = []
  const output = {
    state: 'suspended',
    resume: () => {
      events.push('resume')
      return Promise.resolve()
    },
  }
  const audio = {
    currentTime: 72,
    volume: 0,
    play: () => {
      events.push(`play at ${audio.currentTime}s, volume ${audio.volume}`)
      return Promise.resolve()
    },
  }

  await startMenuTheme(audio, { restart: true, volume: 0.4, output })

  assert.deepEqual(events, ['resume', 'play at 0s, volume 0.4'])
})
