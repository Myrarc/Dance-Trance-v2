import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMediaStorage } from '../electron/media-storage.mjs'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'

test('desktop media storage creates visible song and photo folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dance-trance-'))
  try {
    const storage = createMediaStorage(root)
    await storage.initialize()
    await storage.saveSong({ id: 'song-1', name: '../My Dance?.mp4', type: 'video/mp4', data: new TextEncoder().encode('video') })
    await storage.savePhoto({ id: 'photo-1', data: new TextEncoder().encode('image') })

    const songs = await readdir(join(root, 'songs'))
    const photos = await readdir(join(root, 'photos'))
    assert.deepEqual(songs, ['song-1--My Dance_.mp4'])
    assert.deepEqual(photos, ['photo-1.jpg'])
    assert.equal(await readFile(join(root, 'songs', songs[0]), 'utf8'), 'video')
    assert.equal(new TextDecoder().decode((await storage.readSong('song-1'))?.data), 'video')
    assert.equal(new TextDecoder().decode((await storage.readPhoto('photo-1'))?.data), 'image')

    await storage.deleteSong('song-1')
    await storage.deletePhoto('photo-1')
    assert.deepEqual(await readdir(join(root, 'songs')), [])
    assert.deepEqual(await readdir(join(root, 'photos')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('desktop media storage rejects ids that could escape the media folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dance-trance-'))
  try {
    const storage = createMediaStorage(root)
    await assert.rejects(() => storage.savePhoto({ id: '../outside', data: new Uint8Array() }), /Invalid media id/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed replacement preserves the saved song and removes its temporary file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dance-trance-'))
  const originalWrite = fs.writeFile
  try {
    const storage = createMediaStorage(root)
    const input = { id: 'song', name: 'dance.mp4', data: new TextEncoder().encode('original') }
    await storage.saveSong(input)
    fs.writeFile = async () => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }) }
    syncBuiltinESMExports()
    await assert.rejects(storage.saveSong({ ...input, data: new Uint8Array([2]) }), { code: 'ENOSPC' })
    assert.equal(new TextDecoder().decode((await storage.readSong('song'))?.data), 'original')
    assert.deepEqual(await readdir(join(root, 'songs')), ['song--dance.mp4'])
    fs.writeFile = originalWrite
    syncBuiltinESMExports()
    await storage.saveSong({ ...input, data: new TextEncoder().encode('replacement') })
    assert.equal(new TextDecoder().decode((await storage.readSong('song'))?.data), 'replacement')
  } finally {
    fs.writeFile = originalWrite
    syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true })
  }
})
