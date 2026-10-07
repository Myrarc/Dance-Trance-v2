import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'
import { T } from '../i18n'

export default function UpdateToast({ deferred = false }: { deferred?: boolean }) {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (!offlineReady || needRefresh || deferred) return
    const timer = window.setTimeout(() => setOfflineReady(false), 5000)
    return () => window.clearTimeout(timer)
  }, [offlineReady, needRefresh, deferred, setOfflineReady])

  if (deferred || (!offlineReady && !needRefresh)) return null
  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }
  return (
    <aside className={`update-toast${needRefresh ? ' distance-menu' : ' offline-notice'}`} role="status" data-gesture-surface={needRefresh ? '' : undefined} data-menu-priority="3">
      <strong>{T(needRefresh ? 'Update ready' : 'Ready to play offline')}</strong>
      <span>{T(needRefresh ? 'Reload when you are ready for the latest version.' : 'App ready offline. Keep your dance videos saved on this device.')}</span>
      {needRefresh && <div>
        {needRefresh && <button className="btn primary" onClick={() => void updateServiceWorker(true)}>{T('Reload')}</button>}
        <button className="btn subtle" data-menu-back data-gesture-default onClick={close}>{T('Not now')}</button>
      </div>}
    </aside>
  )
}
