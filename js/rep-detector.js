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
    // Phone flat on the chest (sit-ups): the screen normal is the chest normal, so torso angle is absolute.
    chest: {
      gravityTau: 0.08,
      high: 60,          // degrees of torso lift that count as "up"
      low: 30,           // degrees that count as lying back down (re-arms the next rep)
      maxHigh: 75,       // low sensitivity must still be reachable by a normal sit-up
      minInterval: 0.6
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

  function createChest(cfg) {
    let g = null, lastT = null, angle = 0;
    let armed = false, up = false, lastRepT = -Infinity;

    function reset() { g = null; lastT = null; armed = false; up = false; }

    function push(x, y, z, t) {
      if (lastT === null || t <= lastT || t - lastT > 0.5) {
        g = [x, y, z]; lastT = t; return false;
      }
      const dt = t - lastT; lastT = t;
      const kg = kFor(dt, cfg.gravityTau);
      g[0] += (x - g[0]) * kg; g[1] += (y - g[1]) * kg; g[2] += (z - g[2]) * kg;
      // abs(): screen may face the chest or away. Divide by real gravity, not |g|: the torso's own
      // acceleration is along the chest (in the screen plane) and must not change the angle.
      angle = Math.acos(Math.min(1, Math.abs(g[2]) / 9.81)) * 180 / Math.PI;

      // Only count once the user has been seen lying back, so starting the set sitting up adds no rep.
      if (angle < cfg.low) { armed = true; up = false; return false; }
      if (armed && !up && angle > cfg.high && t - lastRepT >= cfg.minInterval) {
        up = true;
        lastRepT = t;
        return true;
      }
      return false;
    }

    return { push, reset, level: () => Math.min(1.5, angle / cfg.high), ready: () => armed };
  }

  function create(mode, opts = {}) {
    const f = SENSITIVITY[opts.sensitivity] || 1;
    if (mode === 'vertical') {
      const cfg = { ...DEFAULTS.vertical, ...opts };
      cfg.threshold *= f;
      return createVertical(cfg);
    }
    if (mode === 'chest') {
      const cfg = { ...DEFAULTS.chest, ...opts };
      cfg.high = Math.min(cfg.maxHigh, cfg.high * f);
      cfg.low = Math.min(cfg.low, cfg.high * 0.6);
      return createChest(cfg);
    }
    throw new Error(`Unknown rep detector mode: ${mode}`);
  }

  return { create, DEFAULTS, SENSITIVITY };
});
