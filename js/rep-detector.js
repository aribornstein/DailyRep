// Accelerometer rep counting. Pure logic (no DOM) so it runs in the browser and in Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RepDetector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SENSITIVITY = { low: 1.35, normal: 1, high: 0.7 };

  const DEFAULTS = {
    // Body stays upright (pull-ups): count up/down cycles of acceleration along gravity.
    vertical: {
      gravityTau: 2.0,   // s, slow enough that the rep itself is not absorbed into "gravity"
      smoothTau: 0.08,   // s
      threshold: 0.6,    // m/s^2
      minLobe: 0.12,     // s an acceleration phase must last to be real
      minCycle: 0.45,    // s from upward push to top; rejects footsteps/jiggle
      maxCycle: 4,       // s
      minInterval: 0.8,  // s between counted reps
      armTime: 0.6       // s of quiet (e.g. hanging) before counting; walking never gets quiet
    },
    // Body segment rotates (thigh for squats, torso for sit-ups): count tilt away from a still pose and back.
    tilt: {
      gravityTau: 0.15,
      high: 40,          // degrees from start pose to count as "down"
      low: 18,           // degrees to count as returned
      minDown: 0.2,      // s spent past `high`
      minInterval: 0.6,
      stillTol: 0.6,     // m/s^2 deviation of |a| from gravity
      stillTime: 0.5,    // s of stillness needed to capture the start pose
      baselineTau: 3     // s, slow re-centering while resting in the start pose
    }
  };

  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const kFor = (dt, tau) => 1 - Math.exp(-dt / tau);

  function createVertical(cfg) {
    let g = null, s = 0, lastT = null;
    let phase = 0, lobeStart = 0, lobeConfirmed = false;
    let lastLobe = 0, lastPosStart = -Infinity, lastRepT = -Infinity;
    let level = 0, armed = false, quietSince = null;

    function reset() { g = null; s = 0; lastT = null; phase = 0; lobeConfirmed = false; lastLobe = 0; armed = false; quietSince = null; }

    function push(x, y, z, t) {
      if (lastT === null || t <= lastT || t - lastT > 0.5) {
        // First sample or a gap (screen locked / tab hidden): restart filters, keep nothing stale.
        reset(); g = [x, y, z]; lastT = t; return false;
      }
      const dt = t - lastT; lastT = t;
      const kg = kFor(dt, cfg.gravityTau);
      g[0] += (x - g[0]) * kg; g[1] += (y - g[1]) * kg; g[2] += (z - g[2]) * kg;
      const gl = len(g) || 1;
      const av = ((x - g[0]) * g[0] + (y - g[1]) * g[1] + (z - g[2]) * g[2]) / gl;
      s += (av - s) * kFor(dt, cfg.smoothTau);

      const T = cfg.threshold;
      level = Math.min(1.5, Math.abs(s) / T);
      let next = phase;
      if (s > T) next = 1;
      else if (s < -T) next = -1;
      else if (Math.abs(s) < T * 0.5) next = 0;
      if (next !== phase) { phase = next; lobeStart = t; lobeConfirmed = false; }

      if (Math.abs(s) < T * 0.5) {
        if (quietSince === null) quietSince = t;
        if (!armed && t - quietSince >= cfg.armTime) armed = true;
      } else quietSince = null;

      if (phase === 0 || lobeConfirmed || t - lobeStart < cfg.minLobe) return false;
      lobeConfirmed = true;
      let counted = false;
      if (phase === -1 && lastLobe === 1) {
        const cycle = t - lastPosStart;
        if (cycle < cfg.minCycle) armed = false;
        else if (armed && cycle <= cfg.maxCycle && t - lastRepT >= cfg.minInterval) {
          counted = true;
          lastRepT = t;
        }
      }
      if (phase === 1) lastPosStart = lobeStart;
      lastLobe = phase;
      return counted;
    }

    return { push, reset, level: () => level, ready: () => armed };
  }

  function createTilt(cfg) {
    let g = null, lastT = null, base = null;
    let dev = 0, stillSince = null, down = false, downSince = 0, lastRepT = -Infinity;
    let angle = 0;

    function reset() { g = null; lastT = null; base = null; dev = 0; stillSince = null; down = false; }

    function push(x, y, z, t) {
      if (lastT === null || t <= lastT || t - lastT > 0.5) {
        // Keep the captured start pose across gaps; only restart the filters.
        g = [x, y, z]; lastT = t; dev = 0; stillSince = null; return false;
      }
      const dt = t - lastT; lastT = t;
      const kg = kFor(dt, cfg.gravityTau);
      g[0] += (x - g[0]) * kg; g[1] += (y - g[1]) * kg; g[2] += (z - g[2]) * kg;
      const gl = len(g) || 1;
      const u = [g[0] / gl, g[1] / gl, g[2] / gl];

      dev += (Math.abs(Math.hypot(x, y, z) - gl) - dev) * kFor(dt, 0.2);
      if (dev < cfg.stillTol) { if (stillSince === null) stillSince = t; } else stillSince = null;
      const still = stillSince !== null && t - stillSince >= cfg.stillTime;

      if (!base) {
        if (still) base = u;
        angle = 0;
        return false;
      }

      const dot = Math.max(-1, Math.min(1, u[0] * base[0] + u[1] * base[1] + u[2] * base[2]));
      angle = Math.acos(dot) * 180 / Math.PI;

      if (!down && still && angle < cfg.low) {
        // Phone shifts in a pocket over a set; drift the start pose toward the current still pose.
        const kb = kFor(dt, cfg.baselineTau);
        const b = [base[0] + (u[0] - base[0]) * kb, base[1] + (u[1] - base[1]) * kb, base[2] + (u[2] - base[2]) * kb];
        const bl = len(b) || 1;
        base = [b[0] / bl, b[1] / bl, b[2] / bl];
      }

      if (!down && angle > cfg.high) { down = true; downSince = t; return false; }
      if (down && angle < cfg.low) {
        down = false;
        if (t - downSince >= cfg.minDown && t - lastRepT >= cfg.minInterval) { lastRepT = t; return true; }
      }
      return false;
    }

    return {
      push,
      reset,
      level: () => (base ? Math.min(1.5, angle / cfg.high) : 0),
      ready: () => !!base
    };
  }

  function create(mode, opts = {}) {
    const f = SENSITIVITY[opts.sensitivity] || 1;
    if (mode === 'vertical') {
      const cfg = { ...DEFAULTS.vertical, ...opts };
      cfg.threshold *= f;
      return createVertical(cfg);
    }
    if (mode === 'tilt') {
      const cfg = { ...DEFAULTS.tilt, ...opts };
      cfg.high *= f;
      cfg.low = Math.min(cfg.low, cfg.high * 0.6);
      return createTilt(cfg);
    }
    throw new Error(`Unknown rep detector mode: ${mode}`);
  }

  return { create, DEFAULTS, SENSITIVITY };
});
