import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteResultPhoto, getResultPhoto, listResultPhotos, saveResultPhoto } from '../src/lib/resultPhotos.ts'

test('result photos stay local, list by newest first, and delete both image and metadata', async () => {
  const first = { id: 'photo-a', createdAt: 100, songName: 'First dance', score: 1200 }
  const second = { id: 'photo-b', createdAt: 200, songName: 'Second dance', score: 2400 }
  await saveResultPhoto(first, new Blob(['first'], { type: 'image/jpeg' }))
  await saveResultPhoto(second, new Blob(['second'], { type: 'image/jpeg' }))
  assert.deepEqual((await listResultPhotos()).map(({ id }) => id), ['photo-b', 'photo-a'])
  assert.equal(await (await getResultPhoto('photo-a'))?.text(), 'first')
  await deleteResultPhoto('photo-a')
  assert.equal(await getResultPhoto('photo-a'), null)
  assert.deepEqual((await listResultPhotos()).map(({ id }) => id), ['photo-b'])
})
