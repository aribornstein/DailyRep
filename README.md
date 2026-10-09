# DailyRep

DailyRep is a progressive bodyweight trainer that runs entirely in the browser. It is a single-page PWA with no backend, no account and no build step. Install it to your phone's home screen and it works offline.

Each exercise follows a linear plan from your current max to a goal max (for example 30 → 100 push-ups over 100 days). Every day is five sets at 85 / 80 / 75 / 70 / 65 % of that day's target max, with rest periods that adapt to how the previous set went.

| Exercise | Counting | Phone placement |
|---|---|---|
| Push-ups | Tap (nose/chin on the screen) | On the floor under your face |
| Pull-ups | Accelerometer (vertical motion) | Front pocket, screen on |
| Squats | Accelerometer (thigh tilt) | Front trouser pocket, screen on |
| Sit-ups | Accelerometer (torso tilt) | Flat against your chest |

## Features

- **Daily plan** with a full-plan view; tap any day to jump to it.
- **Guided sessions:** big rep counter with a progress ring, auto-advance when a set's target is hit, slide-to-finish for early finishes, ±1 correction buttons.
- **Adaptive rest:** shorter if you beat the target, longer if you fell short. +30 s / skip buttons and a spoken 5-second countdown.
- **Motion rep counting** for pull-ups, squats and sit-ups, with a live status/level meter and per-exercise sensitivity.
- **Survives the phone locking:** the screen is kept awake during a workout, and the session is saved after every rep (details below).
- **Progress:** streak, 7-day activity, best set, best day, lifetime reps, history with goal status, and a max-test mode.
- **Data stays on the device:** stored in `localStorage`. Export/import all exercises as JSON.

## Running it

Any static file server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

On an iPhone, motion sensors and service workers need **HTTPS**, for example GitHub Pages, Netlify, or a tunnel such as `cloudflared tunnel --url http://localhost:8000`. Open the URL in Safari, choose **Share → Add to Home Screen**, then launch it from the icon.

## How the iPhone lock / resume handling works

iOS freezes JavaScript timers and sensor events while the screen is locked or the app is in the background, and may evict the page completely. DailyRep handles this as follows:

1. **The screen stays on** during a workout via the Screen Wake Lock API, so the phone does not auto-lock. The lock is re-acquired whenever the app becomes visible again.
2. **The rest timer runs on wall-clock time** (`restEndsAt`), not on interval ticks. After unlocking, the countdown shows the correct time, or the next set has already started. Stale countdown numbers are not spoken.
3. **The session is saved after every change** (`dailyrep:active_session_v1`). If iOS reloads the page, the workout reopens on the same set with the same rest timer. Saved sessions expire after 6 hours or at midnight.
4. **Audio and speech are re-unlocked** on the next touch after returning, because iOS suspends the audio context on lock.
5. **The motion detector resets its filters** after a gap in sensor data, so unlocking or pocketing the phone does not create phantom reps. If iOS needs motion permission again after a reload, the counter shows "Tap here to enable auto-count".

**Limits:**
- A web app cannot run code or play sounds while the phone is locked, so there is no "rest over" beep on a locked screen.
- Motion counting only works while the screen is on, so don't press the lock button during a motion set.

## Motion counting

Detection is in [js/rep-detector.js](js/rep-detector.js). It is pure logic with no DOM, so it can be unit-tested in Node.

- **Vertical mode (pull-ups):**
  - It separates gravity from body movement with a slow filter, then looks only at movement along gravity. This works for any phone orientation and either platform sign convention.
  - A rep is an upward push followed by a slowdown at the top. Dead-hang pauses, top holds and slow or fast reps each count once.
  - Counting arms only after a brief still hang, and anything faster than walking pace disarms it. Walking to the bar doesn't add reps.
  - The old detector required more than 4 m/s² of total acceleration change. Realistic pull-ups peak around 2–3 m/s², so it missed most reps, and it could count both the up and down halves.
- **Tilt mode (squats, sit-ups):** it records the phone's resting orientation once you are still, then counts each time the thigh or torso rotates past a threshold (40° by default) and comes back. Quarter squats don't count. The resting orientation re-centers slowly to handle the phone shifting in a pocket.
- **Sensitivity** (Settings) scales the thresholds:
  - **Low:** fewer false reps.
  - **High:** catches slow pull-ups and crunch-sized sit-ups.

## Project layout

```
index.html            markup (Ionic web components from CDN)
css/app.css           theme and layout
js/app.js             app logic: plan, sessions, persistence, UI
js/rep-detector.js    accelerometer rep detection (browser + Node)
service-worker.js     offline cache (app shell precache + CDN runtime cache)
manifest.json         PWA manifest
tests/                node:test unit tests for the detector
```

## Tests

```sh
node --test
```

The detector tests generate physics-based synthetic sensor data with these conditions:
- random phone orientations and sensor noise
- leg swing
- dead-hang and top pauses
- slow and fast reps
- walking
- quarter squats
- gaps from a locked screen

---

## Feature plan: toward a top-tier "get in shape" app

The guiding constraint is to stay a client-side SPA: everything runs on the device and any sync is optional.

### Phase 1: Trust the numbers
1. **Onboarding max test:** the first launch runs a max test per exercise and sets the starting max and goal from it, instead of using defaults.
2. **Motion calibration:** do 3 reps with ±1 corrections, then fit the thresholds to the user and their phone placement. Store the result per exercise.
3. **Adaptive progression:**
   - Two missed days in a row → automatic repeat or deload.
   - Beating every set by 20% or more → skip ahead.
   - Optional effort rating (RPE) after each session to fine-tune this.
4. **Scheduling:** 3, 4, 5 or 7 training days per week, with rest days that don't break the streak.
5. **Self-host Ionic and Ionicons** so the first load works offline and has no CDN dependency.

### Phase 2: Habit and motivation
1. Streak freezes, weekly goals, and a weekly recap screen.
2. Charts: target versus actual over time, estimated max trend, and volume per week (canvas/SVG, no library).
3. Achievements: first 50-rep set, 30-day streak, plan complete, and similar.
4. Shareable progress cards, rendered to an image and sent through the Web Share API.
5. Reminders:
   - Web Push on iOS 16.4+ for home-screen apps. This needs a small push sender, so it would be optional.
   - Fallback: an `.ics` calendar export of training days.

### Phase 3: Complete "get into shape" programs
1. **More exercises:**
   - Lunges and step-ups (tilt mode).
   - Burpees and jumping jacks (vertical mode).
   - Dips (vertical mode).
   - Plank and wall-sit timers.
2. **Program templates:** for example, an 8-week beginner full-body plan that combines several exercises per day, with progressive circuits.
3. **Workout formats:** guided warm-up and mobility timers, plus EMOM, AMRAP and Tabata modes.
4. **Form cues:** short text and animation per exercise, and rep tempo feedback from the motion signal (for example "slow down the descent").

### Phase 4: On-device intelligence
1. **Camera counting with form feedback**, using an on-device pose model (MediaPipe / TensorFlow.js MoveNet) that runs entirely in the browser. Useful for push-ups and squats without holding the phone.
2. **Fatigue-aware rest:** use rep tempo slowdown within a set to suggest a longer rest.

### Phase 5: Data and platform
1. **Optional sync without accounts:** an encrypted backup file to iCloud Drive or Files through the share sheet, or a user-supplied WebDAV/S3 endpoint.
2. **CSV export** for spreadsheets.
3. **Heart-rate straps via Web Bluetooth**, on Android and desktop only (iOS Safari doesn't support it).
4. **Quality:**
   - Playwright end-to-end tests in CI.
   - Unit tests for the plan and rest logic.
   - Lighthouse PWA/accessibility budget.
   - Translations.
   - Reduced-motion and larger-text support.
