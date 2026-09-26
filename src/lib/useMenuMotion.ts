import { useEffect, useLayoutEffect, useRef } from 'react'

const surfaces: Record<string, string> = {
  home: '.home-screen', tracking: '.tracking-screen', editor: '.editor-screen', photos: '.photos-screen',
  songs: '.track-picker', focus: '.difficulty-screen', difficulty: '.difficulty-screen',
  settings: '.settings-screen', pause: '.pause-card',
}

/** Visual feedback only: never delay navigation or remount media/camera elements. */
export function useMenuMotion(view: string, reduced: boolean) {
  const root = useRef<HTMLDivElement>(null)
  const running = useRef(new Set<Animation>())

  useEffect(() => {
    const host = root.current
    if (!host) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const feedbackAnimations = new Set<Animation>()
    const cancel = () => { running.current.forEach((animation) => animation.cancel()); running.current.clear() }
    const feedback = (event: MouseEvent) => {
      if (reduced || preference.matches || !surfaces[view]) return
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
      if (!button || button.disabled || button.closest('.song-editor, .beat-lab')) return
      const bounds = button.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const burst = document.createElement('span')
      burst.className = 'menu-click-burst'
      burst.setAttribute('aria-hidden', 'true')
      burst.style.left = `${bounds.left + bounds.width / 2}px`
      burst.style.top = `${bounds.top + bounds.height / 2}px`
      host.append(burst)
      const pulse = burst.animate([
        { transform: 'translate(-50%, -50%) scale(.35) rotate(-15deg)', opacity: .85 },
        { transform: 'translate(-50%, -50%) scale(1.6) rotate(15deg)', opacity: 0 },
      ], { duration: 300, easing: 'ease-out' })
      const press = button.animate([{ scale: '.96' }, { scale: '1.035', offset: .55 }, { scale: '1' }], { duration: 260, easing: 'ease-out' })
      for (const animation of [pulse, press]) {
        feedbackAnimations.add(animation)
        running.current.add(animation)
        animation.finished.catch(() => {}).finally(() => { feedbackAnimations.delete(animation); running.current.delete(animation); if (animation === pulse) burst.remove() })
      }
    }
    host.addEventListener('click', feedback, true)
    preference.addEventListener('change', cancel)
    return () => { host.removeEventListener('click', feedback, true); preference.removeEventListener('change', cancel); feedbackAnimations.forEach((animation) => animation.cancel()) }
  }, [reduced, view])

  useLayoutEffect(() => {
    if (reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const surface = surfaces[view] && root.current?.querySelector(surfaces[view])
    if (!surface) return
    const items = Array.from(surface.children).filter((item) => item instanceof HTMLElement && item.getClientRects().length > 0)
    const animations = items.map((item, index) => item.animate([
      { opacity: 0, translate: '0 22px', scale: '.98' },
      { opacity: 1, translate: '0 -3px', scale: '1.005', offset: .75 },
      { opacity: 1, translate: '0 0', scale: '1' },
    ], { duration: 360, delay: Math.min(index, 4) * 35, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }))
    const active = running.current
    animations.forEach((animation) => active.add(animation))
    return () => animations.forEach((animation) => { animation.cancel(); active.delete(animation) })
  }, [view, reduced])

  return root
}
