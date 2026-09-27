interface DesktopFile {
  name?: string
  type: string
  data: ArrayBuffer | Uint8Array
}

interface DesktopStorageBridge {
  saveSong(input: { id: string; name: string; type: string; data: ArrayBuffer }): Promise<boolean>
  readSong(id: string): Promise<DesktopFile | null>
  deleteSong(id: string): Promise<void>
  savePhoto(input: { id: string; data: ArrayBuffer }): Promise<boolean>
  readPhoto(id: string): Promise<DesktopFile | null>
  deletePhoto(id: string): Promise<void>
  folders(): Promise<{ root: string; songs: string; photos: string }>
}

function bridge(): DesktopStorageBridge | undefined {
  return (globalThis as typeof globalThis & { danceTranceDesktop?: DesktopStorageBridge }).danceTranceDesktop
}

function arrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export function isDesktopApp(): boolean {
  return bridge() != null
}

export async function saveDesktopSong(id: string, file: File): Promise<boolean> {
  const desktop = bridge()
  if (!desktop) return false
  return desktop.saveSong({ id, name: file.name, type: file.type, data: await file.arrayBuffer() })
}

export async function getDesktopSong(id: string): Promise<File | null> {
  const stored = await bridge()?.readSong(id)
  if (!stored) return null
  return new File([arrayBuffer(stored.data)], stored.name ?? `${id}.video`, { type: stored.type })
}

export async function deleteDesktopSong(id: string): Promise<void> {
  await bridge()?.deleteSong(id)
}

export async function saveDesktopPhoto(id: string, image: Blob): Promise<boolean> {
  const desktop = bridge()
  if (!desktop) return false
  return desktop.savePhoto({ id, data: await image.arrayBuffer() })
}

export async function getDesktopPhoto(id: string): Promise<Blob | null> {
  const stored = await bridge()?.readPhoto(id)
  return stored ? new Blob([arrayBuffer(stored.data)], { type: stored.type }) : null
}

export async function deleteDesktopPhoto(id: string): Promise<void> {
  await bridge()?.deletePhoto(id)
}
