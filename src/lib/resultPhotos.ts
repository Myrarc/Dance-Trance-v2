import { openLibraryDatabase } from './library.ts'

const META_STORE = 'resultPhotos'
const IMAGE_STORE = 'resultPhotoImages'

export interface ResultPhoto {
  id: string
  createdAt: number
  songName: string
  score: number
}

export async function saveResultPhoto(photo: ResultPhoto, image: Blob): Promise<void> {
  const db = await openLibraryDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([META_STORE, IMAGE_STORE], 'readwrite')
    transaction.objectStore(META_STORE).put(photo)
    transaction.objectStore(IMAGE_STORE).put(image, photo.id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function listResultPhotos(): Promise<ResultPhoto[]> {
  const db = await openLibraryDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll()
    request.onsuccess = () => resolve((request.result as ResultPhoto[]).sort((a, b) => b.createdAt - a.createdAt))
    request.onerror = () => reject(request.error)
  })
}

export async function getResultPhoto(id: string): Promise<Blob | null> {
  const db = await openLibraryDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(IMAGE_STORE, 'readonly').objectStore(IMAGE_STORE).get(id)
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function deleteResultPhoto(id: string): Promise<void> {
  const db = await openLibraryDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([META_STORE, IMAGE_STORE], 'readwrite')
    transaction.objectStore(META_STORE).delete(id)
    transaction.objectStore(IMAGE_STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
