# Song Editor Implementation Plan

**Goal:** Edit local song cue charts and playback bounds without replacing motion-based scoring.

**Architecture:** Persist a versioned song edit and separate draft in the existing local map store. The editor owns an isolated draft; playback reads only saved edits. Keep all timestamps in original video seconds. Existing reference poses and motion scoring remain authoritative.

**Tech Stack:** React, TypeScript, IndexedDB, Canvas, existing local media decoder.

**Approved design:** Library entry opens a video/timeline editor with waveform, scrubbing, step/slow/loop playback, marker add/move/delete/duplicate, undo/redo, exact timing/position/type/duration, difficulty charts, trim bounds, preview auto-hits, local drafts/save/reset, and lighting marks. User confirmed edited markers remain visual guides.

## Tasks
- [x] Data: validate and persist chart/draft documents, resolve focus-filtered visual cues, test empty charts and invalid edits, clean up on forget.
- [x] Editor: responsive preview/timeline/inspector; load original file and analysis; autosave drafts, explicit save, failure feedback and discard guard; waveform and lighting lane.
- [x] Integrate: Library entry point, saved visual cues in game/demo, trim-aware playback and scoring interval bounds with unchanged evidence calculation, lighting sync.
- [x] Verify: deterministic storage/cue/trim tests, npm test/lint/build, browser editor flow where available; report device-only limitations.

## Constraints and review focus
- Original videos are never rewritten or uploaded. Processing requires the app to remain open.
- Explicit empty charts override generated cues; absent difficulty charts use generated cues.
- Trimmed rounds must not overwrite full-song records; display this clearly.
- Missing videos can be reselected. Missing analysis must not prevent manual authoring.
- Unsaved/draft changes never leak into gameplay. Save failure keeps the draft.
- Original timestamps prevent trimming from shifting reference scoring or lighting.
- Keyboard editing must not trigger game navigation; respect reduced motion.
- Scope checkpoints keep storage, editor, integration and verification independently reviewable.

## Verification results
- 153 tests passed; lint and production build passed.
- Chrome with an existing local dance video: waveform, add/retime/hold/duplicate/undo, trim playback, saved edits, draft recovery, and discard verified. Test song restored to generated markers and full duration.
- Responsive editor checked at 390x844 and 1280x720, without horizontal overflow.
- Physical camera gameplay and missing-file reselection were not exercised in this verification; scoring evidence calculation is unchanged.
