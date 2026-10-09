// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../js/engagement.js');

const W = (date, sets, extra = {}) => ({ date, day: 1, sets, total: sets.reduce((a, b) => a + b, 0), completed: true, partial: false, ...extra });
const goal = (g = 3, extra = {}) => E.normalizeGoalState({ history: [{ from: E.EPOCH, goal: g }], ...extra });
const EXERCISES = {
  pushups: { name: 'Push-ups', goalMax: 100, totalDays: 100, milestones: [25, 50, 100] },
  pullups: { name: 'Pull-ups', goalMax: 8, totalDays: 100, milestones: [5, 10, 20] }
};
const ctxFor = (byEx, opts = {}) => E.buildContext(byEx, {
  goalState: opts.goalState || goal(), today: opts.today || '2026-10-09', maxSingles: opts.maxSingles, totalDays: { pushups: 100, pullups: 100 }
});
const earnedKeys = (byEx, opts) => E.evaluate(E.achievementDefs(EXERCISES), ctxFor(byEx, opts)).filter((r) => r.earned).map((r) => r.def.key).sort();

// --- dates ------------------------------------------------------------------
test('weeks start on Monday, including across a year boundary', () => {
  assert.equal(E.weekStart('2026-10-09'), '2026-10-05'); // Friday -> Monday
  assert.equal(E.weekStart('2026-10-05'), '2026-10-05');
  assert.equal(E.weekStart('2026-10-11'), '2026-10-05'); // Sunday belongs to the week before
  assert.equal(E.weekStart('2027-01-01'), '2026-12-28');
  assert.deepEqual(E.weekDays('2026-12-28').slice(3), ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
});

test('date math is stable across DST changes', () => {
  assert.equal(E.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(E.daysBetween('2026-10-24', '2026-10-27'), 3);
});

// --- weekly goals -------------------------------------------------------------
test('weekly goal counts unique dates across exercises and sessions', () => {
  const byEx = {
    pushups: [W('2026-10-05', [10]), W('2026-10-05', [12], { day: 2 }), W('2026-10-07', [10])],
    pullups: [W('2026-10-05', [3]), W('2026-10-08', [3])]
  };
  const c = E.consistency(E.trainingDates(byEx), goal(3), '2026-10-09');
  assert.equal(c.current.days, 3);
  assert.equal(c.current.met, true);
});

test('zero-rep workouts do not count as training days', () => {
  const dates = E.trainingDates({ pushups: [W('2026-10-05', [0, 0])] });
  assert.equal(dates.size, 0);
});

test('the in-progress week is never counted as missed', () => {
  const byEx = { pushups: ['2026-09-28', '2026-09-30', '2026-10-02'].map((d) => W(d, [10])) };
  const c = E.consistency(E.trainingDates(byEx), goal(3), '2026-10-06'); // Tuesday, nothing yet this week
  assert.equal(c.streak, 1);
  assert.equal(c.current.met, false);
});

test('planned rest days do not break the consistency streak', () => {
  // 3 per week, different weekdays each week, with 4 rest days every week.
  const dates = ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-22', '2026-09-24', '2026-09-27', '2026-09-28', '2026-10-01', '2026-10-04'];
  const c = E.consistency(new Set(dates), goal(3), '2026-10-09');
  assert.equal(c.streak, 3);
  assert.equal(E.activeDayStreak(new Set(dates), '2026-10-09'), 0);
});

test('a missed completed week resets the streak (freeze off)', () => {
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-28', '2026-09-29', '2026-09-30'];
  const c = E.consistency(new Set(dates), goal(3, { freeze: false }), '2026-10-09');
  assert.equal(c.weeks.find((w) => w.ws === '2026-09-21').status, 'missed');
  assert.equal(c.streak, 1, 'only the week after the miss counts');
  assert.equal(c.lastWeek.status, 'met');
});

test('streak across the new year', () => {
  const dates = ['2026-12-21', '2026-12-23', '2026-12-28', '2026-12-31', '2027-01-04', '2027-01-06'];
  const c = E.consistency(new Set(dates), goal(2), '2027-01-07');
  assert.equal(c.streak, 3);
});

test('goal changes apply prospectively and never rewrite past weeks', () => {
  let s = goal(2);
  const dates = new Set(['2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30']);
  const before = E.consistency(dates, s, '2026-10-06');
  ({ state: s } = E.setWeeklyGoal(s, 5, '2026-10-06', false));
  const after = E.consistency(dates, s, '2026-10-06');
  assert.equal(before.streak, 2);
  assert.equal(after.streak, 2, 'past weeks keep their old goal');
  assert.equal(after.current.goal, 5);
});

test('raising/lowering the goal after training this week starts next Monday', () => {
  let s = goal(5);
  const r = E.setWeeklyGoal(s, 2, '2026-10-08', true);
  assert.equal(r.effectiveFrom, '2026-10-12');
  const dates = new Set(['2026-10-05', '2026-10-06']);
  assert.equal(E.consistency(dates, r.state, '2026-10-08').current.met, false, 'cannot instantly "meet" this week');
  assert.equal(E.goalForWeek(r.state, '2026-10-12'), 2);
});

test('changing the goal twice before it applies keeps only the latest', () => {
  let s = goal(3);
  s = E.setWeeklyGoal(s, 4, '2026-10-08', true).state;
  s = E.setWeeklyGoal(s, 5, '2026-10-09', true).state;
  assert.deepEqual(s.history.map((h) => h.goal), [3, 5]);
});

// --- streak freeze ----------------------------------------------------------
const weeksMet = (mondays, perWeek = 3) => mondays.flatMap((m) => Array.from({ length: perWeek }, (_, i) => E.addDays(m, i)));

test('freeze forgives one missed week after 3 met weeks, without counting it', () => {
  const dates = new Set(weeksMet(['2026-08-24', '2026-08-31', '2026-09-07', /* 09-14 missed */ '2026-09-21', '2026-09-28']));
  const c = E.consistency(dates, goal(3), '2026-10-06');
  assert.equal(c.weeks.find((w) => w.ws === '2026-09-14').status, 'frozen');
  assert.equal(c.streak, 5, '5 met weeks; the frozen week is not counted');
  assert.equal(c.metWeeks, 5);
  assert.equal(c.bestConsecutiveMet, 3, 'achievements need truly consecutive met weeks');
});

test('freeze cannot be used twice in a row or without 3 met weeks first', () => {
  const dates = new Set(weeksMet(['2026-08-24', '2026-08-31', '2026-09-07', /* miss */ '2026-09-21' /* miss */]));
  const c = E.consistency(dates, goal(3), '2026-10-06');
  assert.equal(c.weeks.find((w) => w.ws === '2026-09-14').status, 'frozen');
  assert.equal(c.weeks.find((w) => w.ws === '2026-09-28').status, 'missed');
  assert.equal(c.streak, 0);
});

// --- achievements -----------------------------------------------------------
test('workout-count achievements need full (completed) workouts', () => {
  const partials = { pushups: [W('2026-10-05', [10, 5, 0, 0, 0], { completed: false, partial: true })] };
  assert.ok(!earnedKeys(partials).includes('first-workout'));
  const full = { pushups: [W('2026-10-05', [10, 9, 8, 7, 6])] };
  assert.ok(earnedKeys(full).includes('first-workout'));
});

test('rep thresholds are exercise-aware and include the max test', () => {
  const keys = earnedKeys({ pushups: [W('2026-10-05', [26, 20])], pullups: [W('2026-10-05', [6, 5])] }, { maxSingles: { pullups: 11 } });
  assert.ok(keys.includes('set-25:pushups'));
  assert.ok(!keys.includes('set-50:pushups'));
  assert.ok(keys.includes('set-5:pullups') && keys.includes('set-10:pullups'));
  assert.ok(keys.includes('goal-crusher:pullups'));
  assert.ok(!keys.includes('goal-crusher:pushups'));
});

test('personal best needs an earlier recorded best', () => {
  assert.ok(!earnedKeys({ pushups: [W('2026-10-05', [30])] }).includes('personal-best:pushups'));
  assert.ok(earnedKeys({ pushups: [W('2026-10-01', [30]), W('2026-10-05', [31])] }).includes('personal-best:pushups'));
  assert.ok(!earnedKeys({ pushups: [W('2026-10-01', [30]), W('2026-10-05', [30])] }).includes('personal-best:pushups'), 'a tie is not a new best');
});

test('plan milestones count successfully completed plan days, not jumps', () => {
  const jumped = { pushups: [W('2026-10-05', [80], { day: 100 })] };
  const keys = earnedKeys(jumped);
  assert.ok(!keys.includes('plan-25:pushups'));
  assert.ok(!keys.includes('plan-complete:pushups'), 'completing day 100 after jumping is not a completed plan');
  const quarter = { pushups: Array.from({ length: 25 }, (_, i) => W(E.addDays('2026-08-01', i), [20], { day: i + 1 })) };
  assert.ok(earnedKeys(quarter).includes('plan-25:pushups'));
  const failed = { pushups: Array.from({ length: 25 }, (_, i) => W(E.addDays('2026-08-01', i), [20], { day: i + 1, completed: false })) };
  assert.ok(!earnedKeys(failed).includes('plan-25:pushups'));
});

test('consistency achievements follow met weeks', () => {
  const byEx = { pushups: weeksMet(['2026-09-14', '2026-09-21']).map((d) => W(d, [10])) };
  const keys = earnedKeys(byEx, { today: '2026-10-06' });
  assert.ok(keys.includes('strong-week') && keys.includes('two-strong-weeks'));
  assert.ok(!keys.includes('consistency-champion'));
});

test('awards never duplicate and keep their original timestamp', () => {
  const defs = E.achievementDefs(EXERCISES);
  const results = E.evaluate(defs, ctxFor({ pushups: [W('2026-10-05', [26])] }));
  let s = E.normalizeAwarded(null);
  const first = E.award(s, results, { now: 1000 });
  const second = E.award(first.state, results, { now: 2000 });
  assert.ok(first.newly.length > 0);
  assert.equal(second.newly.length, 0);
  assert.equal(second.state.awarded['first-workout'].at, 1000);
});

test('retrospective awards have no invented timestamp and are flagged', () => {
  const results = E.evaluate(E.achievementDefs(EXERCISES), ctxFor({ pushups: [W('2026-10-05', [26])] }));
  const { state, newly } = E.award(E.normalizeAwarded(null), results, { now: 5, retro: true });
  assert.ok(newly.length >= 2);
  for (const k of newly.map((d) => d.key)) assert.deepEqual(state.awarded[k], { at: null, retro: true });
  assert.equal(state.initialized, true);
});

test('wiping an exercise removes only that exercise\'s achievements', () => {
  const s = E.normalizeAwarded({ awarded: { 'first-workout': { at: 1 }, 'set-25:pushups': { at: 2 }, 'set-5:pullups': { at: 3 } } });
  assert.deepEqual(Object.keys(E.removeExerciseAwards(s, 'pushups').awarded).sort(), ['first-workout', 'set-5:pullups']);
});

// --- comparisons ------------------------------------------------------------
test('previous comparable skips partial sessions and never compares a partial one', () => {
  const list = [W('2026-10-01', [20]), W('2026-10-03', [5], { partial: true, day: 2 }), W('2026-10-05', [22], { day: 2 })];
  assert.equal(E.previousComparable(list, list[2]).date, '2026-10-01');
  assert.equal(E.previousComparable(list, list[1]), null);
  assert.equal(E.previousComparable([list[2]], list[2]), null);
});

// --- recap ------------------------------------------------------------------
test('week summary: volume, PRs, previous week and empty weeks', () => {
  const byEx = {
    pushups: [W('2026-09-29', [20, 18]), W('2026-10-05', [22, 18]), W('2026-10-05', [10], { day: 2, partial: true, completed: false }), W('2026-10-07', [21])],
    pullups: [W('2026-10-07', [4])]
  };
  const awarded = { 'strong-week': { at: new Date(2026, 9, 7, 18).getTime() }, 'first-workout': { at: null, retro: true } };
  const s = E.weekSummary(byEx, '2026-10-05', { goalState: goal(2), awarded });
  assert.equal(s.days, 2);
  assert.equal(s.met, true);
  assert.equal(s.sessions, 4);
  assert.equal(s.partialSessions, 1);
  assert.equal(s.totalReps, 40 + 10 + 21 + 4);
  assert.deepEqual(s.best, { reps: 22, exercise: 'pushups', date: '2026-10-05' });
  assert.deepEqual(s.prs, [{ exercise: 'pushups', reps: 22, prev: 20 }]);
  assert.deepEqual(s.achievements, ['strong-week']);
  assert.deepEqual(s.previous, { days: 1, totalReps: 38 });
  const empty = E.weekSummary(byEx, '2026-10-12', { goalState: goal(2) });
  assert.equal(empty.days, 0);
  assert.equal(empty.best, null);
  const first = E.weekSummary(byEx, '2026-09-28', { goalState: goal(2) });
  assert.equal(first.previous, null);
  assert.deepEqual(first.prs, [], 'first week has nothing to beat');
});

// --- encouragement ----------------------------------------------------------
const finish = (o) => E.encouragement({ kind: 'finish', exerciseName: 'Push-ups', total: 80, setCount: 5, day: 3, completed: true, partial: false, firstWorkout: false, newBest: 0, weeklyJustMet: false, planMilestone: 0, daysSinceLast: 1, weekDays: 1, delta: null, ...o });

test('encouragement picks the most relevant factual message', () => {
  assert.equal(finish({ firstWorkout: true }).key, 'first');
  assert.equal(finish({ newBest: 31 }).key, 'pr');
  assert.match(finish({ newBest: 31 }).message, /31 push-ups/);
  assert.equal(finish({ partial: true, completed: false }).key, 'partial');
  assert.equal(finish({ completed: false }).key, 'tough');
  assert.equal(finish({ daysSinceLast: 12 }).key, 'welcome-back');
  assert.match(finish({ delta: 8 }).message, /8 more reps than your last push-ups workout/);
  assert.equal(finish({}).key, 'complete');
});

test('encouragement never claims a best or improvement without data', () => {
  const m = finish({ delta: null, newBest: 0 });
  assert.doesNotMatch(m.message + m.headline, /best|more reps/i);
  assert.equal(finish({ delta: -5 }).key, 'complete');
});

test('encouragement avoids repeating the last message', () => {
  assert.equal(finish({ newBest: 31, lastKey: 'pr' }).key, 'complete');
});

test('encouragement never uses guilt wording', () => {
  const all = [finish({ completed: false }), finish({ partial: true, completed: false }),
    E.encouragement({ kind: 'recap', days: 0 }), E.encouragement({ kind: 'recap', days: 1, met: false }),
    E.encouragement({ kind: 'today', goal: 3, weekDays: 0, daysSinceLast: 20 })];
  for (const m of all) assert.doesNotMatch(`${m.headline} ${m.message}`, /fail|lazy|missed|should have|disappoint/i);
});

// --- persistence compatibility ------------------------------------------------
test('malformed engagement data is ignored safely', () => {
  assert.deepEqual(E.normalizeGoalState({ history: [{ from: 'x', goal: 9 }, null], freeze: 'yes' }).history, [{ from: E.EPOCH, goal: 3 }]);
  const a = E.normalizeAwarded({ awarded: { '<img>': { at: 1 }, 'first-workout': { at: 'soon' }, 'set-25:pushups': 7 } });
  assert.deepEqual(a.awarded, { 'first-workout': { at: null, retro: false } });
  assert.equal(E.normalizeAwarded(undefined).initialized, false);
});

test('import merge is a union that keeps the earliest real timestamp', () => {
  const cur = { initialized: true, awarded: { 'first-workout': { at: null, retro: true }, 'strong-week': { at: 50 } } };
  const inc = { awarded: { 'first-workout': { at: 10 }, 'strong-week': { at: 90 }, 'committed': { at: 20 } } };
  const m = E.mergeAwarded(cur, inc);
  assert.equal(m.awarded['first-workout'].at, 10);
  assert.equal(m.awarded['strong-week'].at, 50);
  assert.equal(m.awarded.committed.at, 20);
  assert.equal(m.initialized, true);
});

test('older exports without engagement fields still evaluate retrospectively', () => {
  const legacy = { pushups: [{ date: '2026-10-01', day: 1, sets: [26, 24, 23, 21, 20], total: 114 }] }; // no completed/partial fields
  const keys = earnedKeys(legacy);
  assert.ok(keys.includes('set-25:pushups'));
  assert.ok(!keys.includes('first-workout'), 'completion is unknown here; the app derives it before evaluating');
});
