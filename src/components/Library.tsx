import { useMemo } from 'react'
import { formatDuration, type LibraryEntry } from '../lib/library'
import { T, L } from '../i18n'
import type { VideoStats } from '../playkitClient'
import type { ArcadeRecord } from '../game/records'

interface Props {
  entries: LibraryEntry[]
  stats: Map<string, VideoStats>
  records?: ArcadeRecord[]
  currentId: string | null
  selectedId?: string | null
  onOpen: (entry: LibraryEntry) => void
  onPreview?: (entry: LibraryEntry) => void
  onForget: (entry: LibraryEntry) => void
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

export default function Library({ entries, stats, records = [], currentId, selectedId, onOpen, onPreview, onForget, onEdit, emptyHint }: Props) {
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
    <ul className="library" aria-label="Song library">
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
              data-needs-file={missing ? true : undefined}
              onFocus={() => onPreview?.(entry)}
              onClick={() => onOpen(entry)}
              aria-current={entry.id === selectedId ? 'true' : undefined}
              title={missing ? `${entry.name} — pick this file again to reload it` : entry.name}
            >
              <span className="library-thumb">
                {entry.thumb ? <img src={entry.thumb} alt="" /> : <span className="library-thumb-blank" />}
                {entry.duration > 0 && <span className="library-time">{formatDuration(entry.duration)}</span>}
              </span>
              <span className="library-meta">
                <span className="library-name">{title}</span>
                <span className="library-sub">
                  {missing ? L('Add video again to play', '重新添加视频以开始游戏') : when(entry.lastOpenedAt)}
                  {s ? ` · ${Math.max(1, Math.round(s.seconds / 60))} min · best ${s.bestMatch}` : ''}
                  {best ? ` · ${T('record')} ${best.bestScore.toLocaleString()} · ${T('grade')} ${best.bestGrade}` : ''}
                </span>
              </span>
            </button>
            {onEdit && <button className="btn library-edit" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.name}`}>Edit song</button>}
            <button
              className="library-forget"
              data-gesture-skip
              onClick={() => onForget(entry)}
              title={T('Remove from library')}
              aria-label={`Remove ${entry.name} from library`}
            >
              &times;
            </button>
          </li>
        )
      })}
    </ul>
  )
}
