# Single-player presence and tracking recovery

## Intent and scope

Across the single-player experience, pose-detection failure must never make the player perform a hand-up relock. Inference keeps running until a person is detected again. During an Arcade song, a dropout must not accumulate misses while the camera cannot score. Recovery should be automatic and visible from dance-floor distance. This change does not improve the pose model, alter two-player matching, or introduce facial recognition or stored biometric data.

The first right-hand registration to enter the experience and the menu gestures remain as they are. After that initial registration, the active single player on **every screen** is simply the primary eligible body currently visible in the camera. If people exchange places, the game may switch to the other person; that is the requested temporary trade-off.

## Player and recovery flow

For single player, choose the eligible pose with the largest visible torso in each inference frame. Do not apply the registered player's position, appearance, or hand-up relock gate after initial registration, including in the main menu and song picker. An empty frame simply produces no active pose; it does not erase registration or stop inference. Gestures work again as soon as an eligible pose returns, with no timed relock. Keep the existing lock path for two-player mode, which is outside this single-player change.

Treat missing usable pose frames as a dropout. A dropout shorter than one second does not stop the song. It also must not award points, add misses, or break the combo for cues whose scoring window had no usable pose. If the dropout reaches one second, pause the reference video at its current position and display a prominent **Finding you** state. This one-second threshold only debounces playback; it never invalidates or locks out the player. The camera inference loop continues while the video is paused.

When one usable pose has been continuously visible for 500 ms, replace that state with a 3-2-1 countdown. The video and cue clock remain paused throughout. If the pose disappears during the countdown, cancel it and return to **Finding you**. At the end of the countdown, resume playback at the paused position and resume normal scoring. A pose available again before the one-second pause threshold resumes normal play without a countdown. Outside a playing song, there is no automatic pause or countdown: the camera simply waits for a pose and continues as soon as one appears.

Manual pause is distinct from tracking pause: it retains the existing Pause overlay and never auto-resumes. Restart, leaving Arcade, changing songs, and ending a round clear recovery state. Camera errors or permission loss keep the game paused and show an actionable camera message rather than looping a countdown.

## Component boundaries

- `WebcamPanel` reports whether a usable single-player pose is present on each inference frame and supplies it to scoring. It does not decide when to pause or resume the song.
- A small deterministic recovery state helper owns dropout timing, the 500 ms reacquisition hold, countdown transitions, and cancellation. Its transitions are driven by observed frames and elapsed time, not an uncancellable timer.
- `App` owns the Arcade recovery state and passes an effective paused/playing phase to `VideoPanel` and `WebcamPanel`. The ordinary manual-pause path remains separate. The recovery UI overlays the playing layout and does not use the manual Pause overlay.
- Scoring skips only cue windows obscured by missing player frames; it retains prior score and combo. No old pose is reused as a scoring sample. The cue clock remains synchronized with the actual reference-video time when recovery resumes.

## Verification

Unit tests cover selection of the largest eligible single-player pose, menu gesture recovery after a prolonged absence, brief in-song dropout without a miss, pause at the threshold, stable reacquisition, countdown cancellation on renewed loss, and manual pause remaining manual. Run the full test, lint, and build commands. Then verify in the browser with a real camera and song: main-menu loss and return, a short in-song flicker, a longer loss, re-entry during countdown, another person becoming the sole visible dancer, and restart/quit while finding the player. Automated tests do not establish actual camera reliability.
