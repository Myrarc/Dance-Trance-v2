/* oxlint-disable react/only-export-components -- shared translation functions and the language store live together */
// Tiny i18n with graceful fallback, ported from Investment Time Machine.
// T(s) looks the English string up in the zh dictionary; anything missing
// stays English — a gap can never break the UI. The chosen language is
// remembered; first visit follows the browser language.
import { useSyncExternalStore } from 'react'
import { ZH } from './i18n-zh'

const KEY = 'dt_lang'

let lang: 'en' | 'zh' = (() => {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'zh' || saved === 'en') return saved
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
})()

const listeners = new Set<() => void>()

export function getLang() {
  return lang
}

export function setLang(next: 'en' | 'zh') {
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // private mode — the toggle still works for this visit
  }
  for (const fn of listeners) fn()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Re-render the calling component whenever the language changes. */
export function useLangTick() {
  return useSyncExternalStore(subscribe, getLang)
}

/** Translate a dictionary string (falls back to the English original). */
export function T(s: string): string {
  if (lang !== 'zh' || s == null) return s
  return ZH[s] ?? s
}

/** Pick between two hand-written variants (for interpolated strings). */
export function L(en: string, zh: string) {
  return lang === 'zh' ? zh : en
}
