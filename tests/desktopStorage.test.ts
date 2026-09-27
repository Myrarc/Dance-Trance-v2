import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deleteDesktopPhoto,
  deleteDesktopSong,
  getDesktopPhoto,
  getDesktopSong,
  isDesktopApp,
  saveDesktopPhoto,
  saveDesktopSong,
} from '../src/lib/desktopStorage.ts'

test('desktop media bridge stores and retrieves songs and photos when available', async () => {
  const calls: string[] = []
  const songData = new TextEncoder().encode('song').buffer
  const photoData = new TextEncoder().encode('photo').buffer
  Object.assign(globalThis, {
    danceTranceDesktop: {
      saveSong: async () => { calls.push('save-song'); return true },
      readSong: async () => ({ name: 'dance.mp4', type: 'video/mp4', data: songData }),
      deleteSong: async () => { calls.push('delete-song') },
      savePhoto: async () => { calls.push('save-photo'); return true },
      readPhoto: async () => ({ type: 'image/jpeg', data: photoData }),
      deletePhoto: async () => { calls.push('delete-photo') },
    },
  })

  assert.equal(isDesktopApp(), true)
  assert.equal(await saveDesktopSong('song-id', new File(['song'], 'dance.mp4', { type: 'video/mp4' })), true)
  assert.equal(await (await getDesktopSong('song-id'))?.text(), 'song')
  assert.equal(await saveDesktopPhoto('photo-id', new Blob(['photo'], { type: 'image/jpeg' })), true)
  assert.equal(await (await getDesktopPhoto('photo-id'))?.text(), 'photo')
  await deleteDesktopSong('song-id')
  await deleteDesktopPhoto('photo-id')
  assert.deepEqual(calls, ['save-song', 'save-photo', 'delete-song', 'delete-photo'])

  Reflect.deleteProperty(globalThis, 'danceTranceDesktop')
  assert.equal(isDesktopApp(), false)
  assert.equal(await saveDesktopSong('song-id', new File([], 'dance.mp4')), false)
  assert.equal(await getDesktopSong('song-id'), null)
})
