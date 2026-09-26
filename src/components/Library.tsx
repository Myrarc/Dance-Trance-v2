import { useMemo, useRef, useState } from 'react'
import { formatDuration, type LibraryEntry } from '../lib/library'
import { T, L } from '../i18n'
import type { VideoStats } from '../playkitClient'
import type { ArcadeRecord } from '../game/records'

interface Props {
  intent?: 'play' | 'edit'
  entries: LibraryEntry[]
  stats: Map<string, VideoStats>
  records?: ArcadeRecord[]
  currentId: string | null
  selectedId?: string | null
  onOpen: (entry: LibraryEntry) => void
  onPreview?: (entry: LibraryEntry) => void
  onForget: (entry: LibraryEntry) => void | Promise<void>
  onEdit?: (entry: LibraryEntry) => void
  /** Shown when the list is empty, i.e. before anything has been loaded. */
  emptyHint?: string
}

function when(ts: number): string {
  if (!ts) return ''
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export default function Library({ intent = 'play', entries, stats, records = [], currentId, selectedId, onOpen, onPreview, onForget, onEdit, emptyHint }: Props) {
  const [removing, setRemoving] = useState<LibraryEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmation = useRef<HTMLDialogElement>(null)
  const bestByVideo = useMemo(() => {
    const best = new Map<string, ArcadeRecord>()
    for (const record of records) {
      if (record.playerSlot !== 1 || record.bestScore <= (best.get(record.videoId)?.bestScore ?? -1)) continue
      best.set(record.videoId, record)
    }
    return best
  }, [records])

  if (!entries.length) {
    return emptyHint ? <p className="library-empty">{emptyHint}</p> : null
  }

  return (
    <><ul className="library" aria-label={intent === 'edit' ? 'Songs to edit' : 'Song library'}>
      {entries.map((entry) => {
        const s = stats.get(entry.id)
        const best = bestByVideo.get(entry.id)
        const missing = !entry.hasVideo
        const title = entry.name.replace(/\.[^.]+$/, '')
        return (
          <li
            key={entry.id}
            className={`library-item${entry.id === currentId ? ' is-current' : ''}${entry.id === selectedId ? ' is-gesture-selected' : ''}${missing ? ' is-missing' : ''}`}
          >
            <button
              className="library-open"
              data-track-id={entry.id}
              data-gesture-label={title}
              data-needs-file={missing && intent !== 'edit' ? true : undefined}
              onFocus={() => onPreview?.(entry)}
              onClick={() => onOpen(entry)}
              aria-current={entry.id === selectedId ? 'true' : undefined}
              title={intent === 'edit' ? `${L('Edit', '编辑')} ${entry.name}` : missing ? `${entry.name} — pick this file again to reload it` : entry.name}
            >
              <span className="library-thumb">
                {entry.thumb ? <img src={entry.thumb} alt="" /> : <span className="library-thumb-blank" />}
                {entry.duration > 0 && <span className="library-time">{formatDuration(entry.duration)}</span>}
              </span>
              <span className="library-meta">
                <span className="library-name">{title}</span>
                <span className="library-sub">
                  {intent === 'edit' ? missing ? L('Edit beatmap · reselect video in editor', '编辑谱面 · 在编辑器中重新选择视频') : L('Edit beatmap', '编辑谱面') : missing ? L('Add video again to play', '重新添加视频以开始游戏') : when(entry.lastOpenedAt)}
                  {s ? ` · ${Math.max(1, Math.round(s.seconds / 60))} min · best ${s.bestMatch}` : ''}
                  {best ? ` · ${T('record')} ${best.bestScore.toLocaleString()} · ${T('grade')} ${best.bestGrade}` : ''}
                </span>
              </span>
            </button>
            {onEdit && <button className="btn library-edit" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.name}`}>Edit song</button>}
            <button
              className="library-forget"
              data-gesture-skip
              onClick={() => { setRemoving(entry); setError(''); confirmation.current?.showModal() }}
              title={T('Remove from library')}
              aria-label={`Remove ${entry.name} from library`}
            >
              &times;
            </button>
          </li>
        )
      })}
    </ul>
    <dialog ref={confirmation} className="remove-song-dialog" aria-labelledby="remove-song-title" onCancel={(event) => { if (busy) event.preventDefault() }}>
      <h2 id="remove-song-title">{L('Remove this song?', '移除此歌曲？')}</h2>
      <p><strong>{removing?.name}</strong></p>
      <p>{L('This deletes the local video, analysis, custom markers, draft edits, and lighting for this song. This cannot be undone. Your original file is unchanged.', '这将删除此歌曲的本地视频、分析、自定义标记、编辑草稿和灯光。此操作无法撤销。原始文件不受影响。')}</p>
      {error && <p role="alert">{error}</p>}
      <div><button className="btn" autoFocus disabled={busy} onClick={() => confirmation.current?.close()}>{T('Cancel')}</button>
      <button className="btn" disabled={busy || !removing} onClick={async () => {
        if (!removing) return
        setBusy(true)
        try { await onForget(removing); confirmation.current?.close(); setRemoving(null) }
        catch (e) { setError(`${L('Could not remove song', '无法移除歌曲')}: ${String(e)}`) }
        finally { setBusy(false) }
      }}>{busy ? L('Removing…', '移除中…') : L('Remove song and edits', '移除歌曲和编辑')}</button></div>
    </dialog></>
  )
}
