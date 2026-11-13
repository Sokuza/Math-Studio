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
    this.rulerHeight = 20;
    this.curveMode = false;
    this.trackHeight = 28;
    this.trackGap = 2;
    this.padTop = 4;

    this.playheadTime = keyframes.currentTime;
    this.selectedParam = null;
    this.selectedKeyframeIdx = -1;

    this._cssW = 0;
    this._cssH = 0;
    this._interaction = null;

    this.bindEvents();

    // Re-measure when the timeline panel is resized (splitters / window resize).
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.refresh()).observe(this.container);
    }

    this.refresh();
  }

  setCurveMode(enabled) {
    this.curveMode = enabled;
    this.trackHeight = enabled ? 48 : 28;
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
    if (!this.curveMode) return trackTop + this.trackHeight / 2;
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
    const style = getComputedStyle(this.container);
    this.colors = {
      panel: style.getPropertyValue('--workspace-panel'),
      inset: style.getPropertyValue('--workspace-inset'),
      divider: style.getPropertyValue('--workspace-divider'),
      text: style.getPropertyValue('--win-text-primary'),
      muted: style.getPropertyValue('--win-text-secondary'),
      highlight: style.getPropertyValue('--workspace-selected')
    };

    // Background
    ctx.fillStyle = this.colors.panel;
    ctx.fillRect(0, 0, w, h);

    // Gutter background
    ctx.fillStyle = this.colors.panel;
    ctx.fillRect(0, 0, this.gutterWidth, h);

    this.drawRuler(ctx, w);
    const names = this.getTrackNames();
    names.forEach((name, i) => this.drawTrack(ctx, name, i, w));
    this.drawPlayhead(ctx, h);
  }

  drawRuler(ctx, w) {
    const top = this.padTop;
    const bottom = top + this.rulerHeight;
    ctx.fillStyle = this.colors.inset;
    ctx.fillRect(this.gutterWidth, top, w - this.gutterWidth, this.rulerHeight);

    ctx.strokeStyle = this.colors.divider;
    ctx.fillStyle = this.colors.muted;
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
    ctx.strokeStyle = this.colors.divider;
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
    ctx.fillStyle = index % 2 === 0 ? this.colors.inset : this.colors.panel;
    ctx.fillRect(this.gutterWidth, top, w - this.gutterWidth, this.trackHeight);

    // Divider
    ctx.strokeStyle = this.colors.divider;
    ctx.beginPath();
    ctx.moveTo(this.gutterWidth, bottom);
    ctx.lineTo(w, bottom);
    ctx.stroke();

    // Parameter name + live value (gutter)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px "Consolas", monospace';
    ctx.fillStyle = this.colors.text;
    ctx.fillText(name, 10, top + (this.curveMode ? 16 : 14));
    ctx.font = '10px "Consolas", monospace';
    ctx.fillStyle = this.colors.muted;
    const liveVal = this.keyframes.evaluateParameter(name, this.playheadTime);
    const live = isFinite(liveVal) ? liveVal.toFixed(2) : '--';
    ctx.fillText(live, this.curveMode ? 10 : 54, top + (this.curveMode ? 32 : 14));

    const drag = this._interaction;
    const range = drag?.type === 'keyframe' && drag.param === name && drag.range
      ? drag.range : this.valueRange(param);
    if (this.curveMode) {
      // Value range labels
      ctx.fillStyle = this.colors.muted;
      ctx.font = '9px "Consolas", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(range.max.toFixed(1), this.gutterWidth - 6, top + 4);
      ctx.fillText(range.min.toFixed(1), this.gutterWidth - 6, bottom - 4);

      // Center reference line
      ctx.strokeStyle = this.colors.divider;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(this.gutterWidth, top + this.trackHeight / 2);
      ctx.lineTo(w, top + this.trackHeight / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Value curve
      const samples = 140;
      ctx.strokeStyle = this.colors.muted;
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
    }

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
      ctx.fillStyle = selected ? this.colors.text : this.colors.muted;
      ctx.fill();
      ctx.strokeStyle = selected ? this.colors.text : this.colors.highlight;
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
          return { param: name, idx, kf, x, y, range, top };
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
      if (e.button !== 0 || this._interaction) return;
      e.preventDefault();
      const { x, y } = this.pointerPos(e);
      this.canvas.setPointerCapture(e.pointerId);

      const hit = y >= this.padTop + this.rulerHeight ? this.hitTestKeyframe(x, y) : null;
      if (hit?.kf) {
        this.selectedParam = hit.param;
        this.selectedKeyframeIdx = hit.idx;
        // The value scale is fixed until release. Including the in-progress keyframe
        // in every new range would let it expand the scale on the next pointer move.
        this._interaction = {
          type: 'keyframe',
          pointerId: e.pointerId,
          param: hit.param,
          keyframe: hit.kf,
          range: this.curveMode ? hit.range : null,
          trackTop: hit.top,
          offsetX: x - hit.x,
          offsetY: y - hit.y,
          moved: false
        };
        this.onSelect(hit.param, hit.idx);
        this.draw();
      } else {
        this._interaction = { type: 'scrub', pointerId: e.pointerId };
        this.scrubTo(x);
        if (hit?.param) {
          this.selectedParam = hit.param;
          this.selectedKeyframeIdx = -1;
          this.onSelect(hit.param, -1);
          this.draw();
        }
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const drag = this._interaction;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { x, y } = this.pointerPos(e);
      if (drag.type === 'scrub') {
        this.scrubTo(x);
        return;
      }

      const keyframes = this.keyframes.parameters[drag.param]?.keyframes;
      const keyframe = drag.keyframe;
      if (!keyframes?.includes(keyframe)) return;

      const time = this.timeForX(x - drag.offsetX);
      let value = keyframe.value;
      if (drag.range) {
        const { min, max } = drag.range;
        const candidate = this.valueForY(y - drag.offsetY, drag.range, drag.trackTop);
        if (Number.isFinite(candidate)) value = Math.max(min, Math.min(max, candidate));
      }

      if (!Number.isFinite(time) || (time === keyframe.time && value === keyframe.value)) return;
      keyframe.time = time;
      keyframe.value = value;
      keyframes.sort((a, b) => a.time - b.time);
      this.selectedKeyframeIdx = keyframes.indexOf(keyframe);
      drag.moved = true;
      this.draw();
    });

    const finish = (e) => {
      const drag = this._interaction;
      if (!drag || e.pointerId !== drag.pointerId) return;
      this._interaction = null;
      if (drag.type !== 'keyframe' || !drag.moved) return;

      const idx = this.keyframes.parameters[drag.param]?.keyframes.indexOf(drag.keyframe);
      if (idx >= 0) this.onKeyframeChanged(drag.param, idx);
      this.draw();
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
    this.canvas.addEventListener('lostpointercapture', finish);

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
