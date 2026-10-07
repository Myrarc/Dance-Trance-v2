import { useEffect, type RefObject } from 'react'

export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = ref.current
    const focusableElements = () => modal
      ? [...modal.querySelectorAll<HTMLElement>('button, input, summary, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('disabled') && !element.closest('[inert], [hidden]') && element.getClientRects().length > 0)
      : []
    const focusFrame = requestAnimationFrame(() => (modal?.querySelector<HTMLElement>('[data-gesture-default]') ?? focusableElements()[0])?.focus({ preventScroll: true }))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modal) return
      const focusable = focusableElements()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!modal.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref])
}
