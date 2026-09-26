// Local diagnostic data only. This database is never read by account sync.
export interface RecordingInfo { id: string; song: string; started: string; status: string; chunks: number; bytes: number }
let database: Promise<IDBDatabase> | undefined
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dance-scoring-recordings', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' })
      request.result.createObjectStore('chunks')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error) }
  })
}
async function transaction(stores: string[], action: (tx: IDBTransaction) => void) {
  const database = await db()
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(stores, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Recording storage failed'))
    action(tx)
  })
}
export function encodeRecording(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (ArrayBuffer.isView(item)) return Array.from(item as unknown as ArrayLike<number>)
    if (typeof item === 'number' && !Number.isFinite(item)) return { $number: String(item) }
    return item
  })
}
export function decodeRecording(line: string) {
  return JSON.parse(line, (_key, item) => item && typeof item === 'object' && '$number' in item ? Number(item.$number) : item)
}
const listeners = new Set<() => void>()
let state = { armed: false, active: false, saving: false, message: 'Recorder off' }
function publish(next: Partial<typeof state>) { state = { ...state, ...next }; listeners.forEach((fn) => fn()) }
export const recorderSnapshot = () => state
export const subscribeRecorder = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
let session: RecordingInfo | null = null
let lines: string[] = []
let pending = Promise.resolve()
let failed = false
let sequence = 0
let queuedBytes = 0
let captureCostMs = 0
export const recordingCaptureCost = () => captureCostMs
let flushTimer: ReturnType<typeof setInterval> | undefined
function flush() {
  if (!session || !lines.length || failed) return
  const payload = lines.join('')
  lines = []
  const payloadBytes = new Blob([payload]).size
  if (queuedBytes + payloadBytes > 32 * 1048576) {
    failed = true
    clearInterval(flushTimer)
    session = null
    publish({ active: false, armed: false, saving: false, message: 'Recording stopped: storage cannot keep up. Previously saved chunks are still exportable.' })
    return
  }
  queuedBytes += payloadBytes
  const index = session.chunks++
  session.bytes += payloadBytes
  const info = { ...session }
  pending = pending.then(() => {
    if (failed) return
    return transaction(['sessions', 'chunks'], (tx) => {
      tx.objectStore('chunks').put(payload, [info.id, index])
      tx.objectStore('sessions').put(info)
    })
  }).catch((error) => {
    failed = true
    clearInterval(flushTimer)
    lines = []
    session = null
    publish({ active: false, armed: false, saving: false, message: `Recording stopped: ${String(error)}. Previously saved chunks are still exportable.` })
  }).finally(() => { queuedBytes -= payloadBytes })
}
export function captureScoring(type: string, data: unknown) {
  if (!session || failed) return
  const started = performance.now()
  lines.push(encodeRecording({ sequence: sequence++, type, at: performance.now(), data }) + '\n')
  if (lines.length >= 30) flush()
  captureCostMs = performance.now() - started
}
export function armRecorder(armed: boolean) {
  if (state.saving) return
  if (!armed && session) { finishRecording('stopped by player'); return }
  publish({ armed, message: armed ? 'Armed for the next round' : state.active ? state.message : 'Recorder off' })
}
export function beginRecording(song: string, metadata: unknown) {
  if (!state.armed || state.saving || session) return
  failed = false
  sequence = 0
  session = { id: crypto.randomUUID(), song, started: new Date().toISOString(), status: 'recording / interrupted if app closed', chunks: 0, bytes: 0 }
  publish({ armed: false, active: true, message: 'Recording scoring data locally' })
  captureScoring('header', { format: 'dance-scoring-v1', ...metadata as object })
  flush()
  flushTimer = setInterval(flush, 1000)
}
export function finishRecording(reason: string, results?: unknown) {
  if (!session) return
  captureScoring('end', { reason, results })
  session.status = reason
  flush()
  session = null
  clearInterval(flushTimer)
  publish({ active: false, saving: true, message: 'Saving recording…' })
  void pending.then(() => { if (!failed && !session) publish({ saving: false, message: 'Recording saved locally. Export it from Settings.' }) })
}
export async function listRecordings(): Promise<RecordingInfo[]> {
  await pending
  const database = await db()
  return new Promise((resolve, reject) => {
    const request = database.transaction('sessions').objectStore('sessions').getAll()
    request.onsuccess = () => resolve(request.result.sort((a: RecordingInfo, b: RecordingInfo) => b.started.localeCompare(a.started)))
    request.onerror = () => reject(request.error)
  })
}
export async function exportRecording(info: RecordingInfo): Promise<Blob> {
  await pending
  const database = await db()
  const parts = await new Promise<string[]>((resolve, reject) => {
    const request = database.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([info.id, 0], [info.id, Number.MAX_SAFE_INTEGER]))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return new Blob(parts, { type: 'application/x-ndjson' })
}
export async function deleteRecording(id: string) {
  if (session?.id === id) throw new Error('Stop recording before deleting it.')
  await pending
  await transaction(['sessions', 'chunks'], (tx) => {
    tx.objectStore('sessions').delete(id)
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
  })
}
