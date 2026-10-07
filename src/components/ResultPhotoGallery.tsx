import { useEffect, useRef, useState } from 'react'
import { L } from '../i18n'
import { MenuGuide } from './GameShell'
import { useModalFocus } from '../lib/useModalFocus'
import { deleteResultPhoto, getResultPhoto, listResultPhotos, type ResultPhoto } from '../lib/resultPhotos'

interface DisplayPhoto extends ResultPhoto {
  url: string
}

function PhotoViewer({ photo, onClose, onDelete }: { photo: DisplayPhoto; onClose: () => void; onDelete: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useModalFocus(ref)
  useEffect(() => { if (!confirming) ref.current?.querySelector<HTMLElement>('[data-gesture-default]')?.focus({ preventScroll: true }) }, [confirming])
  return <div ref={ref} className="result-photo-viewer distance-menu" role="dialog" aria-modal="true" aria-label="Score photo" data-gesture-surface data-menu-priority="2" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) { if (confirming) setConfirming(false); else onClose() } }
  }}>
    <div inert={confirming}>
      <div className="photo-viewer-actions"><button className="btn" data-menu-back data-gesture-default onClick={onClose}>Back to photos</button><a className="btn primary" href={photo.url} download={`dance-trance-${photo.id}.jpg`}>Download photo</a><button className="btn" onClick={() => setConfirming(true)}>Delete photo</button></div>
      <img src={photo.url} alt={`Final score photo for ${photo.songName}`} />
      <MenuGuide back="Back to photos" />
    </div>
    {confirming && <div className="photo-delete-confirm distance-menu" role="alertdialog" aria-modal="true" aria-label="Delete photo" data-gesture-surface data-menu-priority="3">
      <h2>Delete this photo?</h2><p>This removes it from this device.</p>
      {error && <p role="alert">Photo could not be deleted. Try again.</p>}
      <button className="btn" autoFocus data-menu-back data-gesture-default disabled={busy} onClick={() => setConfirming(false)}>Keep photo</button>
      <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); setError(false); void onDelete().catch(() => { setError(true); setBusy(false) }) }}>{busy ? 'Deleting…' : 'Delete photo'}</button>
    </div>}
  </div>
}

export default function ResultPhotoGallery({ onBack, onPlay }: { onBack?: () => void; onPlay?: () => void }) {
  const galleryRef = useRef<HTMLElement>(null)
  const [photos, setPhotos] = useState<DisplayPhoto[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<DisplayPhoto | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const photo = photos[Math.min(index, Math.max(0, photos.length - 1))]

  useEffect(() => {
    let active = true
    const urls: string[] = []
    setLoading(true)
    setError(false)
    void (async () => {
      try {
        const entries = await listResultPhotos()
        const loaded = await Promise.all(entries.map(async (entry) => {
          const image = await getResultPhoto(entry.id)
          if (!image) return null
          const url = URL.createObjectURL(image)
          urls.push(url)
          return { ...entry, url }
        }))
        if (active) { setPhotos(loaded.filter((entry): entry is DisplayPhoto => entry !== null)); setLoading(false) }
        else urls.forEach((url) => URL.revokeObjectURL(url))
      } catch {
        if (active) { setError(true); setLoading(false) }
      }
    })()
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [reload])

  useEffect(() => {
    if (!loading) galleryRef.current?.querySelector<HTMLElement>('[data-gesture-default]')?.focus({ preventScroll: true })
  }, [loading])

  const remove = async (photo: DisplayPhoto) => {
    await deleteResultPhoto(photo.id)
    setSelected(null)
    setPhotos((current) => current.filter((entry) => entry.id !== photo.id))
    URL.revokeObjectURL(photo.url)
  }
  const move = (step: number) => setIndex((current) => (current + step + photos.length) % photos.length)

  return <section ref={galleryRef} className="result-photo-gallery distance-menu" aria-labelledby="photos-title" data-gesture-surface data-menu-priority="1">
    <div className="result-photo-gallery-heading"><div><span className="kicker">{L('Saved on this device', '保存在此设备')}</span><h2 id="photos-title">{L('Photos', '照片')}</h2></div><div className="photo-gallery-tools"><span>{photos.length ? Math.min(index + 1, photos.length) : 0} / {photos.length}</span>{onPlay && <button className="btn" onClick={onPlay}>Play a song</button>}{onBack && <button className="btn" data-menu-back onClick={onBack}>Back to Home</button>}</div></div>
    {error && <div role="alert"><p>Photos could not be loaded in this browser.</p><button className="btn" data-gesture-default onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
    {loading && <p role="status">{L('Loading photos…', '正在加载照片…')}</p>}
    {!loading && !error && photos.length === 0 && <p>{L('Finish a song to add your first score photo here.', '完成一首歌曲后，得分照片会显示在这里。')}</p>}
    {!loading && photo && <article className="result-photo-feature">
      <button className="result-photo-preview" data-gesture-default data-gesture-label="Open photo" onClick={() => setSelected(photo)} aria-label={`Open photo for ${photo.songName}`}><img src={photo.url} alt="" /><span>Open photo</span></button>
      <div className="result-photo-caption"><strong>{photo.songName.replace(/\.[^.]+$/, '')}</strong><span>{photo.score.toLocaleString()} · {new Date(photo.createdAt).toLocaleDateString()}</span></div>
      <nav className="photo-browse-actions" aria-label="Browse photos"><button className="btn" disabled={photos.length < 2} onClick={() => move(-1)}>Previous photo</button><button className="btn" disabled={photos.length < 2} onClick={() => move(1)}>Next photo</button></nav>
    </article>}
    <MenuGuide back="Home" />
    {selected && <PhotoViewer photo={selected} onClose={() => setSelected(null)} onDelete={() => remove(selected)} />}
  </section>
}
