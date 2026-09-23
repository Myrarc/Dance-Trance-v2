# Single-Player Presence and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove single-player relocking everywhere and fairly pause/restart an Arcade song after a sustained camera dropout.

**Architecture:** Single-player pose selection becomes stateless after initial registration; two-player matching stays intact. A pure recovery state machine observes camera presence and controls an effective video/scoring phase in `App`. Missing-pose cue windows are neutral, never misses.

**Tech Stack:** React 19, TypeScript, MediaPipe Tasks Vision, Node test runner, Oxlint, Vite.

**Spec:** `docs/superpowers/specs/2026-09-23-single-player-tracking-recovery-design.md`

## Global Constraints

- Apply stateless pose selection on every single-player screen after initial right-hand registration; do not require hand-up to recover.
- Keep initial registration, menu gestures, and two-player matching behavior.
- Song pause debounce is one second of no usable pose; reacquisition hold is 500 ms; restart countdown is 3-2-1.
- Keep camera frames and pose landmarks local; add no dependencies or face recognition.
- Preserve existing uncommitted work in pose, gesture, camera, and CSS files.

## Review Focus

- A bystander becomes the largest eligible body: single-player control intentionally transfers to them; test selection order.
- Empty or low-visibility pose output: no active player and no scoring; test both cases.
- Multiple consecutive missing frames: one pause transition only; test state stability.
- Pose vanishes during 3-2-1: countdown cancels; test reset and a new full hold.
- Manual pause or leaving Arcade: recovery cannot auto-resume; test phase gating and reset.

---

### Task 1: Stateless single-player pose selection

**Files:** Modify `src/pose/playerLock.ts`, `src/components/WebcamPanel.tsx`, `tests/playerLock.test.ts`.

**Interfaces:** Produce `primarySoloCandidate(poses: NormalizedLandmark[][]): number | null`. `WebcamPanel` uses it after single-player registration in all screens, while preserving `matchPlayerLock` for two players.

- [ ] Write tests in `tests/playerLock.test.ts` that select the largest visible torso, return null for empty/invalid poses, and select a newly visible pose even after a >1-second absence with no raised hand. Production change that makes these fail: choosing a different index or applying the old lock gate.

```ts
assert.equal(primarySoloCandidate([pose(0.2, 0.5), pose(0.8)]), 1)
assert.equal(primarySoloCandidate([]), null)
```
- [ ] Run `node --test tests/playerLock.test.ts`; confirm the new tests fail because `primarySoloCandidate` does not exist.
- [ ] Add the selector using the existing `anchor` validity rules; compare `scale` and return the winning index. Wire the single-player path in `WebcamPanel` to use the selector on every inference frame after initial registration, bypassing the previous lock branch and removing its single-player lost/relock warning. Keep the two-player branch unchanged.

```ts
const soloIndex = primarySoloCandidate(detected.map((player) => player.pose))
const indices = registrationPlayersRef.current === 1 && lobbyReadyRef.current
  ? [soloIndex]
  : (match?.indices ?? registrationIndices)
const matched = indices.map((index) => index === null ? null : detected[index])
```
- [ ] Run the focused test, then `npm test`; inspect failures before continuing.
- [ ] Commit only these files with `feat: select visible solo player without relock`.

### Task 2: Recovery timing state machine

**Files:** Create `src/game/trackingRecovery.ts`, `tests/trackingRecovery.test.ts`.

**Interfaces:** Produce `advanceTrackingRecovery(state: TrackingRecovery, present: boolean, nowMs: number): TrackingRecovery`, where mode is `'playing' | 'finding' | 'countdown'`, plus `initialTrackingRecovery` and `effectiveTrackingPhase(phase: GamePhase, recovery: TrackingRecovery): GamePhase`. Countdown remaining is derived from `nowMs`, not delayed callbacks. Non-playing phases ignore and reset recovery in `App`.

- [ ] Write table-style tests for 999 ms dropout (playing), 1000 ms dropout (finding), 500 ms stable return (countdown at 3), 3 seconds still present (playing), renewed loss during countdown (finding), and repeated missing frames (still finding). Production change that makes these fail: a premature pause, auto-resume without countdown, or uncancelled countdown.

```ts
let state = advanceTrackingRecovery(initialTrackingRecovery, false, 0)
assert.equal(advanceTrackingRecovery(state, false, 999).mode, 'playing')
state = advanceTrackingRecovery(state, false, 1000)
assert.equal(state.mode, 'finding')
```
- [ ] Run `node --test tests/trackingRecovery.test.ts`; confirm import/function failure.
- [ ] Implement only the state transitions and timestamps needed by those tests. Reset the reacquisition hold whenever presence is false. Expose the countdown digit via a pure helper if needed by UI.

```ts
export type TrackingRecovery = {
  mode: 'playing' | 'finding' | 'countdown'
  missingSince: number | null
  visibleSince: number | null
  countdownSince: number | null
}
export const initialTrackingRecovery: TrackingRecovery = {
  mode: 'playing', missingSince: null, visibleSince: null, countdownSince: null,
}
export function effectiveTrackingPhase(phase: GamePhase, recovery: TrackingRecovery): GamePhase {
  return phase === 'playing' && recovery.mode !== 'playing' ? 'paused' : phase
}
```
- [ ] Run the focused test and full `npm test`.
- [ ] Commit the new module and test with `feat: model solo tracking recovery`.

### Task 3: Neutralize unscorable cue windows

**Files:** Modify `src/pose/gameplay.ts`, `src/components/WebcamPanel.tsx`, `tests/gameplay.test.ts`.

**Interfaces:** Extend `judgeDueCues(player, match, time, cues, posePresent = true)` with an `observedWindow` field in `PlayerRound`. If a cue's window ends without any usable frame, advance `nextTarget` without changing `score`, `combo`, `miss`, or `judged`. Default `posePresent` to true to preserve existing callers and two-player behavior.

- [ ] Write a test with a cue wholly inside a missing-pose interval followed by a scored cue: the first cue is neutral and preserves combo; the second still scores normally. Add a second test where part of a cue window had a valid scored sample, which must retain normal grading. Production change that makes these fail: treating camera absence as `null` match and recording a miss, or skipping a legitimate sample.

```ts
let round = { ...newPlayerRound(), combo: 2 }
round = judgeDueCues(round, null, 1, targets, false)
round = judgeDueCues(round, null, 1 + HIT_WINDOW_S, targets, false)
assert.equal(round.miss, 0)
assert.equal(round.combo, 2)
assert.equal(round.nextTarget, 1)
```
- [ ] Run `node --test tests/gameplay.test.ts`; confirm expected failure.
- [ ] Track `observedWindow` when a usable frame occurs in a cue window. At cue finalization, grade as before if observed; otherwise advance just the cue cursor and clear transient cue state. Pass `!!frame` from `WebcamPanel` while always judging from fresh frames only.

```ts
const after = judgeDueCues(before, scoreMatch, target.time, target.cueChart, frame !== null)
```
- [ ] Run the focused test and full `npm test`.
- [ ] Commit only scoring files with `fix: keep camera dropouts neutral for scoring`.

### Task 4: Wire recovery to playback and UI

**Files:** Modify `src/App.tsx`, `src/components/WebcamPanel.tsx`, `src/index.css`, `tests/trackingRecovery.test.ts`; modify `src/components/VideoPanel.tsx` only if the existing effective `paused` phase cannot preserve video position.

**Interfaces:** `WebcamPanel` reports usable solo presence from each inference frame to `App`. `App` advances `trackingRecovery`, sends an effective `'paused'` phase to video/scoring while finding/counting, and displays the recovery overlay; manual pause still uses the existing Pause overlay.

- [ ] Add pure-helper tests for manual pause winning over recovery and a pose lost during countdown returning to finding. Production change that makes these fail: recovery driving manual pause or ignoring renewed loss. Verify restart/quit reset during browser checks.

```ts
assert.equal(effectiveTrackingPhase('paused', { ...initialTrackingRecovery, mode: 'finding' }), 'paused')
assert.equal(effectiveTrackingPhase('playing', { ...initialTrackingRecovery, mode: 'finding' }), 'paused')
```
- [ ] Run `node --test tests/trackingRecovery.test.ts`; confirm new assertions fail.
- [ ] Wire camera presence reporting, recovery transitions, effective playback/scoring pause, and a large `Finding you` / `3-2-1` overlay. The camera loop must run during both states. Reset recovery on restart, quit, song change, and results. Keep camera errors paused with a camera-specific message.

```ts
const effectivePhase = effectiveTrackingPhase(arcadePhase, recovery)
<VideoPanel gamePhase={effectivePhase} />
<WebcamPanel gamePhase={effectivePhase} onSoloPresence={handleSoloPresence} />
```
- [ ] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; fix any failures without touching unrelated files.
- [ ] Manually check with webcam and local song: menu loss/return, short and long in-song loss, countdown cancellation, manual pause, restart, quit, and another visible person taking over. Report camera/browser checks separately from automated checks.
- [ ] Commit only implementation files with `feat: pause and restart after solo tracking loss`.
