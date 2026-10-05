/**
 * Keyframe Animation Engine with Parameter Management & Arbitrary Nested Composite Transitions.
 * Allows animating any parameter with custom nested functions g(f(tau)) between keyframes.
 */

import * as math from 'mathjs';

export class KeyframeEngine {
  constructor() {
    this.parameters = {}; // name -> { name, defaultVal, min, max, keyframes: [ { time, value, transition } ] }
    this.currentTime = 0;
    this.duration = 8.0; // seconds
    this.fps = 60;
    this.isPlaying = false;
    this.playbackSpeed = 1.0;
    this.loop = true;
    this.listeners = [];

    // Initialize standard parameters
    this.addParameter('A', 2.0, 0, 10);
    this.addParameter('omega', 1.5, 0, 10);
    this.addParameter('phi', 0.0, -Math.PI, Math.PI);
    this.addParameter('R', 3.0, 0.1, 10);

    // Set initial demo keyframes for 'A'
    this.addKeyframe('A', 0, 1.0);
    this.addKeyframe('A', 4.0, 3.5, {
      outerFunc: 'sin(pi/2 * x)',
      innerFunc: 'x^2'
    });
    this.addKeyframe('A', 8.0, 1.0, {
      outerFunc: '1 / (1 + exp(-8 * (x - 0.5)))',
      innerFunc: 'x'
    });

    // Set initial demo keyframes for 'phi'
    this.addKeyframe('phi', 0, 0);
    this.addKeyframe('phi', 8.0, Math.PI * 2, {
      outerFunc: 'x',
      innerFunc: 'x'
    });
  }

  addParameter(name, defaultVal = 1.0, min = -10, max = 10) {
    if (!this.parameters[name]) {
      this.parameters[name] = {
        name,
        defaultVal,
        currentVal: defaultVal,
        min,
        max,
        keyframes: []
      };
    }
    return this.parameters[name];
  }

  removeParameter(name) {
    delete this.parameters[name];
  }

  addKeyframe(paramName, time, value, transition = null) {
    const param = this.parameters[paramName];
    if (!param) return;

    const defaultTransition = {
      outerFunc: 'x',          // g(u)
      innerFunc: 'x',          // f(tau)
      type: 'composite'
    };

    const trans = transition ? Object.assign({}, defaultTransition, transition) : defaultTransition;

    // Remove existing keyframe at exact time if present
    param.keyframes = param.keyframes.filter(k => Math.abs(k.time - time) > 0.01);
    param.keyframes.push({ time, value, transition: trans });
    // Keep keyframes sorted by time
    param.keyframes.sort((a, b) => a.time - b.time);
  }

  removeKeyframe(paramName, index) {
    const param = this.parameters[paramName];
    if (param && param.keyframes[index]) {
      param.keyframes.splice(index, 1);
    }
  }

  // Evaluate transition function g(f(tau)) where tau in [0, 1]
  evaluateTransition(tau, transition) {
    const clampedTau = Math.max(0, Math.min(1, tau));
    if (!transition) return clampedTau;

    try {
      // 1. Evaluate inner function u = f(tau)
      const innerExpr = transition.innerFunc || 'x';
      const uVal = math.evaluate(innerExpr, { x: clampedTau, pi: Math.PI, e: Math.E });
      const safeU = isFinite(uVal) ? uVal : clampedTau;

      // 2. Evaluate outer function w = g(u)
      const outerExpr = transition.outerFunc || 'x';
      const wVal = math.evaluate(outerExpr, { x: safeU, pi: Math.PI, e: Math.E });
      return isFinite(wVal) ? wVal : clampedTau;
    } catch (e) {
      return clampedTau; // fallback to linear on syntax error
    }
  }

  // Evaluate single parameter value at specific time t
  evaluateParameter(paramName, t) {
    const param = this.parameters[paramName];
    if (!param) return 0;
    if (param.keyframes.length === 0) return param.defaultVal;
    if (param.keyframes.length === 1) return param.keyframes[0].value;

    const kfs = param.keyframes;
    if (t <= kfs[0].time) return kfs[0].value;
    if (t >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    // Find bounding keyframes [k1, k2]
    for (let i = 0; i < kfs.length - 1; i++) {
      const k1 = kfs[i];
      const k2 = kfs[i + 1];
      if (t >= k1.time && t <= k2.time) {
        const span = k2.time - k1.time;
        if (span <= 0.0001) return k1.value;
        const tau = (t - k1.time) / span;
        const progress = this.evaluateTransition(tau, k1.transition);
        return k1.value + (k2.value - k1.value) * progress;
      }
    }
    return kfs[kfs.length - 1].value;
  }

  // Evaluate all parameters at time t and return a key-value dictionary
  evaluateAll(t) {
    const scope = { t };
    for (const name in this.parameters) {
      scope[name] = this.evaluateParameter(name, t);
    }
    return scope;
  }

  // Animation Playback Methods
  step(deltaSeconds) {
    if (!this.isPlaying) return;
    this.currentTime += deltaSeconds * this.playbackSpeed;
    if (this.currentTime > this.duration) {
      if (this.loop) {
        this.currentTime = 0;
      } else {
        this.currentTime = this.duration;
        this.isPlaying = false;
      }
    }
    this.notifyUpdate();
  }

  setTime(t) {
    this.currentTime = Math.max(0, Math.min(this.duration, t));
    this.notifyUpdate();
  }

  play() {
    this.isPlaying = true;
  }

  pause() {
    this.isPlaying = false;
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  notifyUpdate() {
    for (const cb of this.listeners) {
      cb(this.currentTime, this.evaluateAll(this.currentTime));
    }
  }
}
