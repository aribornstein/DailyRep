// Engagement logic: weeks, goals, streaks, achievements, recaps, encouragement. Pure functions; no DOM or storage.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engagement = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_GOAL = 3;
  const EPOCH = '0000-01-01';
  const FREEZE_AFTER = 3; // met weeks needed before a missed week can be forgiven
  const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  // ---------------------------------------------------------------------------
  // Local calendar dates (YYYY-MM-DD). Noon avoids DST edge cases.
  // ---------------------------------------------------------------------------
  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function toISO(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  const weekStart = (iso) => addDays(iso, -((parseISO(iso).getDay() + 6) % 7)); // Monday
  const weekDays = (ws) => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

  // ---------------------------------------------------------------------------
  // Workouts. Input: { exerciseId: [{ date, day, sets, total, completed, partial, at }] }
  // ---------------------------------------------------------------------------
  const bestOf = (w) => (w.sets && w.sets.length ? Math.max(0, ...w.sets) : 0);

  function cmpWorkout(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return ((a.at || 0) - (b.at || 0)) || (a.day - b.day);
  }

  function allWorkouts(byEx) {
    const out = [];
    for (const [exercise, list] of Object.entries(byEx || {})) {
      if (!Array.isArray(list)) continue;
      for (const w of list) if (w && isISO(w.date) && w.total > 0 && Array.isArray(w.sets)) out.push({ ...w, exercise });
    }
    return out.sort(cmpWorkout);
  }

  const trainingDates = (byEx) => new Set(allWorkouts(byEx).map((w) => w.date));

  // ---------------------------------------------------------------------------
  // Weekly goal. History entries apply from their Monday onward, so changes never rewrite past weeks.
  // ---------------------------------------------------------------------------
  function normalizeGoalState(raw) {
    const history = (Array.isArray(raw && raw.history) ? raw.history : [])
      .filter((h) => h && (h.from === EPOCH || isISO(h.from)) && Number.isInteger(h.goal) && h.goal >= 2 && h.goal <= 7)
      .map((h) => ({ from: h.from, goal: h.goal }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (!history.length || history[0].from !== EPOCH) history.unshift({ from: EPOCH, goal: history.length ? history[0].goal : DEFAULT_GOAL });
    return { version: 1, history, freeze: !(raw && raw.freeze === false) };
  }

  function goalForWeek(state, ws) {
    let goal = state.history[0].goal;
    for (const h of state.history) if (h.from <= ws) goal = h.goal;
    return goal;
  }

  // A change made after training this week starts next Monday, so it can't turn this week into a "met" week.
  function setWeeklyGoal(state, goal, today, trainedThisWeek) {
    const ws = weekStart(today);
    const from = trainedThisWeek ? addDays(ws, 7) : ws;
    const history = state.history.filter((h) => h.from < from);
    if (goalForWeek({ history }, from) !== goal) history.push({ from, goal });
    return { state: { ...state, history }, effectiveFrom: from };
  }

  // ---------------------------------------------------------------------------
  // Streaks
  // ---------------------------------------------------------------------------
  function weekProgress(dates, ws, goal) {
    const trained = weekDays(ws).filter((d) => dates.has(d));
    return { ws, days: trained.length, dates: trained, goal, met: trained.length >= goal };
  }

  function activeDayStreak(dates, today) {
    let d = dates.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (dates.has(d)) { n += 1; d = addDays(d, -1); }
    return n;
  }

  // Completed weeks are judged against the goal in force that week; the current week can only add, never break.
  function consistency(dates, goalState, today) {
    const curWs = weekStart(today);
    const past = [...dates].filter((d) => d < curWs).sort();
    const weeks = [];
    let run = 0, sinceFreeze = 0, metRun = 0, bestMetRun = 0, metWeeks = 0;
    if (past.length) {
      for (let ws = weekStart(past[0]); ws < curWs; ws = addDays(ws, 7)) {
        const p = weekProgress(dates, ws, goalForWeek(goalState, ws));
        let status;
        if (p.met) {
          status = 'met';
          run += 1; sinceFreeze += 1; metRun += 1; metWeeks += 1;
        } else if (goalState.freeze && sinceFreeze >= FREEZE_AFTER) {
          status = 'frozen'; // keeps the streak alive but is never counted as a met week
          sinceFreeze = 0; metRun = 0;
        } else {
          status = 'missed';
          run = 0; sinceFreeze = 0; metRun = 0;
        }
        bestMetRun = Math.max(bestMetRun, metRun);
        weeks.push({ ...p, status });
      }
    }
    const current = weekProgress(dates, curWs, goalForWeek(goalState, curWs));
    const consecutiveMet = metRun + (current.met ? 1 : 0);
    const last = weeks.length ? weeks[weeks.length - 1] : null;
    return {
      streak: run + (current.met ? 1 : 0),
      current,
      weeks,
      lastWeek: last && last.ws === addDays(curWs, -7) ? last : null,
      metWeeks: metWeeks + (current.met ? 1 : 0),
      consecutiveMet,
      bestConsecutiveMet: Math.max(bestMetRun, consecutiveMet),
      freezeReady: goalState.freeze && sinceFreeze >= FREEZE_AFTER
    };
  }

  // ---------------------------------------------------------------------------
  // Personal bests
  // ---------------------------------------------------------------------------
  function personalBestEvents(workouts) {
    let prev = 0;
    const events = [];
    for (const w of [...workouts].sort(cmpWorkout)) {
      const b = bestOf(w);
      if (prev > 0 && b > prev) events.push({ date: w.date, reps: b, prev });
      prev = Math.max(prev, b);
    }
    return events;
  }

  // Most recent earlier non-partial workout of the same exercise; never compares partial sessions.
  function previousComparable(workouts, w) {
    if (w.partial) return null;
    const earlier = workouts.filter((x) => !x.partial && x.total > 0 && cmpWorkout(x, w) < 0 && !(x.date === w.date && x.day === w.day));
    return earlier.sort(cmpWorkout).pop() || null;
  }

  // ---------------------------------------------------------------------------
  // Achievements
  // ---------------------------------------------------------------------------
  const CATEGORIES = [
    { id: 'start', name: 'Getting started' },
    { id: 'strength', name: 'Strength' },
    { id: 'consistency', name: 'Consistency' },
    { id: 'plan', name: 'Plan milestones' }
  ];
  const EMPTY_EX = { bestSet: 0, pbEvents: 0, completedDays: 0, finalDayDone: false };

  function count(key, name, desc, icon, category, metric, target, exercise = null) {
    return {
      key, name, desc, icon, category, exercise,
      check: (ctx) => {
        const current = metric(ctx);
        return { earned: current >= target, current: Math.min(current, target), target };
      }
    };
  }

  // exercises: { id: { name, goalMax, totalDays, milestones: [n, ...] } }
  function achievementDefs(exercises) {
    const defs = [
      count('first-workout', 'First Workout', 'Complete your first full workout', 'flag-outline', 'start', (c) => c.completedSessions, 1),
      count('getting-started', 'Getting Started', 'Complete 3 full workouts', 'walk-outline', 'start', (c) => c.completedSessions, 3),
      count('building-momentum', 'Building Momentum', 'Complete 10 full workouts', 'trending-up-outline', 'start', (c) => c.completedSessions, 10),
      count('committed', 'Committed', 'Complete 25 full workouts', 'ribbon-outline', 'start', (c) => c.completedSessions, 25),
      count('strong-week', 'Strong Week', 'Meet your weekly goal', 'calendar-outline', 'consistency', (c) => c.metWeeks, 1),
      count('two-strong-weeks', 'Two Strong Weeks', 'Meet your weekly goal two weeks in a row', 'calendar-number-outline', 'consistency', (c) => c.bestConsecutiveMet, 2),
      count('consistency-champion', 'Consistency Champion', 'Meet your weekly goal four weeks in a row', 'trophy-outline', 'consistency', (c) => c.bestConsecutiveMet, 4)
    ];
    for (const [ex, meta] of Object.entries(exercises)) {
      const per = (c) => (c.per && c.per[ex]) || EMPTY_EX;
      const lower = meta.name.toLowerCase();
      for (const n of meta.milestones) {
        defs.push(count(`set-${n}:${ex}`, n === 100 ? 'Century Club' : `First ${n}`, `Do ${n} ${lower} in one set`, 'barbell-outline', 'strength', (c) => per(c).bestSet, n, ex));
      }
      defs.push(count(`personal-best:${ex}`, 'Personal Best', `Beat an earlier best ${lower} set`, 'flash-outline', 'strength', (c) => per(c).pbEvents, 1, ex));
      defs.push(count(`goal-crusher:${ex}`, 'Goal Crusher', `Reach your goal of ${meta.goalMax} ${lower} in one set`, 'star-outline', 'strength', (c) => per(c).bestSet, meta.goalMax, ex));
      const days = meta.totalDays;
      [[25, 'Quarter Way'], [50, 'Halfway There'], [75, 'Almost There']].forEach(([pct, name]) => {
        defs.push(count(`plan-${pct}:${ex}`, name, `Successfully complete ${pct}% of your ${lower} plan days`, 'map-outline', 'plan', (c) => per(c).completedDays, Math.ceil((days * pct) / 100), ex));
      });
      // The final day must be earned in sequence, not by jumping straight to it.
      defs.push({
        key: `plan-complete:${ex}`, name: 'Plan Complete', desc: `Finish the final day of your ${lower} plan`, icon: 'medal-outline', category: 'plan', exercise: ex,
        check: (c) => {
          const p = per(c);
          const need = Math.ceil(days * 0.75);
          const earned = p.finalDayDone && p.completedDays >= need;
          return { earned, current: earned ? 1 : 0, target: 1 };
        }
      });
    }
    return defs;
  }

  function buildContext(byEx, { goalState, today, maxSingles = {}, totalDays = {} }) {
    const dates = trainingDates(byEx);
    const cons = consistency(dates, goalState, today);
    const all = allWorkouts(byEx);
    const per = {};
    for (const ex of Object.keys(byEx || {})) {
      const list = all.filter((w) => w.exercise === ex);
      const done = new Set(list.filter((w) => w.completed).map((w) => w.day));
      per[ex] = {
        bestSet: Math.max(maxSingles[ex] || 0, 0, ...list.map(bestOf)),
        pbEvents: personalBestEvents(list).length,
        completedDays: done.size,
        finalDayDone: totalDays[ex] ? done.has(totalDays[ex]) : false
      };
    }
    return {
      dates,
      consistency: cons,
      completedSessions: all.filter((w) => w.completed).length,
      metWeeks: cons.metWeeks,
      bestConsecutiveMet: cons.bestConsecutiveMet,
      per
    };
  }

  const evaluate = (defs, ctx) => defs.map((def) => ({ def, ...def.check(ctx) }));

  const KEY_RE = /^[a-z0-9-]{1,40}(:[a-z]{1,20})?$/;
  function normalizeAwarded(raw) {
    const out = { version: 1, initialized: !!(raw && raw.initialized), awarded: {} };
    const src = raw && typeof raw.awarded === 'object' && raw.awarded ? raw.awarded : {};
    for (const [k, v] of Object.entries(src)) {
      if (!KEY_RE.test(k) || !v || typeof v !== 'object') continue;
      out.awarded[k] = { at: Number.isFinite(v.at) ? v.at : null, retro: !!v.retro };
    }
    return out;
  }

  // retro: found in existing history, so no timestamp is invented and nothing is celebrated.
  function award(state, results, { now, retro = false }) {
    const next = { ...state, initialized: true, awarded: { ...state.awarded } };
    const newly = [];
    for (const r of results) {
      if (!r.earned || next.awarded[r.def.key]) continue;
      next.awarded[r.def.key] = retro ? { at: null, retro: true } : { at: now, retro: false };
      newly.push(r.def);
    }
    return { state: next, newly };
  }

  function awardKey(state, key, now) {
    if (state.awarded[key]) return { state, added: false };
    return { state: { ...state, awarded: { ...state.awarded, [key]: { at: now, retro: false } } }, added: true };
  }

  function mergeAwarded(a, b) {
    const out = normalizeAwarded(a);
    const inc = normalizeAwarded(b);
    for (const [k, v] of Object.entries(inc.awarded)) {
      const cur = out.awarded[k];
      if (!cur || (cur.at === null && v.at !== null) || (v.at !== null && cur.at !== null && v.at < cur.at)) out.awarded[k] = v;
    }
    out.initialized = out.initialized || inc.initialized;
    return out;
  }

  function removeExerciseAwards(state, ex) {
    const awarded = {};
    for (const [k, v] of Object.entries(state.awarded)) if (!k.endsWith(`:${ex}`)) awarded[k] = v;
    return { ...state, awarded };
  }

  // ---------------------------------------------------------------------------
  // Weekly recap
  // ---------------------------------------------------------------------------
  function weekSummary(byEx, ws, { goalState, awarded = {} }) {
    const days = weekDays(ws);
    const end = days[6];
    const all = allWorkouts(byEx);
    const inWeek = all.filter((w) => w.date >= ws && w.date <= end);
    const trained = new Set(inWeek.map((w) => w.date));
    const goal = goalForWeek(goalState, ws);
    let best = null;
    for (const w of inWeek) {
      const b = bestOf(w);
      if (!best || b > best.reps) best = { reps: b, exercise: w.exercise, date: w.date };
    }
    const prs = [];
    for (const ex of new Set(inWeek.map((w) => w.exercise))) {
      const before = all.filter((w) => w.exercise === ex && w.date < ws).reduce((m, w) => Math.max(m, bestOf(w)), 0);
      const weekBest = inWeek.filter((w) => w.exercise === ex).reduce((m, w) => Math.max(m, bestOf(w)), 0);
      if (before > 0 && weekBest > before) prs.push({ exercise: ex, reps: weekBest, prev: before });
    }
    const achievements = Object.entries(awarded)
      .filter(([, v]) => v && v.at !== null && toISO(new Date(v.at)) >= ws && toISO(new Date(v.at)) <= end)
      .map(([key]) => key);
    const prevWs = addDays(ws, -7);
    const prev = all.filter((w) => w.date >= prevWs && w.date < ws);
    const totalReps = inWeek.reduce((a, w) => a + w.total, 0);
    return {
      ws,
      end,
      days: trained.size,
      goal,
      met: trained.size >= goal,
      totalReps,
      sessions: inWeek.length,
      completedSessions: inWeek.filter((w) => w.completed).length,
      partialSessions: inWeek.filter((w) => w.partial).length,
      exercises: [...new Set(inWeek.map((w) => w.exercise))],
      best,
      prs,
      achievements,
      timeline: days.map((d) => ({ date: d, reps: inWeek.filter((w) => w.date === d).reduce((a, w) => a + w.total, 0) })),
      // Volume only; strength claims come from `prs`, never from rep totals.
      previous: prev.length ? { days: new Set(prev.map((w) => w.date)).size, totalReps: prev.reduce((a, w) => a + w.total, 0) } : null
    };
  }

  // ---------------------------------------------------------------------------
  // Encouragement: factual, no guilt, no pressure to train through fatigue.
  // ---------------------------------------------------------------------------
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function encouragement(ctx) {
    const c = [];
    const add = (key, headline, message) => c.push({ key, headline, message });
    const ex = (ctx.exerciseName || 'rep').toLowerCase();

    if (ctx.kind === 'finish') {
      if (ctx.firstWorkout) add('first', 'Your journey starts here', `Great first session: ${plural(ctx.total, 'rep')} logged.`);
      if (ctx.newBest) add('pr', 'New best set!', `${ctx.newBest} ${ex} in one set. That's progress you can measure.`);
      if (ctx.weeklyJustMet) add('week-met', 'Weekly goal hit', 'You hit your weekly goal. Consistency is paying off.');
      if (ctx.planMilestone) add(`plan-${ctx.planMilestone}`, ctx.planMilestone === 100 ? 'Plan complete!' : `${ctx.planMilestone}% of your plan`, ctx.planMilestone === 50 ? "You're halfway toward your training goal!" : 'Another milestone on the way to your goal.');
      if (ctx.partial) add('partial', 'Every rep counts', `${plural(ctx.total, 'rep')} saved. Pick up from here next time.`);
      else if (!ctx.completed) add('tough', 'All sets done', `Today's targets were tough. Day ${ctx.day} comes around again next session.`);
      if (ctx.daysSinceLast !== null && ctx.daysSinceLast >= 7) add('welcome-back', 'Welcome back', 'Good to see you. You picked up right where you left off.');
      if (ctx.weekDays >= 3 && !ctx.weeklyJustMet) add('habit', `${ctx.weekDays} training days this week`, "You're building a habit.");
      if (ctx.delta !== null && ctx.delta > 0) add('more', 'Workout complete!', `You did ${plural(ctx.delta, 'more rep')} than your last ${ex} workout.`);
      if (ctx.completed) add('complete', 'Workout complete!', `You completed all ${ctx.setCount} sets. ${plural(ctx.total, 'rep')} done.`);
      add('logged', 'Session logged', 'Another session logged. Keep building.');
    } else if (ctx.kind === 'today') {
      const left = Math.max(0, ctx.goal - ctx.weekDays);
      if (ctx.doneToday) add('today-done', 'Nice work today', 'Recovery is part of training too.');
      else if (ctx.daysSinceLast === null) add('start', 'Ready when you are', 'Your first session sets your baseline.');
      else if (ctx.daysSinceLast >= 7) add('welcome-back', 'Welcome back', 'Pick up where you left off.');
      if (ctx.weekMet) add('week-met', 'Weekly goal met', 'Extra sessions are optional. Rest days count too.');
      else if (left > 0) add('week-left', 'This week', `${plural(left, 'more training day')} reaches your weekly goal.`);
      add('ready', 'Today', 'Show up, do your sets, and you are on track.');
    } else {
      if (ctx.days === 0) add('recap-quiet', 'A quiet week', 'Rest happens. A fresh week starts now.');
      else if (ctx.met) add('recap-met', 'Weekly goal met', "You're building consistency. Keep it going.");
      else add('recap-some', 'Every session counts', `${plural(ctx.days, 'training day')} logged. A fresh week starts now.`);
    }
    return c.find((m) => m.key !== ctx.lastKey) || c[0];
  }

  return {
    DEFAULT_GOAL, EPOCH, FREEZE_AFTER, CATEGORIES,
    parseISO, toISO, addDays, weekStart, weekDays, daysBetween, isISO,
    allWorkouts, trainingDates, bestOf, cmpWorkout,
    normalizeGoalState, goalForWeek, setWeeklyGoal,
    weekProgress, activeDayStreak, consistency,
    personalBestEvents, previousComparable,
    achievementDefs, buildContext, evaluate, normalizeAwarded, award, awardKey, mergeAwarded, removeExerciseAwards,
    weekSummary, encouragement
  };
});
