import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'

function validId(id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid media id')
  return id
}

function safeName(name) {
  const input = Array.from(basename(name), (character) =>
    character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character,
  ).join('').trim()
  return input || 'dance-video'
}

function mediaType(name) {
  const extension = extname(name).toLowerCase()
  return ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska' })[extension] ?? 'application/octet-stream'
}

export function createMediaStorage(root) {
  const songs = join(root, 'songs')
  const photos = join(root, 'photos')
  const initialize = () => Promise.all([mkdir(songs, { recursive: true }), mkdir(photos, { recursive: true })])
  const matchingSong = async (id) => {
    validId(id)
    const match = (await readdir(songs)).find((name) => name.startsWith(`${id}--`))
    return match ? join(songs, match) : null
  }
  const deleteSong = async (id) => {
    const path = await matchingSong(id)
    if (path) await rm(path, { force: true })
  }
  return {
    folders: { root, songs, photos },
    initialize,
    async saveSong({ id, name, data }) {
      await initialize()
      const destination = join(songs, `${validId(id)}--${safeName(name)}`)
      const previous = await matchingSong(id)
      const temporary = join(songs, `.${id}-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, new Uint8Array(data), { flag: 'wx', flush: true })
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { force: true })
      }
      if (previous && previous !== destination) await rm(previous, { force: true })
      return true
    },
    async readSong(id) {
      await initialize()
      const path = await matchingSong(id)
      if (!path) return null
      const data = await readFile(path)
      return { name: basename(path).slice(`${id}--`.length), type: mediaType(path), data: new Uint8Array(data) }
    },
    deleteSong,
    async savePhoto({ id, data }) {
      await initialize()
      await writeFile(join(photos, `${validId(id)}.jpg`), new Uint8Array(data))
      return true
    },
    async readPhoto(id) {
      await initialize()
      try {
        const data = await readFile(join(photos, `${validId(id)}.jpg`))
        return { type: 'image/jpeg', data: new Uint8Array(data) }
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    async deletePhoto(id) {
      await initialize()
      await rm(join(photos, `${validId(id)}.jpg`), { force: true })
    },
  }
}
