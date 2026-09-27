import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMediaStorage } from '../electron/media-storage.mjs'

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
