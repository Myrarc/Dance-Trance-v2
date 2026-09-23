export interface RegistrationSlot {
  holdSince: number | null
  confirmed: boolean
  missingSince: number | null
}

export interface RegistrationState {
  count: 1 | 2
  observed: 0 | 1 | 2
  observedSince: number
  slots: [RegistrationSlot, RegistrationSlot]
}

export interface RegistrationReading {
  present: boolean
  inZone: boolean
  raised: boolean
}

const emptySlot = (): RegistrationSlot => ({ holdSince: null, confirmed: false, missingSince: null })

export function initialRegistration(nowMs: number): RegistrationState {
  return { count: 1, observed: 0, observedSince: nowMs, slots: [emptySlot(), emptySlot()] }
}

/** A second player must stay visible before the layout expands; brief tracking losses cannot shrink it. */
export function selectRegistrationCount(state: RegistrationState, observed: 0 | 1 | 2, nowMs: number): RegistrationState {
  const next = observed === state.observed ? state : { ...state, observed, observedSince: nowMs }
  if (next.slots.some((slot) => slot.confirmed)) return next
  if (observed === 2 && next.count === 1 && nowMs - next.observedSince >= 500) {
    return { ...next, count: 2, slots: [emptySlot(), emptySlot()] }
  }
  if (observed === 1 && next.count === 2 && nowMs - next.observedSince >= 1500) {
    return { ...next, count: 1, slots: [emptySlot(), emptySlot()] }
  }
  return next
}

/** Confirm each player separately; their hand can come down while the other player finishes. */
export function advanceRegistration(
  state: RegistrationState,
  readings: RegistrationReading[],
  nowMs: number,
  holdMs = 1200,
): { state: RegistrationState; progress: number[]; ready: boolean } {
  const slots = state.slots.map((slot, index): RegistrationSlot => {
    if (index >= state.count) return emptySlot()
    const reading = readings[index]
    if (!reading?.present || !reading.inZone) {
      const missingSince = slot.missingSince ?? nowMs
      return nowMs - missingSince >= 1500 ? emptySlot() : { ...slot, holdSince: null, missingSince }
    }
    if (slot.confirmed) return { ...slot, missingSince: null }
    if (!reading.raised) return { ...slot, holdSince: null, missingSince: null }
    const holdSince = slot.holdSince ?? nowMs
    return { holdSince, confirmed: nowMs - holdSince >= holdMs, missingSince: null }
  }) as [RegistrationSlot, RegistrationSlot]
  const progress = slots.slice(0, state.count).map((slot) => slot.confirmed ? 1 :
    slot.holdSince === null ? 0 : Math.min(1, (nowMs - slot.holdSince) / holdMs))
  const ready = slots.slice(0, state.count).every((slot, index) => slot.confirmed &&
    !!readings[index]?.present && readings[index].inZone)
  return { state: { ...state, slots }, progress, ready }
}
