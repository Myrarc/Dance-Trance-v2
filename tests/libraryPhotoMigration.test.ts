import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openLibraryDatabase } from '../src/lib/library.ts'
import { getResultPhoto, listResultPhotos, saveResultPhoto } from '../src/lib/resultPhotos.ts'

test('a version-three library upgrades without losing songs or score records', async () => {
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dance-trainer', 3)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('library', { keyPath: 'id' })
      request.result.createObjectStore('videos')
      request.result.createObjectStore('tracks')
      request.result.createObjectStore('arcadeRecords', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve) => {
    const transaction = legacy.transaction(['library', 'arcadeRecords'], 'readwrite')
    transaction.objectStore('library').put({ id: 'song', name: 'Saved song' })
    transaction.objectStore('arcadeRecords').put({ id: 'score', bestScore: 321 })
    transaction.oncomplete = () => resolve()
  })
  legacy.close()

  const upgraded = await openLibraryDatabase()
  assert.equal(upgraded.version, 5)
  assert.equal(upgraded.objectStoreNames.contains('beatMaps'), true)
  const read = (store: string, key: string) => new Promise<unknown>((resolve) => {
    const request = upgraded.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
  })
  assert.deepEqual(await read('library', 'song'), { id: 'song', name: 'Saved song' })
  assert.deepEqual(await read('arcadeRecords', 'score'), { id: 'score', bestScore: 321 })
  await saveResultPhoto({ id: 'photo', createdAt: 123, songName: 'Saved song', score: 321 }, new Blob(['photo']))
  assert.equal((await listResultPhotos()).length, 1)
  assert.equal(await (await getResultPhoto('photo'))?.text(), 'photo')
})
