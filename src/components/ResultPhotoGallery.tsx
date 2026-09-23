import { useEffect, useState } from 'react'
import { L } from '../i18n'
import { deleteResultPhoto, getResultPhoto, listResultPhotos, type ResultPhoto } from '../lib/resultPhotos'

interface DisplayPhoto extends ResultPhoto {
  url: string
}

export default function ResultPhotoGallery() {
  const [photos, setPhotos] = useState<DisplayPhoto[]>([])
  const [selected, setSelected] = useState<DisplayPhoto | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const urls: string[] = []
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
        if (active) {
          setPhotos(loaded.filter((entry): entry is DisplayPhoto => entry !== null))
          setLoading(false)
        }
      } catch {
        if (active) {
          setError(true)
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const remove = async (photo: DisplayPhoto) => {
    if (!window.confirm(L('Delete this photo from this browser?', '从此浏览器删除这张照片？'))) return
    try {
      await deleteResultPhoto(photo.id)
      setSelected(null)
      setPhotos((current) => current.filter((entry) => entry.id !== photo.id))
      URL.revokeObjectURL(photo.url)
    } catch {
      setError(true)
    }
  }

  return (
    <section className="result-photo-gallery" aria-labelledby="photos-title" data-gesture-skip>
      <div className="result-photo-gallery-heading"><div><span className="kicker">{L('Saved on this device', '保存在此设备')}</span><h2 id="photos-title">{L('Photos', '照片')}</h2></div><span>{photos.length}</span></div>
      {error && <p role="alert">{L('Photos could not be loaded or changed in this browser.', '无法在此浏览器加载或修改照片。')}</p>}
      {loading && <p role="status">{L('Loading photos…', '正在加载照片…')}</p>}
      {!loading && !error && photos.length === 0 && <p>{L('Finish a song to add your first score photo here.', '完成一首歌曲后，得分照片会显示在这里。')}</p>}
      <div className="result-photo-grid">
        {photos.map((photo) => <article key={photo.id} className="result-photo-tile">
          <button className="result-photo-preview" onClick={() => setSelected(photo)} aria-label={L(`View photo for ${photo.songName}`, `查看 ${photo.songName} 的照片`)}><img src={photo.url} alt="" /></button>
          <strong>{photo.songName.replace(/\.[^.]+$/, '')}</strong>
          <span>{photo.score.toLocaleString()} · {new Date(photo.createdAt).toLocaleDateString()}</span>
          <div><a className="btn" href={photo.url} download={`dance-trance-${photo.id}.jpg`}>{L('Download', '下载')}</a><button className="btn subtle" onClick={() => void remove(photo)}>{L('Delete', '删除')}</button></div>
        </article>)}
      </div>
      {selected && <div className="result-photo-viewer" role="dialog" aria-modal="true" aria-label={L('Score photo', '得分照片')} onKeyDown={(event) => { if (event.key === 'Escape') setSelected(null) }}>
        <div><button className="btn" onClick={() => setSelected(null)} autoFocus>{L('Close', '关闭')}</button><img src={selected.url} alt={L(`Final score photo for ${selected.songName}`, `${selected.songName} 的最终得分照片`)} /><a className="btn primary" href={selected.url} download={`dance-trance-${selected.id}.jpg`}>{L('Download photo', '下载照片')}</a></div>
      </div>}
    </section>
  )
}
