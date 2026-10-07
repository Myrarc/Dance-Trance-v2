import type { MenuGesture } from '../pose/gestures'

export function activeMenuSurface(root: ParentNode = document) {
  const surfaces = [...root.querySelectorAll<HTMLElement>('[data-gesture-surface]')]
    .filter((surface) => surface.getClientRects().length > 0 && !surface.closest('[inert], [hidden]'))
  return surfaces.sort((a, b) => Number(a.dataset.menuPriority ?? 0) - Number(b.dataset.menuPriority ?? 0)).at(-1) ?? null
}

export function menuItems(surface = activeMenuSurface(), root: ParentNode = document): HTMLElement[] {
  if (!surface) return []
  const regions = [surface]
  if (surface.dataset.menuScope) regions.push(...root.querySelectorAll<HTMLElement>(`[data-gesture-extra="${surface.dataset.menuScope}"]`))
  return regions.flatMap((region) => [...region.querySelectorAll<HTMLElement>('button:not(:disabled), input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled), summary, a[href]')])
    .filter((item) => !item.closest('[data-gesture-skip], [inert], [hidden]') && !item.closest('details:not([open]) > :not(summary)') && item.getClientRects().length > 0)
}

export function menuItemLabel(item: HTMLElement) {
  return item.dataset.gestureLabel ?? item.getAttribute('aria-label') ??
    item.closest('label')?.querySelector('strong')?.textContent?.trim() ?? item.textContent?.trim() ?? ''
}

export function markMenuSelection(item: HTMLElement, focus = true) {
  document.querySelectorAll('[data-gesture-selected]').forEach((old) => old.removeAttribute('data-gesture-selected'))
  item.setAttribute('data-gesture-selected', 'true')
  if (focus) item.focus({ preventScroll: true })
  if (!item.closest('.song-carousel')) item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return menuItemLabel(item)
}

/** Arrow/confirm shortcuts must never consume text entry or fine timeline editing. */
export function menuKeyAction(key: string, editable: boolean, repeat = false): MenuGesture | null {
  if (editable) return null
  if (key === 'ArrowLeft' || key === 'ArrowUp') return 'previous'
  if (key === 'ArrowRight' || key === 'ArrowDown') return 'next'
  if (key === 'Enter' && !repeat) return 'confirm'
  if (key === 'Escape' && !repeat) return 'back'
  return null
}
