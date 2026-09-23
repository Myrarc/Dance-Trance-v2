import assert from 'node:assert/strict'
import test from 'node:test'
import { indexedDB as fakeIndexedDb } from 'fake-indexeddb'
import {
  getArcadeRecord,
  listArcadeRecords,
  openLibraryDatabase,
  putArcadeRecord,
} from '../src/lib/library.ts'
import type { ArcadeRecord } from '../src/game/records.ts'

Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fakeIndexedDb })

function openLegacyDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dance-trainer', 2)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('library', { keyPath: 'id' })
      request.result.createObjectStore('videos')
      request.result.createObjectStore('tracks')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

test('version five preserves the library and adds durable records, photos, and beat maps', async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('dance-trainer')
    request.onsuccess = () => resolve()
  })
  const legacy = await openLegacyDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = legacy.transaction('library', 'readwrite')
    transaction.objectStore('library').put({ id: 'legacy-song', name: 'Legacy Song' })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  legacy.close()

  const upgraded = await openLibraryDatabase()
  assert.equal(upgraded.version, 5)
  assert.equal(upgraded.objectStoreNames.contains('beatMaps'), true)
  assert.equal(upgraded.objectStoreNames.contains('library'), true)
  assert.equal(upgraded.objectStoreNames.contains('arcadeRecords'), true)
  assert.equal(upgraded.objectStoreNames.contains('resultPhotos'), true)
  assert.equal(upgraded.objectStoreNames.contains('resultPhotoImages'), true)
  const legacySong = await new Promise<{ id: string; name: string }>((resolve, reject) => {
    const request = upgraded.transaction('library').objectStore('library').get('legacy-song')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  assert.equal(legacySong.name, 'Legacy Song')

  const record: ArcadeRecord = {
    id: 'song:easy:1', videoId: 'song', difficulty: 'easy', playerSlot: 1,
    bestScore: 500, bestAccuracy: 75, bestGrade: 'B', maxCombo: 5,
    playCount: 1, updatedAt: 123,
  }
  await putArcadeRecord(record)
  assert.deepEqual(await getArcadeRecord(record.id), record)
  assert.deepEqual(await listArcadeRecords(), [record])
})
