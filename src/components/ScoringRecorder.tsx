import { useEffect, useState, useSyncExternalStore } from 'react'
import { armRecorder, recorderSnapshot, subscribeRecorder, listRecordings, exportRecording, deleteRecording, type RecordingInfo } from '../lib/scoringRecorder'

export function RecordingBadge() {
  const state = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot)
  if (!state.active && !state.armed && !state.message.startsWith('Recording stopped:')) return null
  return <aside className="scoring-recording-badge" role="status">{state.message}{state.active && <button className="btn" onClick={() => armRecorder(false)}>Stop recording</button>}</aside>
}
export default function ScoringRecorder() {
  const state = useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot)
  const [items, setItems] = useState<RecordingInfo[]>([])
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const refresh = () => listRecordings().then(setItems).catch((e) => setError(String(e)))
  useEffect(() => { void refresh() }, [state])
  return <section className="settings-card">
    <h2>Scoring recorder</h2>
    <p>Capture the next round’s complete pose and scoring data on this device. Includes both players, raw and filtered skeletons, reference poses, timing, tracking diagnostics, and every judgment. No camera video or audio. Exports contain body movement data; share them only when you choose.</p>
    <button className="btn primary" disabled={state.saving} onClick={() => armRecorder(!state.armed && !state.active)}>{state.active ? 'Stop recording' : state.armed ? 'Cancel recording' : 'Record next round'}</button>
    <p role="status">{state.message}</p>
    <p>Pauses stay in the recording. Replays are separate rounds: arm again to capture another. Full data can use substantial storage.</p>
    {error && <p role="alert">{error}</p>}
    {items.map((item) => <div key={item.id} className="recording-item">
      <strong>{item.song}</strong><p>{new Date(item.started).toLocaleString()} · {(item.bytes / 1048576).toFixed(1)} MB · {item.status}</p>
      <button className="btn" disabled={state.active} onClick={async () => {
        try {
          const blob = await exportRecording(item)
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a'); link.href = url; link.download = `dance-scoring-${item.id}.ndjson`; link.click()
          setTimeout(() => URL.revokeObjectURL(url), 60000)
        } catch (e) { setError(String(e)) }
      }}>Export data</button>
      <button className="btn" disabled={state.active} onClick={() => setDeleting(item.id)}>Delete recording</button>
      {deleting === item.id && <div role="alert">Delete this recording permanently? <button className="btn" onClick={async () => { try { await deleteRecording(item.id); setDeleting(null); await refresh() } catch (e) { setError(String(e)) } }}>Confirm delete</button><button className="btn" onClick={() => setDeleting(null)}>Cancel</button></div>}
    </div>)}
  </section>
}
