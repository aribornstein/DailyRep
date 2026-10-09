/* DailyRep: client-side progressive rep trainer. No build step; globals are intentional for console/test access. */
'use strict';

const $ = (id) => document.getElementById(id);

const EXERCISES = {
  pushups: {
    name: 'Push-ups', icon: 'body-outline', counting: 'tap', milestones: [25, 50, 100],
    defaults: { startMax: 30, goalMax: 100, baseRestSeconds: 90, minRestSeconds: 45, maxRestSeconds: 240 },
    howTo: 'Put the phone under your face and tap it with your nose or chin on each rep.'
  },
  pullups: {
    name: 'Pull-ups', icon: 'barbell-outline', counting: 'motion', motion: 'vertical', milestones: [5, 10, 20],
    defaults: { startMax: 3, goalMax: 8, baseRestSeconds: 150, minRestSeconds: 90, maxRestSeconds: 300 },
    howTo: 'Phone in a front pocket, screen on. Hang still for a second, then pull. Reps count at the top.',
    readyHint: 'Hang still to start counting'
  },
  squats: {
    name: 'Squats', icon: 'walk-outline', counting: 'motion', motion: 'vertical', milestones: [25, 50, 100],
    defaults: { startMax: 20, goalMax: 60, baseRestSeconds: 75, minRestSeconds: 45, maxRestSeconds: 180 },
    howTo: 'Hold the phone out at chest height. Stand still, then squat to parallel and stand tall. Reps count when you are back up.',
    readyHint: 'Stand still to start counting'
  },
  situps: {
    name: 'Sit-ups', icon: 'accessibility-outline', counting: 'motion', motion: 'chest', milestones: [25, 50, 100],
    defaults: { startMax: 15, goalMax: 50, baseRestSeconds: 75, minRestSeconds: 45, maxRestSeconds: 180 },
    howTo: 'Hold the phone flat against your chest with both hands. Lie back, then sit all the way up. Reps count at the top.',
    readyHint: 'Lie back to start counting'
  }
};
const INTENSITY = [0.85, 0.80, 0.75, 0.70, 0.65];
const SET_COUNT = INTENSITY.length;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const ACTIVE_EXERCISE_KEY = 'dailyrep_active_exercise_v1';
const ACTIVE_SESSION_KEY = 'dailyrep:active_session_v1';
const SESSION_MAX_AGE_MS = 6 * 3600 * 1000;
const LEGACY_PUSHUP_KEYS = {
  settings: 'pu100_settings_v4',
  start_date: 'pu100_start_date_v4',
  workouts: 'pu100_workouts_v4',
  max_single: 'pu100_max_single_v1',
  progress_day: 'pu100_progress_day_v1'
};

let activeExercise = EXERCISES[localStorage.getItem(ACTIVE_EXERCISE_KEY)] ? localStorage.getItem(ACTIVE_EXERCISE_KEY) : 'pushups';

const key = (kind, ex = activeExercise) => `dailyrep:${ex}:${kind}`;

function migrateLegacy() {
  for (const [kind, legacyKey] of Object.entries(LEGACY_PUSHUP_KEYS)) {
    if (localStorage.getItem(key(kind, 'pushups')) === null) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null) localStorage.setItem(key(kind, 'pushups'), legacy);
    }
  }
}
migrateLegacy();

function readJSON(k, fallback) {
  try {
    const raw = localStorage.getItem(k);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function clampInt(x, min, max) {
  const n = Math.trunc(Number(x));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function isoToday(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function loadSettings(ex = activeExercise) {
  const d = EXERCISES[ex].defaults;
  const defaults = {
    ...d, totalDays: 100, rounding: 'nearest', soundOn: true, voiceOn: true, sensitivity: 'normal'
  };
  const obj = readJSON(key('settings', ex), null);
  if (!obj || typeof obj !== 'object') return defaults;
  const num = (v, fb) => (Number.isFinite(v) ? v : fb);
  return {
    ...defaults,
    startMax: num(obj.startMax, num(obj.maxReps, defaults.startMax)),
    goalMax: num(obj.goalMax, defaults.goalMax),
    totalDays: clampInt(num(obj.totalDays, defaults.totalDays), 1, 365),
    baseRestSeconds: num(obj.baseRestSeconds, num(obj.restSeconds, defaults.baseRestSeconds)),
    minRestSeconds: num(obj.minRestSeconds, defaults.minRestSeconds),
    maxRestSeconds: num(obj.maxRestSeconds, defaults.maxRestSeconds),
    rounding: ['up', 'down', 'nearest'].includes(obj.rounding) ? obj.rounding : defaults.rounding,
    soundOn: obj.soundOn !== false,
    voiceOn: obj.voiceOn !== false,
    sensitivity: ['low', 'normal', 'high'].includes(obj.sensitivity) ? obj.sensitivity : defaults.sensitivity
  };
}
const saveSettings = (s, ex = activeExercise) => localStorage.setItem(key('settings', ex), JSON.stringify(s));

function loadProgressDay(ex = activeExercise) {
  return clampInt(localStorage.getItem(key('progress_day', ex)) || 1, 1, loadSettings(ex).totalDays);
}
function setProgressDay(day, ex = activeExercise) {
  const n = clampInt(day, 1, loadSettings(ex).totalDays);
  localStorage.setItem(key('progress_day', ex), String(n));
  return n;
}

function loadMaxSingle(ex = activeExercise) {
  const n = Number(localStorage.getItem(key('max_single', ex)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const saveMaxSingle = (n, ex = activeExercise) => localStorage.setItem(key('max_single', ex), String(Math.max(0, Math.trunc(n))));

function sanitizeWorkout(w) {
  if (!w || typeof w !== 'object' || typeof w.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) return null;
  if (!Array.isArray(w.sets)) return null;
  const sets = w.sets.slice(0, 10).map((r) => clampInt(r, 0, 9999));
  const out = { date: w.date, day: clampInt(w.day, 1, 365), sets, total: sets.reduce((a, b) => a + b, 0) };
  if (typeof w.completed === 'boolean') out.completed = w.completed;
  if (typeof w.partial === 'boolean') out.partial = w.partial;
  if (Number.isFinite(w.at) && w.at > 0) out.at = w.at;
  return out;
}
function loadWorkouts(ex = activeExercise) {
  const arr = readJSON(key('workouts', ex), []);
  if (!Array.isArray(arr)) return [];
  let settings = null;
  return arr.map(sanitizeWorkout).filter(Boolean).map((w) => {
    // Workouts saved before completion was recorded: derive it from the plan.
    if (w.completed === undefined || w.partial === undefined) {
      settings = settings || loadSettings(ex);
      const plan = getDayPlan(w.day, settings);
      if (w.partial === undefined) w.partial = w.sets.length < plan.sets.length || w.sets.some((r) => r === 0);
      if (w.completed === undefined) w.completed = !w.partial && w.sets.every((r, i) => r >= plan.sets[i]);
    }
    return w;
  });
}
const saveWorkouts = (arr, ex = activeExercise) => localStorage.setItem(key('workouts', ex), JSON.stringify(arr));

function upsertWorkout(workouts, w) {
  const idx = workouts.findIndex((x) => x.date === w.date && x.day === w.day);
  if (idx >= 0) workouts[idx] = w; else workouts.push(w);
  workouts.sort((a, b) => (a.date === b.date ? b.day - a.day : a.date < b.date ? 1 : -1));
  return workouts;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
function roundReps(x, mode) {
  if (mode === 'up') return Math.ceil(x);
  if (mode === 'down') return Math.floor(x);
  return Math.round(x);
}

function getDayPlan(day, settings) {
  const totalDays = settings.totalDays || 100;
  const d = clampInt(day, 1, totalDays);
  const goal = clampInt(settings.goalMax || 100, 1, 100000);
  const start = clampInt(settings.startMax || 1, 1, goal);
  const t = totalDays === 1 ? 1 : (d - 1) / (totalDays - 1);
  const targetMax = clampInt(roundReps(start + t * (goal - start), settings.rounding), 1, goal);
  const sets = INTENSITY.map((pct) => clampInt(roundReps(pct * targetMax, settings.rounding), 1, goal));
  for (let i = 1; i < sets.length; i += 1) if (sets[i] > sets[i - 1]) sets[i] = sets[i - 1];
  return { day: d, targetMax, sets, total: sets.reduce((a, b) => a + b, 0) };
}

function getRestSeconds(setIndex, targetReps, actualReps, settings) {
  const delta = actualReps - targetReps;
  const perf = delta >= 3 ? 0.8 : delta >= -2 ? 1 : delta >= -4 ? 1.2 : 1.4;
  const pos = [0.9, 1.0, 1.05, 1.1, 1.15][clampInt(setIndex, 0, 4)];
  return clampInt(Math.round(settings.baseRestSeconds * perf * pos), settings.minRestSeconds, settings.maxRestSeconds);
}

function statusForWorkout(w, plan) {
  if (w.sets.length === plan.sets.length && w.sets.every((r, i) => r >= plan.sets[i])) return { label: 'Goal hit', color: 'success' };
  if (w.total >= plan.total) return { label: 'On track', color: 'success' };
  if (w.total >= Math.floor(plan.total * 0.85)) return { label: 'Close', color: 'warning' };
  return { label: 'Below', color: 'danger' };
}

// ---------------------------------------------------------------------------
// Engagement: weekly goal, achievements, recaps (logic in js/engagement.js)
// ---------------------------------------------------------------------------
const GOAL_KEY = 'dailyrep:weekly_goal_v1';
const ACH_KEY = 'dailyrep:achievements_v1';
const RECAP_KEY = 'dailyrep:recap_v1';
const MOTIVATION_KEY = 'dailyrep:motivation_v1';

const loadGoalState = () => Engagement.normalizeGoalState(readJSON(GOAL_KEY, null));
const saveGoalState = (s) => localStorage.setItem(GOAL_KEY, JSON.stringify({ version: 1, history: s.history, freeze: s.freeze }));
const loadAwarded = () => Engagement.normalizeAwarded(readJSON(ACH_KEY, null));
const saveAwarded = (s) => localStorage.setItem(ACH_KEY, JSON.stringify(s));

function allByExercise() {
  const out = {};
  for (const ex of Object.keys(EXERCISES)) out[ex] = loadWorkouts(ex);
  return out;
}

function achievementDefs() {
  const meta = {};
  for (const [ex, cfg] of Object.entries(EXERCISES)) {
    const s = loadSettings(ex);
    meta[ex] = { name: cfg.name, goalMax: s.goalMax, totalDays: s.totalDays, milestones: cfg.milestones };
  }
  return Engagement.achievementDefs(meta);
}

function engagementContext(byEx = allByExercise()) {
  const maxSingles = {};
  const totalDays = {};
  for (const ex of Object.keys(EXERCISES)) {
    maxSingles[ex] = loadMaxSingle(ex);
    totalDays[ex] = loadSettings(ex).totalDays;
  }
  return Engagement.buildContext(byEx, { goalState: loadGoalState(), today: isoToday(), maxSingles, totalDays });
}

// retro: earned by data that already existed (startup, import), so stored undated and never celebrated.
function checkAchievements({ retro = false } = {}) {
  const current = loadAwarded();
  const results = Engagement.evaluate(achievementDefs(), engagementContext());
  const { state, newly } = Engagement.award(current, results, { now: Date.now(), retro });
  if (newly.length || !current.initialized) saveAwarded(state);
  return newly;
}

function lastTrainingDateBefore(dates, iso) {
  let last = null;
  for (const d of dates) if (d < iso && (!last || d > last)) last = d;
  return last;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const formatDate = (iso, opts = { month: 'short', day: 'numeric' }) => Engagement.parseISO(iso).toLocaleDateString(undefined, opts);

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function setRing(circle, fraction) {
  const r = Number(circle.getAttribute('r'));
  const c = 2 * Math.PI * r;
  circle.style.strokeDasharray = String(c);
  circle.style.strokeDashoffset = String(c * (1 - Math.max(0, Math.min(1, fraction))));
}

function toast(message, duration = 1600) {
  const t = el('ion-toast', { message, duration, position: 'top' });
  document.body.appendChild(t);
  t.addEventListener('didDismiss', () => t.remove());
  return t.present?.();
}

async function presentOverlay(node) {
  await customElements.whenDefined(node.tagName.toLowerCase());
  await node.componentOnReady?.();
  return node.present();
}
async function dismissOverlay(node) {
  if (!node) return;
  await customElements.whenDefined(node.tagName.toLowerCase());
  return node.dismiss?.();
}

async function confirmAlert(header, message, buttons) {
  const alert = el('ion-alert', { header, message, buttons });
  alert.cssClass = 'dark-alert';
  document.body.appendChild(alert);
  alert.addEventListener('didDismiss', () => alert.remove());
  await presentOverlay(alert);
}

const haptics = (ms = 40) => { try { navigator.vibrate?.(ms); } catch {} };

// ---------------------------------------------------------------------------
// Audio, speech, wake lock (iOS needs a user gesture to unlock audio)
// ---------------------------------------------------------------------------
let beepEl = null;
let audioCtx = null;

function getBeepEl() {
  if (!beepEl) {
    beepEl = new Audio('sounds/beep.wav');
    beepEl.preload = 'auto';
    beepEl.playsInline = true;
  }
  return beepEl;
}

function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS moves the context to "interrupted"/"suspended" after the screen locks.
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch {}
  const b = getBeepEl();
  if (!b.dataset.primed) {
    b.muted = true;
    Promise.resolve(b.play()).then(() => { b.pause(); b.currentTime = 0; b.muted = false; b.dataset.primed = '1'; })
      .catch(() => { b.muted = false; });
  }
  if (!speechPrimed && window.speechSynthesis) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      speechPrimed = true;
    } catch {}
  }
}
let speechPrimed = false;
['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAudio, { passive: true }));

function playBeep(freq = 880) {
  if (!loadSettings().soundOn) return;
  const b = getBeepEl();
  try {
    b.muted = false;
    b.currentTime = 0;
    const p = b.play();
    if (p && typeof p.catch === 'function') p.catch(() => oscBeep(freq));
    return;
  } catch {}
  oscBeep(freq);
}
function oscBeep(freq) {
  if (!audioCtx || audioCtx.state !== 'running') return haptics(40);
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth || !text || !loadSettings().voiceOn || document.visibilityState !== 'visible') return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = 1.05;
    synth.speak(u);
  } catch {}
}
const stopSpeech = () => { try { window.speechSynthesis?.cancel(); } catch {} };

let wakeLock = null;
let wakeWanted = false;
async function acquireWakeLock() {
  wakeWanted = true;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
function releaseWakeLock() {
  wakeWanted = false;
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}

// ---------------------------------------------------------------------------
// Motion counting
// ---------------------------------------------------------------------------
const motion = {
  permission: 'unknown', // unknown | granted | denied | unsupported
  detector: null,
  onRep: null,
  handler: null,
  lastEventAt: 0,
  startedAt: 0
};

function needsMotionPermission() {
  return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
}

// Must be called synchronously inside a user gesture on iOS.
function requestMotionPermission() {
  if (typeof DeviceMotionEvent === 'undefined') {
    motion.permission = 'unsupported';
    return Promise.resolve(false);
  }
  if (!needsMotionPermission() || motion.permission === 'granted') {
    motion.permission = 'granted';
    return Promise.resolve(true);
  }
  return DeviceMotionEvent.requestPermission()
    .then((r) => { motion.permission = r === 'granted' ? 'granted' : 'denied'; return r === 'granted'; })
    .catch(() => { motion.permission = 'denied'; return false; });
}

function startMotion(mode, onRep) {
  stopMotion();
  motion.onRep = onRep;
  if (motion.permission !== 'granted') return;
  motion.detector = RepDetector.create(mode, { sensitivity: loadSettings().sensitivity });
  motion.startedAt = Date.now();
  motion.lastEventAt = 0;
  motion.handler = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    motion.lastEventAt = Date.now();
    if (motion.detector.push(a.x, a.y, a.z, e.timeStamp / 1000)) motion.onRep?.();
  };
  window.addEventListener('devicemotion', motion.handler);
}

function stopMotion() {
  if (motion.handler) window.removeEventListener('devicemotion', motion.handler);
  motion.handler = null;
  motion.detector = null;
}

function motionStatus() {
  if (motion.permission === 'unsupported') return { cls: '', text: 'No motion sensor. Use +1.' };
  if (motion.permission === 'denied') return { cls: '', text: 'Motion access denied. Use +1.' };
  if (motion.permission !== 'granted') return { cls: 'wait', text: 'Tap here to enable auto-count' };
  if (!motion.detector) return { cls: '', text: 'Paused' };
  if (!motion.lastEventAt) {
    return Date.now() - motion.startedAt > 2000 ? { cls: '', text: 'No sensor data. Use +1.' } : { cls: 'wait', text: 'Starting sensor…' };
  }
  if (!motion.detector.ready()) {
    return { cls: 'wait', text: EXERCISES[session.active ? session.exercise : activeExercise].readyHint || 'Hold still to calibrate' };
  }
  return { cls: 'live', text: 'Counting reps' };
}

// ---------------------------------------------------------------------------
// Training session. Persisted on every change so iOS killing the page loses nothing.
// ---------------------------------------------------------------------------
const session = {
  active: false,
  exercise: activeExercise,
  date: null,
  day: 1,
  targets: [],
  actual: [],
  curIndex: 0,
  resting: false,
  restEndsAt: 0,
  restTotal: 0,
  restStartedAt: 0,
  lastSpoken: null
};
let restTicker = null;
let motionUiTicker = null;

const isMotionExercise = () => EXERCISES[session.exercise || activeExercise].counting === 'motion';
const restRemaining = () => Math.max(0, Math.ceil((session.restEndsAt - Date.now()) / 1000));

function persistSession() {
  if (!session.active) return localStorage.removeItem(ACTIVE_SESSION_KEY);
  const { exercise, date, day, targets, actual, curIndex, resting, restEndsAt, restTotal } = session;
  localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ exercise, date, day, targets, actual, curIndex, resting, restEndsAt, restTotal, savedAt: Date.now() }));
}

function loadSavedSession() {
  const s = readJSON(ACTIVE_SESSION_KEY, null);
  if (!s || !EXERCISES[s.exercise] || s.date !== isoToday() || Date.now() - (s.savedAt || 0) > SESSION_MAX_AGE_MS) {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    return null;
  }
  return s;
}

function startSession() {
  const settings = loadSettings();
  const day = loadProgressDay();
  const plan = getDayPlan(day, settings);
  Object.assign(session, {
    active: true,
    exercise: activeExercise,
    date: isoToday(),
    day,
    targets: plan.sets.slice(),
    actual: new Array(plan.sets.length).fill(0),
    curIndex: 0,
    resting: false,
    restEndsAt: 0,
    restTotal: 0,
    lastSpoken: null
  });
  persistSession();
  beginSet();
}

function resumeSession(saved) {
  Object.assign(session, saved, { active: true, lastSpoken: null, restStartedAt: 0 });
  if (session.resting) {
    startRestTicker();
    tickRest();
  } else {
    beginSet();
  }
}

function beginSet() {
  session.resting = false;
  stopRestTicker();
  if (isMotionExercise()) startMotion(EXERCISES[session.exercise].motion, () => addRep(1, 'motion'));
  acquireWakeLock();
  renderSessionUI();
}

function addRep(delta, source) {
  if (!session.active || session.resting) return;
  const i = session.curIndex;
  const prev = session.actual[i];
  session.actual[i] = clampInt(prev + delta, 0, 9999);
  if (session.actual[i] === prev) return;
  if (delta > 0) {
    playBeep();
    haptics(source === 'motion' ? 60 : 20);
    flashTap();
  }
  persistSession();
  renderSessionUI();
  if (delta > 0 && session.actual[i] >= session.targets[i]) completeSet();
}

function completeSet() {
  if (!session.active || session.resting) return;
  const i = session.curIndex;
  if (i >= session.targets.length - 1) {
    finishSession();
    return;
  }
  const seconds = getRestSeconds(i, session.targets[i], session.actual[i], loadSettings(session.exercise));
  session.curIndex += 1;
  startRest(seconds);
}

function startRest(seconds) {
  stopMotion();
  stopSpeech();
  session.resting = true;
  session.restTotal = seconds;
  session.restEndsAt = Date.now() + seconds * 1000;
  session.restStartedAt = Date.now();
  session.lastSpoken = null;
  persistSession();
  haptics(80);
  startRestTicker();
  renderSessionUI();
}

function startRestTicker() {
  stopRestTicker();
  restTicker = setInterval(tickRest, 250);
}
function stopRestTicker() {
  if (restTicker) clearInterval(restTicker);
  restTicker = null;
}

// Timers freeze while the screen is locked, so everything derives from restEndsAt.
function tickRest() {
  if (!session.resting) return stopRestTicker();
  const left = restRemaining();
  if (left <= 0) {
    endRest(true);
    return;
  }
  // Only announce seconds we actually reached on-screen, never stale ones after unlocking.
  if (left !== session.lastSpoken && session.lastSpoken !== null && session.lastSpoken - left === 1) {
    if (left === 8) speak('Get ready for the next set');
    else if (left <= 5) speak(String(left));
  }
  session.lastSpoken = left;
  renderRestCountdown(left);
}

function endRest(natural) {
  stopRestTicker();
  session.resting = false;
  session.restEndsAt = 0;
  persistSession();
  if (natural && document.visibilityState === 'visible') {
    playBeep(1320);
    haptics(150);
  }
  beginSet();
}

function skipRest() {
  if (!session.resting) return;
  if (restRemaining() > 5) {
    session.restEndsAt = Date.now() + 5000;
    session.lastSpoken = 6;
    persistSession();
    tickRest();
    return;
  }
  endRest(false);
}

function addRest(seconds) {
  if (!session.resting) return;
  session.restEndsAt += seconds * 1000;
  session.restTotal += seconds;
  persistSession();
  tickRest();
}

function finishSession({ partial = false } = {}) {
  if (!session.active) return;
  session.active = false;
  stopRestTicker();
  stopMotion();
  stopSpeech();
  releaseWakeLock();
  localStorage.removeItem(ACTIVE_SESSION_KEY);

  const ex = session.exercise;
  const settings = loadSettings(ex);
  const sets = session.actual.slice();
  const total = sets.reduce((a, b) => a + b, 0);
  const plan = getDayPlan(session.day, settings);
  const success = sets.every((rep, idx) => rep >= plan.sets[idx]);

  if (total === 0) {
    renderAll();
    dismissOverlay($('trainingModal'));
    toast('Session ended');
    return;
  }

  const today = isoToday();
  const before = allByExercise();
  const datesBefore = Engagement.trainingDates(before);
  const weekBefore = Engagement.consistency(datesBefore, loadGoalState(), today).current;
  const prior = before[ex].filter((w) => !(w.date === session.date && w.day === session.day));
  const prevBest = Math.max(loadMaxSingle(ex), 0, ...prior.map(Engagement.bestOf));
  const workout = { date: session.date, day: session.day, sets, total, completed: success, partial: partial && !success, at: Date.now() };

  saveWorkouts(upsertWorkout(loadWorkouts(ex), workout), ex);
  if (success && loadProgressDay(ex) === session.day) setProgressDay(session.day + 1, ex);
  const best = Math.max(...sets);
  if (best > loadMaxSingle(ex)) saveMaxSingle(best, ex);
  const newly = checkAchievements();

  const cons = Engagement.consistency(Engagement.trainingDates(allByExercise()), loadGoalState(), today);
  const prev = Engagement.previousComparable(prior, workout);
  const last = lastTrainingDateBefore(datesBefore, today);
  const planMilestone = [100, 75, 50, 25].find((p) => newly.some((d) => d.key === (p === 100 ? `plan-complete:${ex}` : `plan-${p}:${ex}`))) || 0;
  const newBest = prevBest > 0 && best > prevBest ? best : 0;
  const message = Engagement.encouragement({
    kind: 'finish',
    exerciseName: EXERCISES[ex].name,
    total,
    setCount: sets.length,
    day: session.day,
    completed: success,
    partial: workout.partial,
    firstWorkout: Engagement.allWorkouts(before).length === 0,
    newBest,
    weeklyJustMet: !weekBefore.met && cons.current.met,
    planMilestone,
    daysSinceLast: last ? Engagement.daysBetween(last, today) : null,
    weekDays: cons.current.days,
    delta: prev ? total - prev.total : null,
    lastKey: readJSON(MOTIVATION_KEY, {})?.lastKey
  });
  localStorage.setItem(MOTIVATION_KEY, JSON.stringify({ lastKey: message.key }));

  renderAll();
  haptics(success ? [60, 40, 120] : 120);
  const data = { ex, settings, plan, workout, best, prevBest, newBest, prev, cons, weeklyJustMet: !weekBefore.met && cons.current.met, newly, message, planMilestone, newDay: !datesBefore.has(today) };
  Promise.resolve(dismissOverlay($('trainingModal'))).finally(() => showCelebration(data));
}

// ---------------------------------------------------------------------------
// Celebration screen (once per saved workout; only reachable from finishSession)
// ---------------------------------------------------------------------------
function animateBar(fill, from, to) {
  fill.style.width = `${Math.round(from * 100)}%`;
  if (prefersReducedMotion()) { fill.style.width = `${Math.round(to * 100)}%`; return; }
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${Math.round(Math.min(1, to) * 100)}%`; }));
}

function progressBlock(label, value, from, to, ariaLabel) {
  const fill = el('div', { class: 'progressFill' });
  const block = el('div', { class: 'celebrateBlock' },
    el('div', { class: 'cardHead' }, el('span', { class: 'eyebrow', text: label }), el('strong', { text: value })),
    el('div', { class: 'progressTrack', role: 'progressbar', 'aria-label': ariaLabel, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(Math.min(1, to) * 100)) }, fill));
  return { block, run: () => animateBar(fill, from, to) };
}

function launchConfetti(host) {
  if (prefersReducedMotion()) return;
  const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  const colors = ['#ff9500', '#30d158', '#0a84ff', '#ffd60a', '#ff375f'];
  for (let i = 0; i < 28; i += 1) {
    layer.append(el('span', { style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.4).toFixed(2)}s;transform:rotate(${Math.round(Math.random() * 360)}deg)` }));
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 2600);
}

async function showCelebration(d) {
  const { ex, settings, plan, workout, best, prevBest, newBest, prev, cons, newly, message } = d;
  const exName = EXERCISES[ex].name;
  const lower = exName.toLowerCase();
  const onTarget = workout.sets.filter((r, i) => r >= plan.sets[i]).length;
  const title = workout.completed ? 'Workout Complete!' : workout.partial ? 'Session saved' : 'All sets done';
  const icon = workout.completed ? 'trophy' : workout.partial ? 'heart' : 'checkmark-done';

  const shownBest = Math.max(best, prevBest);
  const goalBar = progressBlock('Goal progress', `${shownBest} / ${settings.goalMax}`,
    Math.min(1, prevBest / settings.goalMax), Math.min(1, shownBest / settings.goalMax),
    `Best set ${shownBest} of goal ${settings.goalMax}`);
  const weekBar = progressBlock('Weekly goal', `${cons.current.days} / ${cons.current.goal} days`,
    (cons.current.days - (d.newDay ? 1 : 0)) / cons.current.goal, cons.current.days / cons.current.goal,
    `${cons.current.days} of ${cons.current.goal} training days this week`);

  let compare;
  if (workout.partial) compare = 'Partial sessions are saved but not compared.';
  else if (prev) {
    const delta = workout.total - prev.total;
    compare = delta > 0 ? `+${delta} reps vs your last ${lower} workout (${formatDate(prev.date)})`
      : delta === 0 ? `Same total as your last ${lower} workout (${formatDate(prev.date)})`
        : `${Math.abs(delta)} fewer reps than your last ${lower} workout (${formatDate(prev.date)}). Some days are lighter.`;
  } else compare = 'Your next session will have this one to compare against.';

  const bestLine = newBest ? `New personal best: ${newBest} in one set (was ${prevBest})`
    : prevBest === 0 ? `First recorded best set: ${best}` : `Best set today: ${best} (record ${prevBest})`;

  const nextDay = loadProgressDay(ex);
  const nextPlan = getDayPlan(nextDay, settings);
  const streakText = cons.current.goal < 7
    ? `Weekly streak: ${cons.streak} week${cons.streak === 1 ? '' : 's'}${cons.current.met ? ' · goal met this week' : ''}`
    : `Active-day streak: ${Engagement.activeDayStreak(Engagement.trainingDates(allByExercise()), isoToday())} days`;

  const body = el('div', { class: 'celebrate' },
    el('div', { class: `celebrateBurst${workout.completed ? '' : ' soft'}`, 'aria-hidden': 'true' }, el('ion-icon', { name: icon })),
    el('h1', { id: 'celebrateTitle', tabIndex: -1, text: title }),
    el('p', { class: 'celebrateHeadline', text: message.headline }),
    el('p', { class: 'muted celebrateMsg', text: message.message }),
    el('div', { class: 'statGrid' },
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(workout.total) }), el('div', { class: 'k', text: `${lower}` })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: `${onTarget}/${plan.sets.length}` }), el('div', { class: 'k', text: 'sets on target' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(workout.day) }), el('div', { class: 'k', text: `of ${settings.totalDays} days` }))),
    el('div', { class: 'celebrateBlock' },
      el('div', { class: `targetLine ${workout.completed ? 'ok' : ''}` },
        el('ion-icon', { name: workout.completed ? 'checkmark-circle' : 'ellipse-outline', 'aria-hidden': 'true' }),
        workout.completed ? `Target met: ${plan.total} reps across ${plan.sets.length} sets` : `Target ${plan.total} · you did ${workout.total}`),
      el('div', { class: 'muted small', text: compare }),
      el('div', { class: `small ${newBest ? 'accent' : 'muted'}`, text: bestLine })),
    goalBar.block,
    weekBar.block,
    el('div', { class: 'muted small streakLine', text: streakText }),
    newly.length ? el('div', { class: 'celebrateBlock' },
      el('div', { class: 'eyebrow', text: newly.length === 1 ? 'Achievement unlocked' : `${newly.length} achievements unlocked` }),
      el('div', { class: 'badgeRow' }, ...newly.map((a) => el('div', { class: 'miniBadge earned' }, el('ion-icon', { name: a.icon, 'aria-hidden': 'true' }), el('span', { text: a.name }))))) : null,
    el('div', { class: 'celebrateBlock nextBlock' },
      el('div', { class: 'eyebrow', text: workout.completed ? `Next: Day ${nextPlan.day}` : `Next time: Day ${nextPlan.day}` }),
      el('div', { class: 'mono', text: `${nextPlan.sets.join(' · ')}  (${nextPlan.total})` })));

  $('celebrateBody').replaceChildren(body);
  const modal = $('celebrateModal');
  await presentOverlay(modal);
  $('celebrateTitle')?.focus();
  goalBar.run();
  weekBar.run();
  if (newBest || newly.length || d.weeklyJustMet || d.planMilestone) launchConfetti(modal.querySelector('.celebrate'));
  setTimeout(() => speak(`${title} ${message.message}`), 500);
}

// ---------------------------------------------------------------------------
// Training UI
// ---------------------------------------------------------------------------
function flashTap() {
  const a = $('tapArea');
  a.classList.remove('pulse');
  void a.offsetWidth;
  a.classList.add('pulse');
}

function renderRestCountdown(left) {
  const m = Math.floor(left / 60);
  $('curCount').textContent = `${m}:${String(left % 60).padStart(2, '0')}`;
  setRing($('sessionRing'), session.restTotal ? left / session.restTotal : 0);
}

function renderSessionUI() {
  const ex = EXERCISES[session.exercise];
  const i = session.curIndex;
  const target = session.targets[i] || 0;
  const done = session.actual[i] || 0;
  $('trainingTitle').textContent = `${ex.name} · Day ${session.day}`;
  $('curSet').textContent = String(i + 1);
  $('curTarget').textContent = String(target);

  const strip = $('targetStrip');
  strip.replaceChildren(...session.targets.map((t, idx) => {
    const pill = el('div', { class: 'setPill', text: idx < i || (idx === i && done >= t) ? String(session.actual[idx]) : String(t) });
    if (idx === i && !session.resting) pill.classList.add('active');
    if (idx < i) pill.classList.add('done');
    if (idx === i && session.resting) pill.classList.add('active');
    return pill;
  }));

  const area = $('tapArea');
  area.classList.toggle('resting', session.resting);
  $('repBtns').style.display = session.resting ? 'none' : 'flex';
  $('restBtns').style.display = session.resting ? 'flex' : 'none';
  $('finishSetBtn').style.display = session.resting ? 'none' : 'flex';
  $('motionBox').style.display = !session.resting && ex.counting === 'motion' ? '' : 'none';

  if (session.resting) {
    $('tapHint').textContent = `REST · NEXT ${target}`;
    $('tapMeta').textContent = 'Tap to skip. Keep the app open: timers pause while the phone is locked and catch up when you return.';
    renderRestCountdown(restRemaining());
    stopMotionUiTicker();
    return;
  }

  $('curCount').textContent = String(Math.max(0, target - done));
  setRing($('sessionRing'), target ? done / target : 0);
  $('tapHint').textContent = done > 0 ? `${done} DONE · TO GO` : 'REPS TO GO';
  $('tapMeta').textContent = ex.howTo;
  if (ex.counting === 'motion') startMotionUiTicker(); else stopMotionUiTicker();
}

function renderMotionStatus() {
  const st = motionStatus();
  $('motionStatus').className = `motionStatus ${st.cls}`;
  $('motionText').textContent = st.text;
  const level = motion.detector ? motion.detector.level() : 0;
  $('motionMeter').style.width = `${Math.round(Math.min(1, level) * 100)}%`;
}
function startMotionUiTicker() {
  renderMotionStatus();
  if (!motionUiTicker) motionUiTicker = setInterval(renderMotionStatus, 120);
}
function stopMotionUiTicker() {
  if (motionUiTicker) clearInterval(motionUiTicker);
  motionUiTicker = null;
}

// ---------------------------------------------------------------------------
// Max test
// ---------------------------------------------------------------------------
const maxSession = { active: false, count: 0 };

function startMaxTest() {
  maxSession.active = true;
  maxSession.count = 0;
  const ex = EXERCISES[activeExercise];
  $('maxTitle').textContent = `Max ${ex.name.toLowerCase()} test`;
  $('maxHint').textContent = ex.counting === 'motion' ? 'AUTO COUNT · OR +1' : 'TAP TO COUNT';
  if (ex.counting === 'motion') startMotion(ex.motion, () => incMax(1));
  acquireWakeLock();
  $('maxCount').textContent = '0';
}
function incMax(delta) {
  if (!maxSession.active) return;
  const prev = maxSession.count;
  maxSession.count = clampInt(prev + delta, 0, 9999);
  if (maxSession.count > prev) { playBeep(); haptics(20); }
  $('maxCount').textContent = String(maxSession.count);
}
function endMaxTest(save) {
  if (!maxSession.active) return;
  maxSession.active = false;
  stopMotion();
  if (!session.active) releaseWakeLock();
  if (save) {
    const best = loadMaxSingle();
    if (maxSession.count > best) saveMaxSingle(maxSession.count);
    let newly = [];
    if (best > 0 && maxSession.count > best) {
      const r = Engagement.awardKey(loadAwarded(), `personal-best:${activeExercise}`, Date.now());
      if (r.added) {
        saveAwarded(r.state);
        newly.push(achievementDefs().find((a) => a.key === `personal-best:${activeExercise}`));
      }
    }
    newly = newly.concat(checkAchievements());
    if (newly.length) toast(newly.length === 1 ? `Achievement unlocked: ${newly[0].name}` : `${newly.length} achievements unlocked`, 2400);
    else toast(maxSession.count > best ? `New record: ${maxSession.count}` : 'Saved');
    renderAll();
    renderRecords();
  }
  dismissOverlay($('maxModal'));
}

// ---------------------------------------------------------------------------
// Main views
// ---------------------------------------------------------------------------
function renderExerciseRow() {
  const row = $('exerciseRow');
  row.replaceChildren(...Object.entries(EXERCISES).map(([id, ex]) => el('button', {
    class: `exChip${id === activeExercise ? ' active' : ''}`,
    type: 'button',
    role: 'tab',
    'aria-selected': String(id === activeExercise),
    'data-exercise': id,
    onclick: () => switchExercise(id)
  }, el('ion-icon', { name: ex.icon }), ex.name, ex.counting === 'motion' ? el('span', { class: 'tag', text: 'AUTO' }) : null)));
}

function switchExercise(id) {
  if (!EXERCISES[id] || id === activeExercise) return;
  if (session.active) {
    toast('Finish or end the current session first');
    return;
  }
  activeExercise = id;
  localStorage.setItem(ACTIVE_EXERCISE_KEY, id);
  renderAll();
}

function renderWorkoutView() {
  const settings = loadSettings();
  const ex = EXERCISES[activeExercise];
  const day = loadProgressDay();
  const plan = getDayPlan(day, settings);
  const workouts = loadWorkouts();
  const todayWorkout = workouts.find((w) => w.date === isoToday());
  const todayTotal = workouts.filter((w) => w.date === isoToday()).reduce((a, w) => a + w.total, 0);

  $('appTitleMain').textContent = ex.name;
  $('appTitleAccent').textContent = String(settings.goalMax);
  $('heroEyebrow').textContent = `Day ${day} of ${settings.totalDays}`;
  $('heroTitle').textContent = day >= settings.totalDays && todayWorkout ? 'Final day!' : `Today's ${ex.name.toLowerCase()}`;
  $('targetMax').textContent = String(plan.targetMax);
  setRing($('goalRing'), plan.targetMax / settings.goalMax);
  $('toGo').textContent = String(Math.max(0, settings.goalMax - plan.targetMax));
  $('goalLabel').textContent = `to a ${settings.goalMax} rep max`;
  $('dayBar').style.width = `${Math.round(((day - 1) / Math.max(1, settings.totalDays - 1)) * 100)}%`;

  if (todayWorkout) {
    $('todayStatus').textContent = `${todayTotal} reps`;
    $('todayDetail').textContent = `Done today · ${todayWorkout.sets.join(' / ')}`;
  } else {
    $('todayStatus').textContent = `${plan.total} reps`;
    $('todayDetail').textContent = 'Today\'s target · 5 sets';
  }
  $('setRow').replaceChildren(...plan.sets.map((r, idx) => el('div', { class: `setChip${idx === 0 ? ' top' : ''}` }, String(r), el('small', { text: `SET ${idx + 1}` }))));

  const today = isoToday();
  const byEx = allByExercise();
  const dates = Engagement.trainingDates(byEx);
  const goalState = loadGoalState();
  const cons = Engagement.consistency(dates, goalState, today);
  const dayStreak = Engagement.activeDayStreak(dates, today);
  const wk = cons.current;
  // Consistency (weeks) is the main habit metric unless the goal is every day.
  const useWeeks = wk.goal < 7;
  const streakVal = useWeeks ? cons.streak : dayStreak;
  $('streakNum').textContent = useWeeks ? `${streakVal} wk${streakVal === 1 ? '' : 's'}` : `${streakVal} day${streakVal === 1 ? '' : 's'}`;
  $('streakBadge').setAttribute('aria-label', useWeeks ? `Weekly streak: ${streakVal} weeks at your goal` : `Active-day streak: ${streakVal} days`);
  $('streakBadge').classList.toggle('cold', streakVal === 0);

  const best = workouts.reduce((m, w) => Math.max(m, w.total), 0);
  const bestSet = Math.max(loadMaxSingle(), ...workouts.map((w) => Math.max(0, ...w.sets)));
  $('statBestSet').textContent = bestSet ? String(bestSet) : '—';
  $('statBestTotal').textContent = best ? String(best) : '—';
  $('statLifetime').textContent = String(workouts.reduce((a, w) => a + w.total, 0));

  $('weekGoalText').textContent = `${wk.days} / ${wk.goal}`;
  $('weekGoalSub').textContent = wk.met ? 'Goal met this week' : `${wk.goal - wk.days} more training day${wk.goal - wk.days === 1 ? '' : 's'} to go`;
  $('weekGoalBar').style.width = `${Math.round(Math.min(1, wk.days / wk.goal) * 100)}%`;
  $('weekGoalTrack').setAttribute('aria-valuenow', String(Math.round(Math.min(1, wk.days / wk.goal) * 100)));
  const lastFrozen = cons.lastWeek && cons.lastWeek.status === 'frozen';
  $('streakDetail').textContent = [
    `Weekly streak: ${cons.streak} wk${cons.streak === 1 ? '' : 's'}`,
    `Active days in a row: ${dayStreak}`,
    lastFrozen ? 'Streak freeze covered last week' : null
  ].filter(Boolean).join(' · ');

  $('weekDots').replaceChildren(...Engagement.weekDays(Engagement.weekStart(today)).map((iso) => {
    const doneDay = dates.has(iso);
    const label = `${formatDate(iso, { weekday: 'long' })}: ${doneDay ? 'trained' : iso > today ? 'upcoming' : 'rest'}`;
    return el('div', { class: `dayDot${doneDay ? ' done' : ''}${iso === today ? ' today' : ''}${iso > today ? ' future' : ''}`, role: 'listitem', 'aria-label': label },
      formatDate(iso, { weekday: 'narrow' }),
      el('div', { class: 'd', 'aria-hidden': 'true' }, doneDay ? el('ion-icon', { name: 'checkmark' }) : String(Engagement.parseISO(iso).getDate())));
  }));

  const last = lastTrainingDateBefore(dates, today);
  const msg = Engagement.encouragement({
    kind: 'today',
    doneToday: dates.has(today),
    daysSinceLast: last ? Engagement.daysBetween(last, today) : null,
    goal: wk.goal,
    weekDays: wk.days,
    weekMet: wk.met
  });
  $('todayMsg').textContent = msg.message;

  renderAchievementsCard();

  const prevWs = Engagement.addDays(Engagement.weekStart(today), -7);
  const offered = readJSON(RECAP_KEY, {})?.offered;
  const hadLastWeek = Engagement.allWorkouts(byEx).some((w) => w.date >= prevWs && w.date < Engagement.weekStart(today));
  $('recapInvite').style.display = !session.active && offered !== prevWs && hadLastWeek ? '' : 'none';

  const preview = [];
  for (let k = day; k <= Math.min(settings.totalDays, day + 2); k += 1) {
    const p = getDayPlan(k, settings);
    preview.push(el('div', { class: 'planLine' },
      el('span', { class: k === day ? 'accent' : '', text: k === day ? `Day ${k} · today` : `Day ${k}` }),
      el('span', { class: 'mono muted', text: `${p.sets.join(' · ')}  (${p.total})` })));
  }
  $('planPreview').replaceChildren(...preview);

  $('startLabel').textContent = session.active ? 'Resume workout' : todayWorkout ? 'Train again' : 'Start workout';
}

function renderHistoryView() {
  const settings = loadSettings();
  const list = $('historyList');
  const workouts = loadWorkouts();
  if (!workouts.length) {
    list.replaceChildren(el('div', { class: 'emptyState' }, el('ion-icon', { name: 'calendar-outline' }),
      el('p', { text: `No ${EXERCISES[activeExercise].name.toLowerCase()} logged yet. Your first session will show up here.` })));
    return;
  }
  list.replaceChildren(...workouts.slice(0, 120).map((w) => {
    const st = statusForWorkout(w, getDayPlan(w.day, settings));
    const date = new Date(`${w.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const item = el('ion-item', { class: 'historyItem' },
      el('ion-label', {},
        el('div', { class: 'title', text: `${date} · Day ${w.day}` }),
        el('div', { class: 'muted mono', text: `${w.sets.join(' / ')}  (${w.total})` })),
      el('ion-badge', { color: st.color, slot: 'end', text: st.label }));
    const del = el('ion-item-option', { color: 'danger', text: 'Delete', onclick: () => {
      saveWorkouts(loadWorkouts().filter((x) => !(x.date === w.date && x.day === w.day)));
      toast('Deleted');
      renderAll();
    } });
    return el('ion-item-sliding', {}, item, el('ion-item-options', { side: 'end' }, del));
  }));
}

function renderPlanList() {
  const settings = loadSettings();
  const current = loadProgressDay();
  const items = [];
  for (let d = 1; d <= settings.totalDays; d += 1) {
    const p = getDayPlan(d, settings);
    const item = el('ion-item', { button: true, detail: false, class: d === current ? 'planCurrent' : '', onclick: () => {
      if (session.active) return toast('End the current session before changing the day');
      setProgressDay(d);
      renderAll();
      renderPlanList();
      toast(`Plan set to Day ${d}`);
    } },
    el('ion-label', {},
      el('div', { class: 'title', style: 'font-weight:800', text: `Day ${d}${d === current ? ' · current' : ''}` }),
      el('div', { class: 'muted mono', text: p.sets.join(' / ') })),
    el('ion-badge', { color: d === current ? 'primary' : 'medium', slot: 'end', text: String(p.total) }));
    items.push(item);
  }
  $('planList').replaceChildren(...items);
  $('planModalHint').textContent = `Days 1–${settings.totalDays}. Tap a day to jump to it.`;
}

function renderRecords() {
  const best = loadWorkouts().reduce((m, w) => Math.max(m, w.total), 0);
  $('prNumber').textContent = best ? String(best) : '—';
  $('maxBest').textContent = String(loadMaxSingle() || '—');
  $('prGoalBadge').textContent = String(loadSettings().goalMax);
}

// ---------------------------------------------------------------------------
// Achievements views
// ---------------------------------------------------------------------------
function visibleAchievements() {
  const awarded = loadAwarded().awarded;
  return Engagement.evaluate(achievementDefs(), engagementContext())
    .filter((r) => !r.def.exercise || r.def.exercise === activeExercise)
    .map((r) => ({ ...r, award: awarded[r.def.key] || null }));
}

function renderAchievementsCard() {
  const list = visibleAchievements();
  const earned = list.filter((r) => r.award).sort((a, b) => (b.award.at || 0) - (a.award.at || 0));
  $('achCount').textContent = `${earned.length} / ${list.length}`;
  $('achRecent').replaceChildren(...(earned.length
    ? earned.slice(0, 4).map((r) => el('div', { class: 'miniBadge earned' }, el('ion-icon', { name: r.def.icon, 'aria-hidden': 'true' }), el('span', { text: r.def.name })))
    : [el('div', { class: 'muted small', text: 'Finish a full workout to earn your first badge.' })]));
}

function renderAchievementsModal() {
  const list = visibleAchievements();
  const earnedCount = list.filter((r) => r.award).length;
  $('achSummary').textContent = `${earnedCount} of ${list.length} earned · strength and plan badges shown for ${EXERCISES[activeExercise].name.toLowerCase()}`;
  const sections = Engagement.CATEGORIES.map((cat) => {
    const items = list.filter((r) => r.def.category === cat.id);
    return el('section', { class: 'achSection' },
      el('h2', { class: 'eyebrow', text: cat.name }),
      el('div', { class: 'badgeGrid', role: 'list' }, ...items.map((r) => {
        const earned = !!r.award;
        const status = earned
          ? (r.award.at ? `Earned ${new Date(r.award.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Earned before tracking')
          : (r.target > 1 ? `${r.current} / ${r.target}` : 'Not yet');
        return el('div', { class: `badge ${earned ? 'earned' : 'locked'}`, role: 'listitem', 'aria-label': `${r.def.name}. ${r.def.desc}. ${earned ? status : `Locked, ${status}`}` },
          el('div', { class: 'badgeIcon', 'aria-hidden': 'true' }, el('ion-icon', { name: earned ? r.def.icon : 'lock-closed-outline' })),
          el('div', { class: 'badgeName', text: r.def.name }),
          el('div', { class: 'badgeDesc', text: r.def.desc }),
          !earned && r.target > 1 ? el('div', { class: 'progressTrack', 'aria-hidden': 'true' }, el('div', { class: 'progressFill', style: `width:${Math.round((r.current / r.target) * 100)}%` })) : null,
          el('div', { class: 'badgeStatus', text: status }));
      })));
  });
  $('achList').replaceChildren(...sections);
}

// ---------------------------------------------------------------------------
// Weekly recap
// ---------------------------------------------------------------------------
let recapWs = null;

function markRecapOffered() {
  const prevWs = Engagement.addDays(Engagement.weekStart(isoToday()), -7);
  localStorage.setItem(RECAP_KEY, JSON.stringify({ version: 1, offered: prevWs }));
  $('recapInvite').style.display = 'none';
}

function renderRecap(ws) {
  recapWs = ws;
  const curWs = Engagement.weekStart(isoToday());
  const defs = achievementDefs();
  const s = Engagement.weekSummary(allByExercise(), ws, { goalState: loadGoalState(), awarded: loadAwarded().awarded });
  const name = (ex) => EXERCISES[ex]?.name.toLowerCase() || ex;
  const inProgress = ws === curWs;
  $('recapRange').textContent = `${formatDate(ws)} – ${formatDate(s.end)}${inProgress ? ' · so far' : ''}`;
  $('recapNext').disabled = ws >= curWs;

  const maxReps = Math.max(1, ...s.timeline.map((t) => t.reps));
  const closing = Engagement.encouragement({ kind: 'recap', days: s.days, met: s.met });
  const goalText = s.met ? `Weekly goal met: ${s.days} of ${s.goal} days` : `${s.days} of ${s.goal} training days${inProgress ? ' so far' : ''}`;
  const highlight = s.prs.length
    ? `New best: ${s.prs[0].reps} ${name(s.prs[0].exercise)} in one set`
    : s.best ? `Best set: ${s.best.reps} ${name(s.best.exercise)}` : 'No sessions logged this week';
  let compare = null;
  if (s.previous && s.sessions) {
    const dr = s.totalReps - s.previous.totalReps;
    const dd = s.days - s.previous.days;
    compare = `Training volume vs the week before: ${dr >= 0 ? '+' : ''}${dr} reps, ${dd >= 0 ? '+' : ''}${dd} training day${Math.abs(dd) === 1 ? '' : 's'}.`;
  }
  const achNames = s.achievements.map((k) => defs.find((d) => d.key === k)?.name).filter(Boolean);

  $('recapBody').replaceChildren(
    el('div', { class: 'recapHero' },
      el('div', { class: 'bigNumber', text: String(s.days) }),
      el('div', { class: 'eyebrow', text: `training day${s.days === 1 ? '' : 's'}` }),
      el('div', { class: `goalChip ${s.met ? 'met' : ''}` },
        el('ion-icon', { name: s.met ? 'checkmark-circle' : 'ellipse-outline', 'aria-hidden': 'true' }), goalText)),
    el('div', { class: 'statGrid' },
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(s.totalReps) }), el('div', { class: 'k', text: 'total reps' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(s.sessions) }), el('div', { class: 'k', text: s.partialSessions ? `sessions (${s.partialSessions} partial)` : 'sessions' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(s.exercises.length) }), el('div', { class: 'k', text: 'exercises' }))),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Highlight' }),
      el('div', { class: 'recapHighlight', text: highlight }),
      s.prs.length > 1 ? el('div', { class: 'muted small', text: s.prs.slice(1).map((p) => `Also: ${p.reps} ${name(p.exercise)} (was ${p.prev})`).join(' · ') }) : null,
      s.prs[0] ? el('div', { class: 'muted small', text: `Previous best was ${s.prs[0].prev}.` }) : null,
      s.exercises.length ? el('div', { class: 'muted small', text: `Trained: ${s.exercises.map((e) => EXERCISES[e]?.name || e).join(', ')}` }) : null),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Daily reps' }),
      el('div', { class: 'timeline', role: 'list' }, ...s.timeline.map((t) => el('div', { class: 'tlDay', role: 'listitem', 'aria-label': `${formatDate(t.date, { weekday: 'long' })}: ${t.reps ? `${t.reps} reps` : 'rest'}` },
        el('div', { class: 'tlBarWrap', 'aria-hidden': 'true' }, el('div', { class: `tlBar${t.reps ? ' on' : ''}`, style: `height:${Math.max(4, Math.round((t.reps / maxReps) * 100))}%` })),
        el('div', { class: 'tlLabel', 'aria-hidden': 'true', text: formatDate(t.date, { weekday: 'narrow' }) }))))),
    achNames.length ? el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Achievements unlocked' }),
      el('div', { class: 'badgeRow' }, ...achNames.map((n) => el('div', { class: 'miniBadge earned' }, el('ion-icon', { name: 'ribbon-outline', 'aria-hidden': 'true' }), el('span', { text: n }))))) : null,
    compare ? el('p', { class: 'muted small', text: compare }) : null,
    el('p', { class: 'recapClosing', text: closing.message }));
}

function openRecap(ws) {
  renderRecap(ws);
  presentOverlay($('recapModal'));
}

function syncSettingsForm() {
  const s = loadSettings();
  $('settingsTitle').textContent = `${EXERCISES[activeExercise].name} settings`;
  $('maxReps').value = s.startMax;
  $('goalVolume').value = s.goalMax;
  $('planDays').value = s.totalDays;
  $('rest').value = s.baseRestSeconds;
  $('rounding').value = s.rounding;
  $('sensitivity').value = s.sensitivity;
  $('beepToggle').checked = s.soundOn;
  $('voiceToggle').checked = s.voiceOn;
  $('sensitivityItem').style.display = EXERCISES[activeExercise].counting === 'motion' ? '' : 'none';
  const gs = loadGoalState();
  const curWs = Engagement.weekStart(isoToday());
  const pending = gs.history.find((h) => h.from > curWs);
  $('weeklyGoal').value = String(pending ? pending.goal : Engagement.goalForWeek(gs, curWs));
  $('weeklyGoalNote').textContent = pending
    ? `This week stays at ${Engagement.goalForWeek(gs, curWs)} days; ${pending.goal} days starts ${formatDate(pending.from, { weekday: 'long', month: 'short', day: 'numeric' })}.`
    : 'Counts days you train any exercise. Changes made after training this week start next Monday.';
  $('freezeToggle').checked = gs.freeze;
}

function renderAll() {
  renderExerciseRow();
  renderWorkoutView();
  renderHistoryView();
}

function switchTab(tab) {
  $('viewWorkout').style.display = tab === 'history' ? 'none' : '';
  $('viewHistory').style.display = tab === 'history' ? '' : 'none';
  $('ctaBar').style.display = tab === 'history' ? 'none' : 'flex';
}

// ---------------------------------------------------------------------------
// Slide-to-finish control
// ---------------------------------------------------------------------------
function attachSlider(track, onComplete) {
  const knob = track.querySelector('.swipeKnob');
  const fill = track.querySelector('.swipeFill');
  const label = track.querySelector('.swipeLabel');
  const idleText = label.textContent;
  let startX = 0;
  let pointerId = null;
  let locked = false;
  const maxX = () => Math.max(0, track.getBoundingClientRect().width - 58);
  const setX = (x, animate) => {
    knob.style.transition = fill.style.transition = animate ? 'transform 180ms ease, width 180ms ease' : 'none';
    knob.style.transform = `translate(${x}px, -50%)`;
    fill.style.width = `${x + 51}px`;
  };
  const reset = () => { setX(0, true); label.textContent = idleText; pointerId = null; };
  setX(0, false);

  knob.addEventListener('pointerdown', (e) => {
    if (locked) return;
    e.preventDefault();
    pointerId = e.pointerId;
    startX = e.clientX;
    knob.setPointerCapture?.(pointerId);
  });
  knob.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const x = Math.max(0, Math.min(maxX(), e.clientX - startX));
    setX(x, false);
    label.textContent = x / maxX() > 0.9 ? 'Release to finish' : idleText;
  });
  const end = (e) => {
    if (e.pointerId !== pointerId) return;
    const x = Math.max(0, Math.min(maxX(), e.clientX - startX));
    if (e.type === 'pointerup' && maxX() && x / maxX() >= 0.9) {
      locked = true;
      setX(maxX(), true);
      onComplete();
      setTimeout(() => { locked = false; reset(); }, 400);
    } else reset();
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------
function exportData() {
  const exercises = {};
  for (const ex of Object.keys(EXERCISES)) {
    exercises[ex] = {
      settings: loadSettings(ex),
      progressDay: loadProgressDay(ex),
      workouts: loadWorkouts(ex),
      maxSingle: loadMaxSingle(ex)
    };
  }
  const blob = new Blob([JSON.stringify({
    app: 'dailyrep',
    version: 2,
    exportedAt: new Date().toISOString(),
    exercises,
    engagement: { weeklyGoal: loadGoalState(), achievements: loadAwarded() }
  }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `dailyrep-backup-${isoToday()}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Exported');
}

function importPayload(payload) {
  // v1 files hold a single exercise at the top level.
  const perExercise = payload?.version === 2 && payload.exercises ? payload.exercises : { [activeExercise]: payload };
  let n = 0;
  for (const [ex, data] of Object.entries(perExercise)) {
    if (!EXERCISES[ex] || !data || typeof data !== 'object') continue;
    if (data.settings && typeof data.settings === 'object') {
      const cur = loadSettings(ex);
      const s = data.settings;
      const pick = (k, lo, hi) => (Number.isFinite(s[k]) ? clampInt(s[k], lo, hi) : cur[k]);
      saveSettings({
        ...cur,
        startMax: pick('startMax', 1, 100000),
        goalMax: pick('goalMax', 1, 100000),
        totalDays: pick('totalDays', 1, 365),
        baseRestSeconds: pick('baseRestSeconds', 10, 900),
        rounding: ['up', 'down', 'nearest'].includes(s.rounding) ? s.rounding : cur.rounding,
        soundOn: s.soundOn !== false
      }, ex);
    }
    if (Array.isArray(data.workouts)) saveWorkouts(data.workouts.map(sanitizeWorkout).filter(Boolean), ex);
    if (Number.isFinite(data.maxSingle)) saveMaxSingle(data.maxSingle, ex);
    if (Number.isFinite(data.progressDay)) setProgressDay(data.progressDay, ex);
    n += 1;
  }
  // Engagement data is optional; older backups simply don't have it.
  const eng = payload && typeof payload.engagement === 'object' ? payload.engagement : null;
  if (eng?.weeklyGoal) saveGoalState(Engagement.normalizeGoalState(eng.weeklyGoal));
  if (eng?.achievements) saveAwarded(Engagement.mergeAwarded(loadAwarded(), eng.achievements));
  if (n || eng) checkAchievements({ retro: true });
  return n;
}

// ---------------------------------------------------------------------------
// Lifecycle: screen lock / app switch / iOS page eviction
// ---------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persistSession();
    stopSpeech();
    return;
  }
  if (wakeWanted) acquireWakeLock();
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  if (session.active) {
    if (session.resting) tickRest();
    renderSessionUI();
  }
  renderWorkoutView();
});
window.addEventListener('pagehide', persistSession);
window.addEventListener('pageshow', (e) => {
  // Restored from the back/forward cache: intervals may have been frozen.
  if (e.persisted && session.active && session.resting) tickRest();
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}

window.addEventListener('load', async () => {
  await Promise.all(['ion-modal', 'ion-toast', 'ion-alert'].map((t) => customElements.whenDefined(t)));
  const trainingModal = $('trainingModal');

  // Badges already earned by existing history are recorded once, undated, with a single summary toast.
  const firstEval = !loadAwarded().initialized;
  const retro = checkAchievements({ retro: true });
  renderAll();
  if (firstEval && retro.length) toast(`${retro.length} achievement${retro.length === 1 ? '' : 's'} earned from your history`, 2400);
  $('tabSeg').addEventListener('ionChange', (e) => switchTab(e.detail.value));

  $('achOpenBtn').addEventListener('click', () => { renderAchievementsModal(); presentOverlay($('achModal')); });
  $('closeAch').addEventListener('click', () => dismissOverlay($('achModal')));
  $('celebrateDone').addEventListener('click', () => dismissOverlay($('celebrateModal')));
  $('celebrateModal').addEventListener('ionModalDidDismiss', () => { stopSpeech(); $('startTrainingBtn').focus?.(); });
  const prevWeek = () => Engagement.addDays(Engagement.weekStart(isoToday()), -7);
  $('recapViewBtn').addEventListener('click', () => { markRecapOffered(); openRecap(prevWeek()); });
  $('recapDismissBtn').addEventListener('click', markRecapOffered);
  $('weekRecapBtn').addEventListener('click', () => openRecap(Engagement.weekStart(isoToday())));
  $('historyRecapBtn').addEventListener('click', () => openRecap(prevWeek()));
  $('recapPrev').addEventListener('click', () => renderRecap(Engagement.addDays(recapWs, -7)));
  $('recapNext').addEventListener('click', () => renderRecap(Engagement.addDays(recapWs, 7)));
  $('closeRecap').addEventListener('click', () => dismissOverlay($('recapModal')));

  $('settingsBtn').addEventListener('click', () => { syncSettingsForm(); presentOverlay($('settingsModal')); });
  $('closeSettings').addEventListener('click', () => dismissOverlay($('settingsModal')));

  $('startTrainingBtn').addEventListener('click', () => {
    unlockAudio();
    // iOS requires the permission prompt in the same gesture; do it before any await.
    const perm = EXERCISES[activeExercise].counting === 'motion' ? requestMotionPermission() : Promise.resolve(true);
    if (!session.active) startSession();
    else if (!session.resting) beginSet();
    perm.then(() => { if (session.active && !session.resting && isMotionExercise()) beginSet(); });
    presentOverlay(trainingModal);
  });

  $('closeTraining').addEventListener('click', () => {
    const anyReps = session.actual.some((r) => r > 0);
    confirmAlert('End workout?', anyReps ? 'Save the reps you have done so far, or discard them.' : 'Nothing has been counted yet.', [
      { text: 'Keep going', role: 'cancel' },
      ...(anyReps ? [{ text: 'Save & end', handler: () => finishSession({ partial: true }) }] : []),
      { text: 'Discard', role: 'destructive', handler: () => {
        session.actual.fill(0);
        finishSession();
      } }
    ]);
  });

  $('tapArea').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!session.active) return;
    if (session.resting) {
      // Ignore the extra taps that often follow the last rep of a set.
      if (Date.now() - session.restStartedAt > 1200) skipRest();
      return;
    }
    if (isMotionExercise()) {
      if (motion.permission === 'unknown' && needsMotionPermission()) {
        requestMotionPermission().then(() => beginSet());
      }
      return; // phone is in a pocket; stray touches must not count
    }
    addRep(1, 'tap');
  });
  $('plusRepBtn').addEventListener('click', () => addRep(1, 'manual'));
  $('minusRepBtn').addEventListener('click', () => addRep(-1, 'manual'));
  $('skipRestBtn').addEventListener('click', () => endRest(false));
  $('addRestBtn').addEventListener('click', () => addRest(30));
  attachSlider($('finishSetBtn'), () => { if (session.active && !session.resting) completeSet(); });

  $('sessionBtn').addEventListener('click', () => { renderRecords(); presentOverlay($('recordModal')); });
  $('closeRecord').addEventListener('click', () => dismissOverlay($('recordModal')));
  $('startMaxBtn').addEventListener('click', () => {
    unlockAudio();
    const perm = EXERCISES[activeExercise].counting === 'motion' ? requestMotionPermission() : Promise.resolve(true);
    perm.then(() => { startMaxTest(); presentOverlay($('maxModal')); });
  });
  $('closeMax').addEventListener('click', () => endMaxTest(false));
  $('finishMaxBtn').addEventListener('click', () => endMaxTest(true));
  $('maxPlusBtn').addEventListener('click', () => incMax(1));
  $('maxMinusBtn').addEventListener('click', () => incMax(-1));
  $('maxTapArea').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (EXERCISES[activeExercise].counting === 'tap') incMax(1);
  });

  $('viewPlanBtn').addEventListener('click', () => { renderPlanList(); presentOverlay($('planModal')); });
  $('closePlan').addEventListener('click', () => dismissOverlay($('planModal')));

  $('saveSettingsBtn').addEventListener('click', () => {
    const startMax = Number($('maxReps').value);
    const goalMax = Number($('goalVolume').value);
    const totalDays = Number($('planDays').value);
    const baseRestSeconds = Number($('rest').value);
    if (!Number.isInteger(startMax) || startMax < 1) return toast('Starting max must be a whole number ≥ 1');
    if (!Number.isInteger(goalMax) || goalMax < startMax) return toast('Goal must be at least the starting max');
    if (!Number.isInteger(totalDays) || totalDays < 1 || totalDays > 365) return toast('Plan length must be 1–365 days');
    if (!Number.isFinite(baseRestSeconds) || baseRestSeconds < 10 || baseRestSeconds > 900) return toast('Rest must be 10–900 seconds');
    const cur = loadSettings();
    saveSettings({
      ...cur,
      startMax,
      goalMax,
      totalDays,
      baseRestSeconds,
      minRestSeconds: Math.min(cur.minRestSeconds, baseRestSeconds),
      maxRestSeconds: Math.max(cur.maxRestSeconds, baseRestSeconds),
      rounding: $('rounding').value,
      sensitivity: $('sensitivity').value,
      soundOn: $('beepToggle').checked,
      voiceOn: $('voiceToggle').checked
    });
    setProgressDay(loadProgressDay());
    const gs = loadGoalState();
    const goal = Number($('weeklyGoal').value);
    let next = { ...gs, freeze: $('freezeToggle').checked };
    let goalNote = '';
    if (Number.isInteger(goal) && goal >= 2 && goal <= 7) {
      const today = isoToday();
      const trained = [...Engagement.trainingDates(allByExercise())].some((d) => d >= Engagement.weekStart(today) && d <= today);
      const r = Engagement.setWeeklyGoal(next, goal, today, trained);
      next = r.state;
      if (goal !== Engagement.goalForWeek(gs, Engagement.weekStart(today)) && r.effectiveFrom > Engagement.weekStart(today)) goalNote = ' New weekly goal starts Monday.';
    }
    saveGoalState(next);
    toast(`Settings saved.${goalNote}`);
    renderAll();
    dismissOverlay($('settingsModal'));
  });

  $('startTodayBtn').addEventListener('click', () => confirmAlert('Restart plan?', `${EXERCISES[activeExercise].name} goes back to Day 1. History is kept.`, [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Restart', role: 'destructive', handler: () => { setProgressDay(1); renderAll(); toast('Back to Day 1'); } }
  ]));

  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => {
    const input = el('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const n = importPayload(JSON.parse(await file.text()));
        toast(n ? 'Imported' : 'Nothing to import');
        syncSettingsForm();
        renderAll();
      } catch {
        toast('Import failed: not a DailyRep backup');
      }
    });
    input.click();
  });

  $('wipeBtn').addEventListener('click', () => confirmAlert(`Wipe ${EXERCISES[activeExercise].name}?`, 'Deletes this exercise\'s workouts, records and settings from this device.', [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Wipe', role: 'destructive', handler: () => {
      ['settings', 'start_date', 'workouts', 'max_single', 'progress_day'].forEach((k) => localStorage.removeItem(key(k)));
      // Global badges (first workout, weekly goals) are kept; this exercise's badges reset with its data.
      saveAwarded(Engagement.removeExerciseAwards(loadAwarded(), activeExercise));
      syncSettingsForm();
      renderAll();
      toast('Wiped');
    } }
  ]));

  // Resume a session that was interrupted by a lock, app switch or iOS evicting the page.
  const saved = loadSavedSession();
  if (saved) {
    activeExercise = saved.exercise;
    localStorage.setItem(ACTIVE_EXERCISE_KEY, saved.exercise);
    renderAll();
    resumeSession(saved);
    await presentOverlay(trainingModal);
    toast('Workout resumed');
  }
});
