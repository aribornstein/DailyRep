// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { create } = require('../js/rep-detector.js');

const HZ = 60;
const G = 9.81;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}
function rotate(v, axis, ang) {
  const [kx, ky, kz] = axis;
  const c = Math.cos(ang), s = Math.sin(ang);
  const dot = kx * v[0] + ky * v[1] + kz * v[2];
  const cross = [ky * v[2] - kz * v[1], kz * v[0] - kx * v[2], kx * v[1] - ky * v[0]];
  return [0, 1, 2].map((i) => v[i] * c + cross[i] * s + [kx, ky, kz][i] * dot * (1 - c));
}
function unit(r) {
  const v = [gauss(r), gauss(r), gauss(r)];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

// Feed a world-frame specific force f(t) (m/s^2, z up) and segment angle (rad) through a random pocket orientation.
function simulate(det, duration, worldForce, segAngle, { seed = 1, noise = 0.15, flipSign = false } = {}) {
  const r = rng(seed);
  const pocketAxis = unit(r), pocketAng = r() * Math.PI * 2;
  const hingeAxis = [1, 0, 0];
  let count = 0;
  for (let i = 0; i < duration * HZ; i++) {
    const t = i / HZ;
    let f = worldForce(t);
    f = rotate(f, hingeAxis, -segAngle(t));
    f = rotate(f, pocketAxis, pocketAng);
    f = f.map((x) => (flipSign ? -x : x) + gauss(r) * noise);
    if (det.push(f[0], f[1], f[2], t)) count++;
  }
  return count;
}

// Smooth up/hold/down/hold displacement profile; returns {pos, acc} at time t.
function cycleProfile({ amp, up, top, down, bottom, lead = 2 }) {
  const period = up + top + down + bottom;
  return (t) => {
    if (t < lead) return { pos: 0, acc: 0 };
    const tau = (t - lead) % period;
    if (tau < up) return { pos: amp * (1 - Math.cos(Math.PI * tau / up)) / 2, acc: amp * (Math.PI / up) ** 2 / 2 * Math.cos(Math.PI * tau / up) };
    if (tau < up + top) return { pos: amp, acc: 0 };
    const d = tau - up - top;
    if (d < down) return { pos: amp * (1 + Math.cos(Math.PI * d / down)) / 2, acc: -amp * (Math.PI / down) ** 2 / 2 * Math.cos(Math.PI * d / down) };
    return { pos: 0, acc: 0 };
  };
}

function pullups(n, opts, simOpts) {
  const prof = cycleProfile(opts);
  const period = opts.up + opts.top + opts.down + opts.bottom;
  const end = 2 + n * period;
  const det = create('vertical', simOpts?.detector);
  return simulate(det, end + 2,
    (t) => [0, 0, G + (t < end ? prof(t).acc : 0)],
    (t) => (t < end ? 0.08 * Math.sin(2 * Math.PI * t / period) : 0), // legs swing a little each rep
    simOpts);
}

function tiltReps(n, degrees, opts, simOpts) {
  const prof = cycleProfile({ amp: 1, ...opts });
  const period = opts.up + opts.top + opts.down + opts.bottom;
  const end = 2 + n * period;
  const det = create('tilt', simOpts?.detector);
  return simulate(det, end + 2,
    (t) => [0, 0, G + (t < end ? prof(t).acc * 0.4 : 0)],
    (t) => (t < end ? prof(t).pos * degrees * Math.PI / 180 : 0),
    simOpts);
}

test('pull-ups: steady reps across phone orientations', () => {
  for (let seed = 1; seed <= 8; seed++) {
    assert.equal(pullups(8, { amp: 0.5, up: 1.0, top: 0.3, down: 1.2, bottom: 0.6 }, { seed }), 8, `seed ${seed}`);
  }
});

test('pull-ups: dead-hang pauses between reps are not double counted', () => {
  assert.equal(pullups(6, { amp: 0.5, up: 0.9, top: 0.2, down: 1.0, bottom: 3.0 }, { seed: 3 }), 6);
});

test('pull-ups: pause at the top is one rep', () => {
  assert.equal(pullups(5, { amp: 0.5, up: 1.0, top: 1.5, down: 1.2, bottom: 0.5 }, { seed: 4 }), 5);
});

test('pull-ups: slow strict reps', () => {
  assert.equal(pullups(5, { amp: 0.5, up: 1.6, top: 0.3, down: 1.8, bottom: 0.8 }, { seed: 5 }), 5);
});

test('pull-ups: fast kipping-ish reps', () => {
  assert.equal(pullups(10, { amp: 0.45, up: 0.6, top: 0.1, down: 0.6, bottom: 0.2 }, { seed: 6 }), 10);
});

test('pull-ups: sign convention of the platform does not matter', () => {
  assert.equal(pullups(6, { amp: 0.5, up: 1.0, top: 0.3, down: 1.2, bottom: 0.6 }, { seed: 7, flipSign: true }), 6);
});

test('pull-ups: hanging still with sensor noise counts nothing', () => {
  const det = create('vertical');
  assert.equal(simulate(det, 30, () => [0, 0, G], () => 0, { seed: 9, noise: 0.25 }), 0);
});

test('pull-ups: walking to the bar at any pace adds no reps', () => {
  for (const hz of [1.0, 1.2, 1.4, 1.7, 2.0]) {
    const det = create('vertical');
    const walk = (t) => [0, 0, G + 1.5 * Math.sin(2 * Math.PI * hz * t)];
    assert.equal(simulate(det, 20, walk, (t) => 0.1 * Math.sin(Math.PI * hz * t), { seed: 12 }), 0, `${hz} Hz`);
  }
});

test('pull-ups: walk, then hang and do reps counts only the reps', () => {
  const prof = cycleProfile({ amp: 0.5, up: 1.0, top: 0.3, down: 1.2, bottom: 0.6, lead: 12 });
  const end = 12 + 6 * 3.1;
  const det = create('vertical');
  const f = (t) => [0, 0, G + (t < 10 ? 1.5 * Math.sin(2 * Math.PI * 1.4 * t) : t < end ? prof(t).acc : 0)];
  assert.equal(simulate(det, end + 2, f, () => 0, { seed: 13 }), 6);
});

test('pull-ups: high sensitivity catches very slow reps', () => {
  const slow = { amp: 0.45, up: 2.2, top: 0.3, down: 2.2, bottom: 0.8 };
  assert.equal(pullups(4, slow, { seed: 10, detector: { sensitivity: 'high' } }), 4);
});

test('pull-ups: gap in samples (screen locked) resets cleanly', () => {
  const det = create('vertical');
  for (let i = 0; i < 60; i++) det.push(0, 0, G, i / HZ);
  // 20 s later the phone is in a different orientation; must not produce a phantom rep.
  let c = 0;
  for (let i = 0; i < 120; i++) if (det.push(G, 0, 0, 21 + i / HZ)) c++;
  assert.equal(c, 0);
});

test('squats: full squats across phone orientations', () => {
  for (let seed = 1; seed <= 8; seed++) {
    assert.equal(tiltReps(10, 80, { up: 1.2, top: 0.3, down: 1.0, bottom: 0.6 }, { seed }), 10, `seed ${seed}`);
  }
});

test('squats: quarter squats (25 degrees) are not counted', () => {
  assert.equal(tiltReps(8, 25, { up: 1.0, top: 0.2, down: 1.0, bottom: 0.6 }, { seed: 2 }), 0);
});

test('squats: fast reps with no pause at the top', () => {
  assert.equal(tiltReps(15, 75, { up: 0.6, top: 0.1, down: 0.5, bottom: 0.05 }, { seed: 3 }), 15);
});

test('sit-ups: 70 degree torso rotation', () => {
  for (let seed = 11; seed <= 15; seed++) {
    assert.equal(tiltReps(12, 70, { up: 1.0, top: 0.2, down: 1.0, bottom: 0.4 }, { seed }), 12, `seed ${seed}`);
  }
});

test('sit-ups: crunch-sized 45 degree reps count on high sensitivity', () => {
  assert.equal(tiltReps(8, 45, { up: 0.8, top: 0.2, down: 0.8, bottom: 0.4 }, { seed: 4, detector: { sensitivity: 'high' } }), 8);
});

test('tilt: nothing counted before a still start pose is captured', () => {
  const det = create('tilt');
  assert.equal(det.ready(), false);
  for (let i = 0; i < 60; i++) det.push(0, 0, G, i / HZ);
  assert.equal(det.ready(), true);
});
