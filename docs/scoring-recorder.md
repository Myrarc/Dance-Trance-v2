# Local scoring recorder

Settings → Scoring recorder → Record next round. Play a round, then export its data from Settings. The badge shows capture status; Stop recording saves a partial session. Each arm captures one round. Pause/resume is retained; restart closes the previous capture. The recorder is off on reload. Recordings remain local until explicitly exported and shared.

The NDJSON export contains a versioned header, ordered frame and judgment events, phase transitions, and a final result. It includes original reference data and scoring features, raw MediaPipe image/world landmarks for every detected person, filtered player poses, visibility, player selection/lock state, camera and song clocks, inference timing, model/delegate details, scoring settings, edited song data, and exact per-player scoring inputs/before/after states. The scorer source is embedded for later audits. Non-finite numbers use `{ "$number": "NaN" }` (or Infinity/-Infinity). No video/audio, account data, or camera device identifiers are recorded.

Writes are batched into a separate local IndexedDB database every 30 events or one second. Closing/crashing can lose the pending batch; interrupted captures are labelled and existing chunks remain exportable. Storage failures or a write backlog over 32 MB stop capture and display an error. Exports can be large, and recording/serialization adds work: compare captured inference metrics with normal play when diagnosing latency. Delete exports and local captures when no longer needed.

Replay judgments with the current scorer (Node with TypeScript support):

```sh
node scripts/replay-scoring.mjs path/to/dance-scoring-ID.ndjson
```

The command checks event continuity, recomputes every judgment and points update, prints differences, and exits nonzero if judgments differ or none were recorded. This is deterministic scoring replay, not a video replay interface. It cannot reconstruct camera frames that were never captured or rerun pose inference without video. Reference poses and available scoring inputs remain intact even if the library song is later removed.
