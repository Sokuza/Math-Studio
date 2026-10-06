/**
 * TimelineEditor — interactive keyframe timeline / curve editor rendered under the 3D viewport.
 *
 * Draws one track (lane) per animated parameter, with:
 *   - a time ruler across the top,
 *   - the animated value curve for each parameter,
 *   - draggable keyframe diamonds (time on X, value on Y),
 *   - a synchronized playhead that scrubs playback,
 *   - click-to-select keyframes, double-click to add, and drag to retime/revalue.
 *
 * It is pure presentation + interaction over a KeyframeEngine; the App wires callbacks
 * so that edits immediately re-render the 3D scene and refresh the parameter list.
 */

export class TimelineEditor {
  constructor(containerId, keyframes, callbacks = {}) {
    this.container = document.getElementById(containerId);
    this.keyframes = keyframes;

    this.onSelect = callbacks.onSelect || (() => {});
    this.onScrub = callbacks.onScrub || (() => {});
    this.onKeyframeChanged = callbacks.onKeyframeChanged || (() => {});
    this.onAddKeyframe = callbacks.onAddKeyframe || (() => {});
    this.onDeleteKeyframe = callbacks.onDeleteKeyframe || (() => {});

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'timeline-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Layout constants (CSS px)
    this.gutterWidth = 92;
    this.rightPad = 18;
    this.rulerHeight = 26;
    this.trackHeight = 48;
    this.trackGap = 6;
    this.padTop = 4;

    this.playheadTime = keyframes.currentTime;
    this.selectedParam = null;
    this.selectedKeyframeIdx = -1;

    this._cssW = 0;
    this._cssH = 0;
    this._interaction = null; // { type: 'scrub' | 'keyframe', param, idx }

    this.bindEvents();

    // Re-measure when the timeline panel is resized (splitters / window resize).
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.refresh()).observe(this.container);
    }

    this.refresh();
  }

  // ---- Geometry helpers -----------------------------------------------------
  getTrackNames() {
    return Object.keys(this.keyframes.parameters);
  }

  contentHeight() {
    const n = this.getTrackNames().length;
    return this.padTop + this.rulerHeight + n * (this.trackHeight + this.trackGap) + 10;
  }

  plotWidth() {
    return Math.max(120, this._cssW - this.gutterWidth - this.rightPad);
  }

  trackTop(index) {
    return this.padTop + this.rulerHeight + index * (this.trackHeight + this.trackGap);
  }

  xForTime(t) {
    const d = this.keyframes.duration || 1;
    return this.gutterWidth + (t / d) * this.plotWidth();
  }

  timeForX(x) {
    const d = this.keyframes.duration || 1;
    const plotW = this.plotWidth();
    let t = ((x - this.gutterWidth) / plotW) * d;
    return Math.max(0, Math.min(d, t));
  }

  valueRange(param) {
    let min = isFinite(param.min) ? param.min : -10;
    let max = isFinite(param.max) ? param.max : 10;
    if (max - min < 1e-9) { max = min + 1; }
    // Expand to include actual keyframe values.
    param.keyframes.forEach((k) => {
      if (isFinite(k.value)) {
        min = Math.min(min, k.value);
        max = Math.max(max, k.value);
      }
    });
    const pad = (max - min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }

  yForValue(v, range, trackTop) {
    const span = range.max - range.min || 1;
    return trackTop + this.trackHeight - ((v - range.min) / span) * this.trackHeight;
  }

  valueForY(y, range, trackTop) {
    const span = range.max - range.min || 1;
    const frac = (trackTop + this.trackHeight - y) / this.trackHeight;
    return range.min + frac * span;
  }

  // ---- Resize & drawing -----------------------------------------------------
  resize() {
    const cssW = this.container.clientWidth || 320;
    const cssH = this.contentHeight();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = cssW;
    this._cssH = cssH;
  }

  refresh() {
    this.resize();
    this.draw();
  }

  setPlayhead(t) {
    this.playheadTime = t;
    this.draw();
  }

  setSelection(param, idx) {
    this.selectedParam = param;
    this.selectedKeyframeIdx = idx;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this._cssW;
    const h = this._cssH;
    if (!ctx || w === 0) return;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, w, h);

    // Gutter background
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, this.gutterWidth, h);

    this.drawRuler(ctx, w);
    const names = this.getTrackNames();
    names.forEach((name, i) => this.drawTrack(ctx, name, i, w));
    this.drawPlayhead(ctx, h);
  }

  drawRuler(ctx, w) {
    const top = this.padTop;
    const bottom = top + this.rulerHeight;
    ctx.fillStyle = '#1f1f1f';
    ctx.fillRect(this.gutterWidth, top, w - this.gutterWidth, this.rulerHeight);

    ctx.strokeStyle = '#333';
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const d = this.keyframes.duration || 1;
    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const t = (i / ticks) * d;
      const x = this.xForTime(t);
      ctx.beginPath();
      ctx.moveTo(x, bottom - 4);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillText(t.toFixed(1) + 's', x, top + 7);
    }
    ctx.strokeStyle = '#2c2c2c';
    ctx.beginPath();
    ctx.moveTo(this.gutterWidth, bottom);
    ctx.lineTo(w, bottom);
    ctx.stroke();
  }

  drawTrack(ctx, name, index, w) {
    const top = this.trackTop(index);
    const bottom = top + this.trackHeight;
    const param = this.keyframes.parameters[name];
    if (!param) return;

    // Lane background (alternate slightly)
    ctx.fillStyle = (index % 2 === 0) ? '#181818' : '#1a1a1a';
    ctx.fillRect(this.gutterWidth, top, w - this.gutterWidth, this.trackHeight);

    // Divider
    ctx.strokeStyle = '#262626';
    ctx.beginPath();
    ctx.moveTo(this.gutterWidth, bottom);
    ctx.lineTo(w, bottom);
    ctx.stroke();

    // Parameter name + live value (gutter)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px "Consolas", monospace';
    ctx.fillStyle = '#7dd0ff';
    ctx.fillText(name, 10, top + 16);
    ctx.font = '10px "Consolas", monospace';
    ctx.fillStyle = '#a0a0a0';
    const liveVal = this.keyframes.evaluateParameter(name, this.playheadTime);
    const live = isFinite(liveVal) ? liveVal.toFixed(2) : '--';
    ctx.fillText(live, 10, top + 32);

    // Value range labels
    const range = this.valueRange(param);
    ctx.fillStyle = '#6a6a6a';
    ctx.font = '9px "Consolas", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(range.max.toFixed(1), this.gutterWidth - 6, top + 4);
    ctx.fillText(range.min.toFixed(1), this.gutterWidth - 6, bottom - 4);

    // Center reference line
    ctx.strokeStyle = '#242424';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(this.gutterWidth, top + this.trackHeight / 2);
    ctx.lineTo(w, top + this.trackHeight / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Value curve
    const samples = 140;
    ctx.strokeStyle = '#ff9d2e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * (this.keyframes.duration || 1);
      const v = this.keyframes.evaluateParameter(name, t);
      const x = this.xForTime(t);
      const y = this.yForValue(v, range, top);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Keyframes
    param.keyframes.forEach((kf, idx) => {
      const x = this.xForTime(kf.time);
      const y = this.yForValue(kf.value, range, top);
      const selected = (this.selectedParam === name && this.selectedKeyframeIdx === idx);
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fillStyle = selected ? '#ffffff' : '#ff9d2e';
      ctx.fill();
      ctx.strokeStyle = selected ? '#0078d4' : '#8a4a00';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  drawPlayhead(ctx, h) {
    const x = this.xForTime(this.playheadTime);
    const grad = ctx.createLinearGradient(x - 1, 0, x + 1, 0);
    grad.addColorStop(0, 'rgba(0,120,212,0)');
    grad.addColorStop(0.5, '#4db8ff');
    grad.addColorStop(1, 'rgba(0,120,212,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 1, this.padTop, 2, h - this.padTop);
  }

  // ---- Hit testing & interactions ------------------------------------------
  hitTestKeyframe(px, py) {
    const names = this.getTrackNames();
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const top = this.trackTop(i);
      if (py < top || py > top + this.trackHeight) continue;
      const param = this.keyframes.parameters[name];
      const range = this.valueRange(param);
      for (let idx = 0; idx < param.keyframes.length; idx++) {
        const kf = param.keyframes[idx];
        const x = this.xForTime(kf.time);
        const y = this.yForValue(kf.value, range, top);
        if (Math.abs(px - x) <= 9 && Math.abs(py - y) <= 9) {
          return { param: name, idx, kf };
        }
      }
      return { param: name, idx: -1, kf: null };
    }
    return null;
  }

  trackIndexAt(py) {
    const names = this.getTrackNames();
    for (let i = 0; i < names.length; i++) {
      const top = this.trackTop(i);
      if (py >= top && py <= top + this.trackHeight) return i;
    }
    return -1;
  }

  pointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const { x, y } = this.pointerPos(e);
      this.canvas.setPointerCapture(e.pointerId);

      const inRuler = y < (this.padTop + this.rulerHeight);
      if (inRuler) {
        this._interaction = { type: 'scrub' };
        this.scrubTo(x);
        return;
      }

      const hit = this.hitTestKeyframe(x, y);
      if (hit && hit.kf) {
        this.selectedParam = hit.param;
        this.selectedKeyframeIdx = hit.idx;
        this.onSelect(hit.param, hit.idx);
        this._interaction = { type: 'keyframe', param: hit.param, idx: hit.idx, moved: false };
        this.draw();
      } else {
        this._interaction = { type: 'scrub' };
        this.scrubTo(x);
        if (hit && hit.param) {
          this.selectedParam = hit.param;
          this.onSelect(hit.param, -1);
          this.draw();
        }
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this._interaction) return;
      const { x, y } = this.pointerPos(e);
      if (this._interaction.type === 'scrub') {
        this.scrubTo(x);
      } else if (this._interaction.type === 'keyframe') {
        const param = this.keyframes.parameters[this._interaction.param];
        if (!param) return;
        const kf = param.keyframes[this._interaction.idx];
        if (!kf) return;
        const range = this.valueRange(param);
        const top = this.trackTop(this.getTrackNames().indexOf(this._interaction.param));
        kf.time = this.timeForX(x);
        kf.value = Math.max(range.min, Math.min(range.max, this.valueForY(y, range, top)));
        // Keep keyframes sorted while dragging.
        param.keyframes.sort((a, b) => a.time - b.time);
        this._interaction.moved = true;
        this.draw();
      }
    });

    const finish = (e) => {
      if (!this._interaction) return;
      const inter = this._interaction;
      this._interaction = null;
      if (inter.type === 'keyframe' && inter.moved) {
        this.onKeyframeChanged(inter.param, inter.idx);
      }
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);

    this.canvas.addEventListener('dblclick', (e) => {
      const { x, y } = this.pointerPos(e);
      const idx = this.trackIndexAt(y);
      if (idx < 0) return;
      const names = this.getTrackNames();
      const param = names[idx];
      const t = this.timeForX(x);
      const current = this.keyframes.evaluateParameter(param, t);
      this.onAddKeyframe(param, t, current);
    });

    // Touch / mouse wheel: vertical scroll handled by the wrapping container.
  }

  scrubTo(x) {
    const t = this.timeForX(x);
    this.playheadTime = t;
    this.onScrub(t);
    this.draw();
  }
}
