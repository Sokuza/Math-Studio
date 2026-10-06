/**
 * Main Application Orchestrator for "数学函数表达式工具" (Windows 11 Fluent Edition).
 * Connects Viewport3D, ExpressionParser, KeyframeEngine, PresetsManager, CodeGenerator,
 * and the Python Native API (SymPy & FFmpeg).
 */

import katex from 'katex';
import { Viewport3D } from './modules/viewport3d.js';
import { ExpressionParser } from './modules/expression_parser.js';
import { KeyframeEngine } from './modules/keyframe_engine.js';
import { PresetsManager } from './modules/presets_manager.js';
import { CodeGenerator } from './modules/code_generator.js';
import { TimelineEditor } from './modules/timeline_editor.js';

class App {
  constructor() {
    this.viewport = new Viewport3D('viewport-canvas-container');
    this.parser = new ExpressionParser();
    this.keyframes = new KeyframeEngine();
    this.presets = new PresetsManager();

    // Interactive keyframe timeline / curve editor under the 3D viewport.
    this.timelineEditor = new TimelineEditor('timeline-canvas-wrap', this.keyframes, {
      onSelect: (param, idx) => this.selectKeyframeForEdit(param, idx),
      onScrub: (t) => this.keyframes.setTime(t),
      onKeyframeChanged: (param, idx) => this.onKeyframeEdited(param, idx),
      onAddKeyframe: (param, time, value) => this.addKeyframeAt(param, time, value),
      onDeleteKeyframe: () => this.deleteSelectedKeyframe()
    });

    // Workspace layout state (persisted across sessions).
    this.layoutDefaults = { sidebar: 290, content: 520, timeline: 240, cameraPanel: false };
    this.layout = Object.assign({}, this.layoutDefaults);

    this.activeType = 'explicit'; // 'explicit' | 'parametric_curve' | 'parametric_surface' | 'vector_field'
    this.activeSetup = {
      type: 'explicit',
      expr: 'A * cos(omega * sqrt(x^2 + y^2) - t) / (1 + 0.12 * (x^2 + y^2))',
      xRange: [-5, 5],
      yRange: [-5, 5],
      uRange: [0, 6.283],
      vRange: [0, 6.283],
      meshRes: 70
    };

    this.selectedParamForEdit = 'A';
    this.selectedKeyframeIdx = 0;
    this.fourierEpicyclesActive = false;
    this.activeHarmonics = [];

    this.projectName = '未命名项目';
    this.projectPath = null;

    this.initSidebarNavigation();
    this.initStudioControls();
    this.initKeyframeControls();
    this.initCalculusControls();
    this.initPresetControls();
    this.initExportControls();
    this.initPreferencesControls();
    this.initTimelinePlayback();
    this.initTimelineToolbar();
    this.initCameraPanel();
    this.initLayoutManager();
    this.initProjectManagement();

    // Initial render
    this.updateActiveFormulaPreview();
    this.renderCurrentFrame(0, this.keyframes.evaluateAll(0));
    this.updateCodeGenerator();
    this.renderTransitionCanvas();
    this.refreshTimeline();

    // Start Keyframe Animation Clock
    let lastTime = performance.now();
    const tick = (now) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (this.keyframes.isPlaying) {
        this.keyframes.step(dt);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Subscribe to keyframe timeline updates
    this.keyframes.onUpdate((t, scope) => {
      this.onTimelineTick(t, scope);
    });
  }

  // --------------------------------------------------------------------------
  // Sidebar Navigation & Page Tabs
  // --------------------------------------------------------------------------
  initSidebarNavigation() {
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.page-section');

    navItems.forEach(item => {
      item.addEventListener('click', () => {
        navItems.forEach(i => i.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));

        item.classList.add('active');
        const targetId = `sec-${item.dataset.target}`;
        const targetSection = document.getElementById(targetId);
        if (targetSection) targetSection.classList.add('active');

        if (item.dataset.target === 'export') {
          this.updateCodeGenerator();
        }
      });
    });

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
    });
  }

  // --------------------------------------------------------------------------
  // Page Navigation, Modal, Toast & Project Management (First Page)
  // --------------------------------------------------------------------------
  showPage(page) {
    const home = document.getElementById('page-home');
    const studio = document.getElementById('page-studio');
    if (page === 'home') {
      home.classList.add('active');
      studio.classList.remove('active');
      this.refreshProjectList();
    } else {
      home.classList.remove('active');
      studio.classList.add('active');
      // The viewport had zero size while hidden; force a resize once visible.
      requestAnimationFrame(() => {
        this.viewport.onWindowResize();
        this.refreshTimeline();
      });
    }
  }

  toast(message, type = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  showModal({ title = '提示', message = '', input = false, placeholder = '', value = '', confirmText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal-overlay');
      const titleEl = document.getElementById('modal-title');
      const msgEl = document.getElementById('modal-message');
      const inputEl = document.getElementById('modal-input');
      const okBtn = document.getElementById('modal-ok-btn');
      const cancelBtn = document.getElementById('modal-cancel-btn');

      titleEl.textContent = title;
      msgEl.textContent = message;
      msgEl.style.display = message ? 'block' : 'none';
      inputEl.style.display = input ? 'block' : 'none';
      inputEl.value = value || '';
      inputEl.placeholder = placeholder || '';
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      overlay.style.display = 'flex';
      if (input) setTimeout(() => inputEl.focus(), 50);

      const cleanup = () => {
        overlay.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        inputEl.onkeydown = null;
      };
      const done = (result) => { cleanup(); resolve(result); };

      okBtn.onclick = () => done(input ? inputEl.value : true);
      cancelBtn.onclick = () => done(input ? null : false);
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(inputEl.value); }
        else if (e.key === 'Escape') { done(input ? null : false); }
      };
    });
  }

  showPrompt(title, message, value = '') {
    return this.showModal({ title, message, input: true, value });
  }

  showConfirm(title, message) {
    return this.showModal({ title, message, confirmText: '确定', cancelText: '取消' });
  }

  isNative() {
    return !!(window.pywebview && window.pywebview.api);
  }

  async nativeCall(method, args) {
    if (!this.isNative()) return null;
    try {
      const api = window.pywebview.api;
      if (typeof api[method] !== 'function') return null;
      return await api[method](...args);
    } catch (e) {
      return null;
    }
  }

  // ---- Browser (localStorage) fallback for project persistence ----
  localProjectKeys() {
    try {
      const raw = localStorage.getItem('mathstudio_project_keys');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  saveLocalProject(data) {
    try {
      const keys = this.localProjectKeys();
      if (!keys.includes(data.name)) keys.push(data.name);
      localStorage.setItem('mathstudio_project_keys', JSON.stringify(keys));
      localStorage.setItem('mathstudio_project_' + data.name, JSON.stringify(data));
    } catch (e) {}
  }
  loadLocalProject(name) {
    try { return JSON.parse(localStorage.getItem('mathstudio_project_' + name) || 'null'); }
    catch (e) { return null; }
  }
  deleteLocalProject(name) {
    try {
      const keys = this.localProjectKeys().filter(k => k !== name);
      localStorage.setItem('mathstudio_project_keys', JSON.stringify(keys));
      localStorage.removeItem('mathstudio_project_' + name);
    } catch (e) {}
  }

  escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async refreshProjectList() {
    const listEl = document.getElementById('home-project-list');
    if (!listEl) return;
    let projects = [];
    if (this.isNative()) {
      const res = await this.nativeCall('list_projects', []);
      if (res && Array.isArray(res)) projects = res;
    } else {
      projects = this.localProjectKeys().map(name => ({ name, savedAtStr: '' }));
    }

    if (!projects.length) {
      listEl.innerHTML = '<div class="home-projects-empty">暂无已保存的项目</div>';
      return;
    }
    listEl.innerHTML = '';
    projects.forEach(p => {
      const item = document.createElement('div');
      item.className = 'home-project-item';
      item.innerHTML = `
        <div class="pj-info">
          <div class="pj-name">${this.escapeHtml(p.name)}</div>
          <div class="pj-meta">${this.escapeHtml(p.savedAtStr || '')}</div>
        </div>
        <span class="pj-open">打开</span>
        <button class="pj-delete" title="删除项目">✕</button>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('pj-delete')) return;
        this.openProject(p.path || p.name);
      });
      item.querySelector('.pj-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        const okDelete = await this.showConfirm('删除项目', `确定删除项目「${p.name}」吗？此操作不可撤销。`);
        if (!okDelete) return;
        if (this.isNative()) await this.nativeCall('delete_project', [p.path]);
        else this.deleteLocalProject(p.name);
        this.refreshProjectList();
      });
      listEl.appendChild(item);
    });
  }

  initProjectManagement() {
    document.getElementById('new-project-btn').addEventListener('click', () => this.newProject());
    document.getElementById('open-project-btn').addEventListener('click', () => this.openProject());
    document.getElementById('back-home-btn').addEventListener('click', () => this.showPage('home'));
    document.getElementById('save-project-btn').addEventListener('click', () => this.saveProject(false));
    this.refreshProjectList();
  }

  async newProject() {
    const name = await this.showPrompt('新建项目', '请输入新项目的名称', '未命名项目');
    if (!name || !name.trim()) return;
    this.projectName = name.trim();
    this.projectPath = null;
    this.resetProjectState();
    this.showPage('studio');
  }

  async openProject(path) {
    let data = null;
    if (this.isNative()) {
      if (path) {
        const res = await this.nativeCall('open_project_file', [path]);
        if (res && res.success) data = res.project;
        else if (res && res.error) this.toast('打开项目失败: ' + res.error, 'error');
      } else {
        const res = await this.nativeCall('open_project_dialog', []);
        if (res && res.success) data = res.project;
        else if (res && res.cancelled) return;
        else if (res && res.error) this.toast('打开项目失败: ' + res.error, 'error');
      }
    } else {
      if (path) {
        data = this.loadLocalProject(path);
      } else {
        const keys = this.localProjectKeys();
        if (!keys.length) { this.toast('没有已保存的项目', 'error'); return; }
        const name = await this.showPrompt('打开项目', '输入要打开的项目名称', keys[0]);
        if (!name) return;
        data = this.loadLocalProject(name);
      }
      if (!data) this.toast('未找到该项目', 'error');
    }

    if (data) {
      this.applyProject(data);
      this.projectName = data.name || this.projectName;
      this.projectPath = data.path || null;
      this.showPage('studio');
    }
  }

  async saveProject(saveAs) {
    const data = this.serializeProject();
    if (this.isNative()) {
      const target = (this.projectPath && !saveAs) ? this.projectPath : null;
      const res = await this.nativeCall('save_project', [data, target]);
      if (res && res.success) { this.projectPath = res.path; this.toast('项目已保存', 'success'); }
      else if (res && res.cancelled) {}
      else if (res && res.error) this.toast('保存失败: ' + res.error, 'error');
    } else {
      this.saveLocalProject(data);
      this.toast('项目已保存', 'success');
    }
    this.refreshProjectList();
  }

  serializeProject() {
    return {
      name: this.projectName || '未命名项目',
      activeType: this.activeType,
      activeSetup: JSON.parse(JSON.stringify(this.activeSetup)),
      parameters: JSON.parse(JSON.stringify(this.keyframes.parameters)),
      duration: this.keyframes.duration,
      loop: this.keyframes.loop,
      currentTime: this.keyframes.currentTime,
      fourierEpicyclesActive: this.fourierEpicyclesActive,
      activeHarmonics: JSON.parse(JSON.stringify(this.activeHarmonics || [])),
      viewport: {
        colormap: this.viewport.options.colorMap,
        wireframe: this.viewport.options.wireframe,
        showAxes: this.viewport.options.showAxes,
        showGrid: this.viewport.options.showGrid
      }
    };
  }

  applyProject(data) {
    if (data.activeType) this.activeType = data.activeType;
    if (data.activeSetup) this.activeSetup = Object.assign({}, this.activeSetup, data.activeSetup);
    this.activeSetup.type = this.activeType;

    this.syncTypeBlocks();
    this.syncInputsFromSetup();

    if (data.parameters) this.keyframes.parameters = JSON.parse(JSON.stringify(data.parameters));
    this.keyframes.duration = (typeof data.duration === 'number') ? data.duration : 8.0;
    this.keyframes.loop = data.loop !== false;
    this.keyframes.currentTime = (typeof data.currentTime === 'number') ? data.currentTime : 0;
    this.keyframes.isPlaying = false;
    this.fourierEpicyclesActive = !!data.fourierEpicyclesActive;
    this.activeHarmonics = data.activeHarmonics || [];

    if (data.viewport) {
      const vp = data.viewport;
      this.viewport.setColorMap(vp.colormap || 'coolwarm');
      this.viewport.toggleWireframe(!!vp.wireframe);
      this.viewport.toggleAxes(vp.showAxes !== false);
      this.viewport.toggleGrid(vp.showGrid !== false);
      document.getElementById('colormap-select').value = vp.colormap || 'coolwarm';
      document.getElementById('wireframe-toggle').checked = !!vp.wireframe;
      document.getElementById('pref-axes-toggle').checked = vp.showAxes !== false;
      document.getElementById('pref-grid-toggle').checked = vp.showGrid !== false;
    }

    document.getElementById('timeline-duration-input').value = this.keyframes.duration;
    document.getElementById('timeline-scrubber-slider').max = this.keyframes.duration;
    document.getElementById('timeline-scrubber-slider').value = this.keyframes.currentTime;
    document.getElementById('time-display-label').textContent = `${this.keyframes.currentTime.toFixed(2)}s / ${this.keyframes.duration.toFixed(2)}s`;
    document.getElementById('timeline-loop-toggle').checked = this.keyframes.loop;
    document.getElementById('fourier-epicycles-toggle').checked = this.fourierEpicyclesActive;
    document.getElementById('play-pause-btn').textContent = '▶';

    this.refreshParameterUI();
    this.updateActiveFormulaPreview();
    this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    this.updateCodeGenerator();
    this.renderTransitionCanvas();
    this.refreshCalculusOverlays();
  }

  resetProjectState() {
    this.activeType = 'explicit';
    this.activeSetup = {
      type: 'explicit',
      expr: 'A * cos(omega * sqrt(x^2 + y^2) - t) / (1 + 0.12 * (x^2 + y^2))',
      xRange: [-5, 5],
      yRange: [-5, 5],
      uRange: [0, 6.283],
      vRange: [0, 6.283],
      meshRes: 70
    };
    this.keyframes.parameters = {};
    this.keyframes.currentTime = 0;
    this.keyframes.duration = 8.0;
    this.keyframes.loop = true;
    this.keyframes.isPlaying = false;
    this.fourierEpicyclesActive = false;
    this.activeHarmonics = [];

    this.keyframes.addParameter('A', 2.0, 0, 10);
    this.keyframes.addParameter('omega', 1.5, 0, 10);
    this.keyframes.addParameter('phi', 0.0, -Math.PI, Math.PI);
    this.keyframes.addParameter('R', 3.0, 0.1, 10);
    this.keyframes.addKeyframe('A', 0, 1.0);
    this.keyframes.addKeyframe('A', 4.0, 3.5, { outerFunc: 'sin(pi/2 * x)', innerFunc: 'x^2' });
    this.keyframes.addKeyframe('A', 8.0, 1.0, { outerFunc: '1 / (1 + exp(-8 * (x - 0.5)))', innerFunc: 'x' });
    this.keyframes.addKeyframe('phi', 0, 0);
    this.keyframes.addKeyframe('phi', 8.0, Math.PI * 2, { outerFunc: 'x', innerFunc: 'x' });

    this.viewport.setColorMap('coolwarm');
    this.viewport.toggleWireframe(false);
    this.viewport.toggleAxes(true);
    this.viewport.toggleGrid(true);

    this.syncTypeBlocks();
    this.syncInputsFromSetup();
    document.getElementById('colormap-select').value = 'coolwarm';
    document.getElementById('wireframe-toggle').checked = false;
    document.getElementById('pref-axes-toggle').checked = true;
    document.getElementById('pref-grid-toggle').checked = true;
    document.getElementById('fourier-epicycles-toggle').checked = false;
    document.getElementById('tangent-plane-toggle').checked = false;
    document.getElementById('gradient-field-toggle').checked = false;
    document.getElementById('timeline-duration-input').value = 8.0;
    document.getElementById('timeline-scrubber-slider').max = 8.0;
    document.getElementById('timeline-loop-toggle').checked = true;
    document.getElementById('play-pause-btn').textContent = '▶';

    this.refreshParameterUI();
    this.updateActiveFormulaPreview();
    this.renderCurrentFrame(0, this.keyframes.evaluateAll(0));
    this.updateCodeGenerator();
    this.renderTransitionCanvas();
    this.refreshCalculusOverlays();
  }

  syncTypeBlocks() {
    document.getElementById('block-explicit').style.display = this.activeType === 'explicit' ? 'block' : 'none';
    document.getElementById('block-parametric-curve').style.display = this.activeType === 'parametric_curve' ? 'block' : 'none';
    document.getElementById('block-parametric-surface').style.display = this.activeType === 'parametric_surface' ? 'block' : 'none';
    document.getElementById('block-vector-field').style.display = this.activeType === 'vector_field' ? 'block' : 'none';
    document.getElementById('func-type-select').value = this.activeType;
  }

  syncInputsFromSetup() {
    const s = this.activeSetup || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === undefined || v === null) ? '' : v; };
    set('expr-explicit-input', s.expr);
    set('curve-x-input', s.exprX);
    set('curve-y-input', s.exprY);
    set('curve-z-input', s.exprZ);
    set('surf-x-input', s.exprX);
    set('surf-y-input', s.exprY);
    set('surf-z-input', s.exprZ);
    set('vec-u-input', s.vecU);
    set('vec-v-input', s.vecV);
    set('vec-w-input', s.vecW);
    set('range-xmin', s.xRange ? s.xRange[0] : -5);
    set('range-xmax', s.xRange ? s.xRange[1] : 5);
    set('range-ymin', s.yRange ? s.yRange[0] : -5);
    set('range-ymax', s.yRange ? s.yRange[1] : 5);
    const meshEl = document.getElementById('mesh-res-slider');
    if (meshEl) meshEl.value = s.meshRes || 70;
    const meshVal = document.getElementById('mesh-res-val');
    if (meshVal) meshVal.textContent = `${s.meshRes || 70}x${s.meshRes || 70}`;
  }

  clearCalculusOverlays() {
    if (this.viewport) this.viewport.updateCalculusOverlays(() => 0, () => 0, () => 0, 0, 0, false, false);
  }

  refreshCalculusOverlays() {
    const tangentToggle = document.getElementById('tangent-plane-toggle');
    const gradToggle = document.getElementById('gradient-field-toggle');
    const tanX0 = document.getElementById('tangent-x0');
    const tanY0 = document.getElementById('tangent-y0');
    const showPlane = tangentToggle.checked;
    const showGrad = gradToggle.checked;
    const x0 = parseFloat(tanX0.value) || 0;
    const y0 = parseFloat(tanY0.value) || 0;

    if (!showPlane && !showGrad) {
      this.viewport.updateCalculusOverlays(() => 0, () => 0, () => 0, 0, 0, false, false);
      return;
    }

    const scope = this.keyframes.evaluateAll(this.keyframes.currentTime);
    const fn = this.parser.compileExplicit(this.activeSetup.expr || '0');
    const { fx, fy } = this.parser.numericalPartials(fn);
    this.viewport.updateCalculusOverlays(
      (x, y) => fn(x, y, scope),
      (x, y) => fx(x, y, scope),
      (x, y) => fy(x, y, scope),
      x0, y0, showPlane, showGrad
    );
  }

  // --------------------------------------------------------------------------
  // Studio & Expression Controls
  // --------------------------------------------------------------------------
  initStudioControls() {
    const typeSelect = document.getElementById('func-type-select');

    typeSelect.addEventListener('change', (e) => {
      this.activeType = e.target.value;
      this.activeSetup.type = this.activeType;
      this.syncTypeBlocks();
      this.updateActiveFormulaPreview();
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
      this.updateCodeGenerator();
      this.refreshCalculusOverlays();
    });

    // Domain range inputs
    const xMinInput = document.getElementById('range-xmin');
    const xMaxInput = document.getElementById('range-xmax');
    const yMinInput = document.getElementById('range-ymin');
    const yMaxInput = document.getElementById('range-ymax');

    const updateDomain = () => {
      this.activeSetup.xRange = [parseFloat(xMinInput.value) || -5, parseFloat(xMaxInput.value) || 5];
      this.activeSetup.yRange = [parseFloat(yMinInput.value) || -5, parseFloat(yMaxInput.value) || 5];
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    };

    [xMinInput, xMaxInput, yMinInput, yMaxInput].forEach(inp => inp.addEventListener('change', updateDomain));

    // Mesh Resolution Slider
    const meshSlider = document.getElementById('mesh-res-slider');
    const meshVal = document.getElementById('mesh-res-val');
    meshSlider.addEventListener('input', (e) => {
      this.activeSetup.meshRes = parseInt(e.target.value);
      meshVal.textContent = `${this.activeSetup.meshRes}x${this.activeSetup.meshRes}`;
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    });

    // Color Map
    const colormapSelect = document.getElementById('colormap-select');
    colormapSelect.addEventListener('change', (e) => {
      this.viewport.setColorMap(e.target.value);
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    });

    // Wireframe toggle
    const wireToggle = document.getElementById('wireframe-toggle');
    wireToggle.addEventListener('change', (e) => {
      this.viewport.toggleWireframe(e.target.checked);
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    });

    // Apply Button
    document.getElementById('apply-expression-btn').addEventListener('click', () => {
      this.applyExpressionsFromInputs();
    });

    // Live preview & Enter-to-apply for the math expression inputs only
    const exprInputs = document.querySelectorAll(
      '#expr-explicit-input, #curve-x-input, #curve-y-input, #curve-z-input, ' +
      '#surf-x-input, #surf-y-input, #surf-z-input, #vec-u-input, #vec-v-input, #vec-w-input'
    );
    exprInputs.forEach(input => {
      input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') this.applyExpressionsFromInputs();
        else this.updateActiveFormulaPreview();
      });
    });
  }

  applyExpressionsFromInputs() {
    if (this.activeType === 'explicit') {
      this.activeSetup.expr = document.getElementById('expr-explicit-input').value;
    } else if (this.activeType === 'parametric_curve') {
      this.activeSetup.exprX = document.getElementById('curve-x-input').value;
      this.activeSetup.exprY = document.getElementById('curve-y-input').value;
      this.activeSetup.exprZ = document.getElementById('curve-z-input').value;
    } else if (this.activeType === 'parametric_surface') {
      this.activeSetup.exprX = document.getElementById('surf-x-input').value;
      this.activeSetup.exprY = document.getElementById('surf-y-input').value;
      this.activeSetup.exprZ = document.getElementById('surf-z-input').value;
    } else if (this.activeType === 'vector_field') {
      this.activeSetup.vecU = document.getElementById('vec-u-input').value;
      this.activeSetup.vecV = document.getElementById('vec-v-input').value;
      this.activeSetup.vecW = document.getElementById('vec-w-input').value;
    }

    this.updateActiveFormulaPreview();
    this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    this.updateCodeGenerator();
    this.refreshCalculusOverlays();
  }

  updateActiveFormulaPreview() {
    let rawTex = "";
    if (this.activeType === 'explicit') {
      const expr = document.getElementById('expr-explicit-input').value || this.activeSetup.expr || '';
      rawTex = `z = f(x, y) = ${this.formatLatex(expr)}`;
    } else if (this.activeType === 'parametric_curve') {
      rawTex = `\\vec{r}(u) = \\left( ${this.formatLatex(document.getElementById('curve-x-input').value || 'x')}, \\, ${this.formatLatex(document.getElementById('curve-y-input').value || 'y')}, \\, ${this.formatLatex(document.getElementById('curve-z-input').value || 'z')} \\right)`;
    } else if (this.activeType === 'parametric_surface') {
      rawTex = `\\mathbf{r}(u,v) = \\left( ${this.formatLatex(document.getElementById('surf-x-input').value || 'x')}, \\, ${this.formatLatex(document.getElementById('surf-y-input').value || 'y')}, \\, ${this.formatLatex(document.getElementById('surf-z-input').value || 'z')} \\right)`;
    } else {
      rawTex = `\\vec{F}(x,y,z) = (${this.formatLatex(document.getElementById('vec-u-input').value || 'u')}, ${this.formatLatex(document.getElementById('vec-v-input').value || 'v')}, ${this.formatLatex(document.getElementById('vec-w-input').value || 'w')})`;
    }

    const previewEl = document.getElementById('katex-studio-preview');
    const hudEl = document.getElementById('hud-formula-render');
    try {
      katex.render(rawTex, previewEl, { throwOnError: false, displayMode: true });
      katex.render(rawTex, hudEl, { throwOnError: false, displayMode: false });
    } catch (e) {
      previewEl.textContent = rawTex;
      hudEl.textContent = rawTex;
    }
  }

  formatLatex(expr) {
    if (!expr) return "";
    return expr
      .replace(/\*/g, ' \\cdot ')
      .replace(/sqrt\((.*?)\)/g, '\\sqrt{$1}')
      .replace(/pi/g, '\\pi')
      .replace(/omega/g, '\\omega')
      .replace(/phi/g, '\\phi');
  }

  // --------------------------------------------------------------------------
  // Keyframes & Nested Composite Transitions
  // --------------------------------------------------------------------------
  initKeyframeControls() {
    this.refreshParameterUI();

    // Duration input
    const durationInput = document.getElementById('timeline-duration-input');
    durationInput.addEventListener('change', (e) => {
      const d = parseFloat(e.target.value) || 8.0;
      this.keyframes.duration = d;
      document.getElementById('timeline-scrubber-slider').max = d;
      this.refreshTimeline();
    });

    // Add parameter button
    document.getElementById('add-param-btn').addEventListener('click', async () => {
      const name = await this.showPrompt('新建自定义参数', '请输入新参数名称 (例如 k, alpha, B)', 'k');
      if (name && name.trim()) {
        const cleanName = name.trim();
        this.keyframes.addParameter(cleanName, 1.0, -10, 10);
        this.keyframes.addKeyframe(cleanName, 0, 1.0);
        this.keyframes.addKeyframe(cleanName, this.keyframes.duration, 3.0);
        this.refreshParameterUI();
      }
    });

    // Transition Presets
    const transSelect = document.getElementById('transition-preset-select');
    const outerInp = document.getElementById('outer-func-input');
    const innerInp = document.getElementById('inner-func-input');

    transSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'linear') {
        outerInp.value = 'x';
        innerInp.value = 'x';
      } else if (val === 'smooth') {
        outerInp.value = 'sin(pi/2 * x)';
        innerInp.value = 'x^2';
      } else if (val === 'harmonic') {
        outerInp.value = 'sin(4*pi*x)*exp(-3*x) + x';
        innerInp.value = 'x';
      } else if (val === 'bounce') {
        outerInp.value = 'abs(sin(3*pi*x))*(1-x) + x';
        innerInp.value = 'x';
      } else if (val === 'sigmoid') {
        outerInp.value = '1 / (1 + exp(-10*(x - 0.5)))';
        innerInp.value = 'x';
      }
      this.renderTransitionCanvas();
    });

    [outerInp, innerInp].forEach(inp => {
      inp.addEventListener('input', () => this.renderTransitionCanvas());
    });

    // Apply Transition Button
    document.getElementById('apply-transition-btn').addEventListener('click', () => {
      const outerFunc = outerInp.value;
      const innerFunc = innerInp.value;
      const param = this.keyframes.parameters[this.selectedParamForEdit];
      if (param && param.keyframes[this.selectedKeyframeIdx]) {
        param.keyframes[this.selectedKeyframeIdx].transition = { outerFunc, innerFunc, type: 'composite' };
        this.toast(`已应用复合过渡函数到参数 [${this.selectedParamForEdit}] 第 ${this.selectedKeyframeIdx + 1} 关键帧`, 'success');
        this.refreshParameterUI();
      }
    });
  }

  refreshParameterUI() {
    const container = document.getElementById('param-list-container');
    container.innerHTML = '';

    for (const name in this.keyframes.parameters) {
      const param = this.keyframes.parameters[name];
      const card = document.createElement('div');
      card.className = 'param-item';

      let kfBadgesHtml = '';
      param.keyframes.forEach((kf, idx) => {
        kfBadgesHtml += `
          <div class="keyframe-node" data-param="${name}" data-idx="${idx}" title="点击配置帧间复合过渡">
            <span>t=${kf.time.toFixed(1)}s: <b>${kf.value.toFixed(2)}</b></span>
            <span class="nested-func-badge">g(f(τ))</span>
          </div>
        `;
      });

      card.innerHTML = `
        <div class="param-header">
          <div class="param-tag">
            <span>参数:</span> <b>${name}</b>
            <span style="font-size: 11px; color: var(--win-text-secondary); margin-left: 8px;">(实时值: <span id="val-${name}">${param.currentVal.toFixed(2)}</span>)</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="win11-btn sm add-kf-btn" data-param="${name}">+ 加关键帧</button>
            <button class="win11-btn sm del-param-btn" data-param="${name}" style="color: #ff4d4d;">✕</button>
          </div>
        </div>
        <div class="keyframe-track">
          ${kfBadgesHtml || '<span style="font-size: 11px; color: var(--win-text-tertiary);">暂无关键帧 (保持常数值)</span>'}
        </div>
      `;

      container.appendChild(card);
    }

    // Attach event listeners to keyframe nodes
    container.querySelectorAll('.keyframe-node').forEach(node => {
      node.addEventListener('click', (e) => {
        this.selectedParamForEdit = node.dataset.param;
        this.selectedKeyframeIdx = parseInt(node.dataset.idx);
        const kf = this.keyframes.parameters[this.selectedParamForEdit].keyframes[this.selectedKeyframeIdx];
        if (kf && kf.transition) {
          document.getElementById('outer-func-input').value = kf.transition.outerFunc || 'x';
          document.getElementById('inner-func-input').value = kf.transition.innerFunc || 'x';
          this.renderTransitionCanvas();
        }
        if (this.timelineEditor) this.timelineEditor.setSelection(this.selectedParamForEdit, this.selectedKeyframeIdx);
      });
    });

    // Add keyframe button
    container.querySelectorAll('.add-kf-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const paramName = btn.dataset.param;
        const curT = this.keyframes.currentTime;
        const valStr = await this.showPrompt('添加关键帧', `在时间 t = ${curT.toFixed(2)}s 为参数 [${paramName}] 设定目标值`, '3.0');
        if (valStr !== null && !isNaN(parseFloat(valStr))) {
          this.keyframes.addKeyframe(paramName, curT, parseFloat(valStr));
          this.refreshParameterUI();
        }
      });
    });

    // Delete parameter button
    container.querySelectorAll('.del-param-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const paramName = btn.dataset.param;
        const okDel = await this.showConfirm('删除参数', `确定删除参数 [${paramName}] 及其所有关键帧吗？`);
        if (okDel) {
          this.keyframes.removeParameter(paramName);
          this.refreshParameterUI();
        }
      });
    });

    this.refreshTimeline();
  }

  renderTransitionCanvas() {
    const canvas = document.getElementById('transition-curve-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.9); ctx.lineTo(w, h * 0.9);
    ctx.moveTo(0, h * 0.1); ctx.lineTo(w, h * 0.1);
    ctx.stroke();

    const outerExpr = document.getElementById('outer-func-input').value || 'x';
    const innerExpr = document.getElementById('inner-func-input').value || 'x';

    const transition = { outerFunc: outerExpr, innerFunc: innerExpr };

    ctx.strokeStyle = '#0078d4';
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    for (let px = 0; px <= w; px++) {
      const tau = px / w;
      let val = this.keyframes.evaluateTransition(tau, transition);
      // Map val [0, 1] to canvas y [h*0.9, h*0.1]
      const py = (h * 0.9) - val * (h * 0.8);
      if (px === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    document.getElementById('trans-curve-formula-badge').textContent = `h(τ) = ${outerExpr} ∘ (${innerExpr})`;
  }

  // --------------------------------------------------------------------------
  // Timeline Editor Helpers (keyframe curve editing under the 3D viewport)
  // --------------------------------------------------------------------------
  refreshTimeline() {
    if (this.timelineEditor) this.timelineEditor.refresh();
  }

  selectKeyframeForEdit(param, idx) {
    this.selectedParamForEdit = param;
    this.selectedKeyframeIdx = idx;
    const p = this.keyframes.parameters[param];
    if (p && p.keyframes[idx] && p.keyframes[idx].transition) {
      document.getElementById('outer-func-input').value = p.keyframes[idx].transition.outerFunc || 'x';
      document.getElementById('inner-func-input').value = p.keyframes[idx].transition.innerFunc || 'x';
      this.renderTransitionCanvas();
    }
    if (this.timelineEditor) this.timelineEditor.setSelection(param, idx);
  }

  onKeyframeEdited(param, idx) {
    // A keyframe was dragged in the timeline: refresh the parameter list and re-render.
    this.refreshParameterUI();
    this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
  }

  addKeyframeAt(param, time, value) {
    if (!this.keyframes.parameters[param]) return;
    this.keyframes.addKeyframe(param, time, value);
    this.selectedParamForEdit = param;
    this.refreshParameterUI();
    this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
  }

  deleteSelectedKeyframe() {
    const param = this.selectedParamForEdit;
    const idx = this.selectedKeyframeIdx;
    const p = this.keyframes.parameters[param];
    if (param && p && p.keyframes[idx] !== undefined) {
      this.keyframes.removeKeyframe(param, idx);
      this.selectedKeyframeIdx = -1;
      if (this.timelineEditor) this.timelineEditor.setSelection(param, -1);
      this.refreshParameterUI();
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    } else {
      this.toast('请先在时间轴中选中一个关键帧', 'error');
    }
  }

  // --------------------------------------------------------------------------
  // Calculus & Advanced Operations (SymPy Backend Connection)
  // --------------------------------------------------------------------------
  initCalculusControls() {
    const partialsBtn = document.getElementById('calc-partials-btn');
    const resultCard = document.getElementById('card-partials-result');
    const katexOut = document.getElementById('partials-katex-out');

    partialsBtn.addEventListener('click', async () => {
      const expr = this.activeSetup.expr || document.getElementById('expr-explicit-input').value;
      katexOut.innerHTML = '<span style="color: var(--win-accent);">正在调用 SymPy 符号计算引擎...</span>';
      resultCard.style.display = 'block';

      if (window.pywebview && window.pywebview.api) {
        try {
          const res = await window.pywebview.api.compute_partials(expr);
          if (res.success) {
            const outTex = `
              \\begin{aligned}
              \\frac{\\partial z}{\\partial x} &= ${res.dz_dx_latex} \\\\[6pt]
              \\frac{\\partial z}{\\partial y} &= ${res.dz_dy_latex} \\\\[6pt]
              \\nabla f &= \\left( ${res.dz_dx_latex}, \\, ${res.dz_dy_latex} \\right)
              \\end{aligned}
            `;
            katex.render(outTex, katexOut, { throwOnError: false, displayMode: true });
          } else {
            katexOut.textContent = "计算错误: " + res.error;
          }
        } catch (e) {
          katexOut.textContent = "API 调用失败: " + e;
        }
      } else {
        // Fallback local display
        const outTex = `\\frac{\\partial z}{\\partial x} = \\text{Local Calc Mode}`;
        katex.render(outTex, katexOut, { throwOnError: false });
      }
    });

    // Tangent Plane Toggle & Coordinates
    const tangentToggle = document.getElementById('tangent-plane-toggle');
    const gradToggle = document.getElementById('gradient-field-toggle');
    const tanX0 = document.getElementById('tangent-x0');
    const tanY0 = document.getElementById('tangent-y0');

    [tangentToggle, gradToggle, tanX0, tanY0].forEach(el =>
      el.addEventListener('change', () => this.refreshCalculusOverlays())
    );

    // Integral Button
    const integralBtn = document.getElementById('calc-integral-btn');
    const integralCard = document.getElementById('card-integral-result');
    const integralOut = document.getElementById('integral-katex-out');

    integralBtn.addEventListener('click', async () => {
      const expr = this.activeSetup.expr || document.getElementById('expr-explicit-input').value;
      integralOut.innerHTML = '<span style="color: var(--win-accent);">SymPy 定积分计算中...</span>';
      integralCard.style.display = 'block';

      if (window.pywebview && window.pywebview.api) {
        try {
          const res = await window.pywebview.api.compute_integral(expr, 'x', 0, 3.14159);
          if (res.success) {
            katex.render(res.latex, integralOut, { throwOnError: false, displayMode: true });
          } else {
            integralOut.textContent = "积分计算: " + (res.error || "无法求出解析解，可采用数值黎曼和");
          }
        } catch (e) {
          integralOut.textContent = "执行异常: " + e;
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Presets & Multi-Preset Mixing
  // --------------------------------------------------------------------------
  initPresetControls() {
    const selector = document.getElementById('preset-selector');
    const mixA = document.getElementById('mix-preset-a');
    const mixB = document.getElementById('mix-preset-b');

    this.presets.getAllPresets().forEach(p => {
      const opt = `<option value="${p.id}">${p.category}: ${p.name}</option>`;
      selector.insertAdjacentHTML('beforeend', opt);
      mixA.insertAdjacentHTML('beforeend', opt);
      mixB.insertAdjacentHTML('beforeend', opt);
    });

    // Sync detail card to the initially selected preset
    const initialPreset = this.presets.getPresetById(selector.value);
    if (initialPreset) {
      document.getElementById('preset-detail-title').textContent = initialPreset.name;
      document.getElementById('preset-detail-desc').textContent = initialPreset.description;
    }

    // Preset Detail Update
    selector.addEventListener('change', (e) => {
      const p = this.presets.getPresetById(e.target.value);
      if (p) {
        document.getElementById('preset-detail-title').textContent = p.name;
        document.getElementById('preset-detail-desc').textContent = p.description;
      }
    });

    // Load Preset Button
    document.getElementById('load-preset-btn').addEventListener('click', () => {
      const p = this.presets.getPresetById(selector.value);
      if (p) {
        this.loadPresetIntoStudio(p);
      }
    });

    // Mix Blend Slider
    const blendSlider = document.getElementById('blend-alpha-slider');
    const blendVal = document.getElementById('blend-alpha-val');
    blendSlider.addEventListener('input', (e) => {
      const a = parseFloat(e.target.value);
      blendVal.textContent = a.toFixed(2);
      if (this.keyframes.parameters['alpha']) {
        this.keyframes.parameters['alpha'].currentVal = a;
        this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
      }
    });

    // Apply Mix Button
    document.getElementById('apply-mix-btn').addEventListener('click', () => {
      const pA = this.presets.getPresetById(mixA.value);
      const pB = this.presets.getPresetById(mixB.value);
      const mode = document.getElementById('mix-mode-select').value;

      if (!pA || !pB) return;
      const mixed = this.presets.mixPresets(pA, pB, mode, 'alpha');
      if (mixed) {
        // Automatically create dynamic keyframe animation for alpha: 0 -> 1 -> 0
        this.keyframes.addParameter('alpha', 0.5, 0, 1);
        this.keyframes.addKeyframe('alpha', 0, 0.0);
        this.keyframes.addKeyframe('alpha', this.keyframes.duration / 2, 1.0, {
          outerFunc: 'sin(pi/2 * x)',
          innerFunc: 'x^2'
        });
        this.keyframes.addKeyframe('alpha', this.keyframes.duration, 0.0, {
          outerFunc: 'sin(pi/2 * x)',
          innerFunc: 'x^2'
        });

        this.loadPresetIntoStudio(mixed);
        this.refreshParameterUI();
        this.toast(`已创建融合模型 [${mixed.name}]，混合系数 α 已绑定平滑关键帧动画`, 'success');
      } else {
        this.toast('所选预设类型不兼容，请选择相同维度的预设（显式曲面之间或参数曲面之间）进行融合。', 'error');
      }
    });

    // Fourier Epicycles Toggle
    const fourierToggle = document.getElementById('fourier-epicycles-toggle');
    fourierToggle.addEventListener('change', (e) => {
      this.fourierEpicyclesActive = e.target.checked;
      if (!this.fourierEpicyclesActive) {
        this.viewport.renderFourierEpicycles([], 0);
      }
    });
  }

  loadPresetIntoStudio(preset) {
    this.activeType = preset.type;
    this.activeSetup.type = preset.type;
    this.syncTypeBlocks();

    if (preset.type === 'explicit') {
      this.activeSetup.expr = preset.expr;
      document.getElementById('expr-explicit-input').value = preset.expr;
      if (preset.xRange) {
        this.activeSetup.xRange = preset.xRange;
        document.getElementById('range-xmin').value = preset.xRange[0];
        document.getElementById('range-xmax').value = preset.xRange[1];
      }
      if (preset.yRange) {
        this.activeSetup.yRange = preset.yRange;
        document.getElementById('range-ymin').value = preset.yRange[0];
        document.getElementById('range-ymax').value = preset.yRange[1];
      }
    } else if (preset.type === 'parametric_curve') {
      this.activeSetup.exprX = preset.exprX;
      this.activeSetup.exprY = preset.exprY;
      this.activeSetup.exprZ = preset.exprZ;
      document.getElementById('curve-x-input').value = preset.exprX;
      document.getElementById('curve-y-input').value = preset.exprY;
      document.getElementById('curve-z-input').value = preset.exprZ;
      if (preset.uRange) this.activeSetup.uRange = preset.uRange;
    } else if (preset.type === 'parametric_surface') {
      this.activeSetup.exprX = preset.exprX;
      this.activeSetup.exprY = preset.exprY;
      this.activeSetup.exprZ = preset.exprZ;
      document.getElementById('surf-x-input').value = preset.exprX;
      document.getElementById('surf-y-input').value = preset.exprY;
      document.getElementById('surf-z-input').value = preset.exprZ;
      if (preset.uRange) this.activeSetup.uRange = preset.uRange;
      if (preset.vRange) this.activeSetup.vRange = preset.vRange;
    } else if (preset.type === 'vector_field') {
      this.activeSetup.vecU = preset.vecU;
      this.activeSetup.vecV = preset.vecV;
      this.activeSetup.vecW = preset.vecW;
      document.getElementById('vec-u-input').value = preset.vecU;
      document.getElementById('vec-v-input').value = preset.vecV;
      document.getElementById('vec-w-input').value = preset.vecW;
    }

    if (preset.harmonics) {
      this.activeHarmonics = preset.harmonics;
      document.getElementById('fourier-epicycles-toggle').checked = true;
      this.fourierEpicyclesActive = true;
    }

    // Set default params
    if (preset.defaultParams) {
      for (const k in preset.defaultParams) {
        if (!this.keyframes.parameters[k]) {
          this.keyframes.addParameter(k, preset.defaultParams[k]);
        }
      }
      this.refreshParameterUI();
    }

    this.updateActiveFormulaPreview();
    this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    this.updateCodeGenerator();
    this.refreshCalculusOverlays();
  }

  // --------------------------------------------------------------------------
  // Code Generation & MP4 Export
  // --------------------------------------------------------------------------
  initExportControls() {
    let currentCodeLang = 'threejs';

    // Tabs
    const codeTabs = document.querySelectorAll('.code-tab-btn');
    codeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        codeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCodeLang = tab.dataset.lang;
        document.getElementById('code-lang-label').textContent = currentCodeLang === 'threejs' ? 'HTML / JavaScript' : 'Python';
        this.updateCodeGenerator(currentCodeLang);
      });
    });

    // Copy Code
    document.getElementById('copy-code-btn').addEventListener('click', async () => {
      const codeText = document.getElementById('generated-code-box').textContent;
      try {
        await navigator.clipboard.writeText(codeText);
        this.toast('源码已复制到剪贴板', 'success');
      } catch (e) {
        this.toast('复制失败，请手动选择代码复制', 'error');
      }
    });

    // Save Code File
    document.getElementById('save-code-btn').addEventListener('click', () => {
      const codeText = document.getElementById('generated-code-box').textContent;
      const ext = currentCodeLang === 'threejs' ? 'html' : 'py';
      const blob = new Blob([codeText], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `math_animation.${ext}`;
      a.click();
    });

    // Start MP4 Export (Frame-by-Frame HD Render via Python & FFmpeg)
    const exportBtn = document.getElementById('start-mp4-export-btn');
    const progressCard = document.getElementById('export-progress-card');
    const progressBar = document.getElementById('export-progress-bar');
    const percentText = document.getElementById('export-percent-text');
    const statusText = document.getElementById('export-status-text');
    const finishActions = document.getElementById('export-finish-actions');
    let exportedFilePath = "";

    exportBtn.addEventListener('click', async () => {
      if (!window.pywebview || !window.pywebview.api) {
        this.toast('请在打包的 Windows 工具环境下运行以调用本地 FFmpeg 视频编码器。', 'error');
        return;
      }

      // 1. Choose Save Destination via Native Dialog
      const savePath = await window.pywebview.api.select_save_path("math_animation_1080p.mp4");
      if (!savePath) return;

      exportedFilePath = savePath;
      exportBtn.disabled = true;
      progressCard.style.display = 'flex';
      finishActions.style.display = 'none';

      const resOption = document.getElementById('export-res-select').value.split('x');
      const width = parseInt(resOption[0]);
      const height = parseInt(resOption[1]);
      const fps = parseInt(document.getElementById('export-fps-select').value);
      const totalFrames = Math.floor(this.keyframes.duration * fps);

      statusText.textContent = `初始化 FFmpeg 视频编码器 (${width}x${height} @ ${fps}fps)...`;
      progressBar.style.width = '0%';
      percentText.textContent = '0%';

      // 2. Start Video Render Stream
      const startRes = await window.pywebview.api.start_video_render(savePath, width, height, fps, 18);
      if (!startRes.success) {
        this.toast('启动 FFmpeg 失败，请检查系统环境！', 'error');
        exportBtn.disabled = false;
        return;
      }

      // Temporarily resize viewport renderer to target resolution for pristine frame capture
      const origWidth = this.viewport.container.clientWidth;
      const origHeight = this.viewport.container.clientHeight;
      this.viewport.renderer.setSize(width, height, false);
      this.viewport.camera.aspect = width / height;
      this.viewport.camera.updateProjectionMatrix();

      // 3. Render Frame by Frame
      for (let f = 0; f < totalFrames; f++) {
        const t = (f / fps);
        const scope = this.keyframes.evaluateAll(t);

        // Render current 3D frame
        this.renderCurrentFrame(t, scope);
        this.viewport.renderer.render(this.viewport.scene, this.viewport.camera);

        // Capture lossless PNG base64
        const frameData = this.viewport.renderer.domElement.toDataURL('image/png');
        await window.pywebview.api.push_video_frame(frameData);

        // Update progress
        const pct = Math.round(((f + 1) / totalFrames) * 100);
        progressBar.style.width = `${pct}%`;
        percentText.textContent = `${pct}%`;
        statusText.textContent = `正在逐帧渲染并编码: ${f + 1} / ${totalFrames} 帧`;
      }

      // 4. Finish Rendering
      statusText.textContent = "正在封闭封装 MP4 文件容器...";
      const finishRes = await window.pywebview.api.finish_video_render();

      // Restore renderer size
      this.viewport.renderer.setSize(origWidth, origHeight, false);
      this.viewport.camera.aspect = origWidth / origHeight;
      this.viewport.camera.updateProjectionMatrix();
      exportBtn.disabled = false;

      if (finishRes.success) {
        statusText.textContent = `✓ 导出完成！文件大小: ${finishRes.file_size_mb} MB`;
        finishActions.style.display = 'flex';
      } else {
        statusText.textContent = `导出出错: ${finishRes.error}`;
      }
    });

    document.getElementById('open-video-folder-btn').addEventListener('click', async () => {
      if (exportedFilePath && window.pywebview && window.pywebview.api) {
        await window.pywebview.api.open_containing_folder(exportedFilePath);
      }
    });
  }

  updateCodeGenerator(lang = 'threejs') {
    const codeBox = document.getElementById('generated-code-box');
    if (!codeBox) return;

    if (lang === 'threejs') {
      codeBox.textContent = CodeGenerator.generateThreeJsHtml(this.activeSetup);
    } else {
      codeBox.textContent = CodeGenerator.generatePythonMatplotlib(this.activeSetup);
    }
  }

  // --------------------------------------------------------------------------
  // Preferences & Viewport Controls
  // --------------------------------------------------------------------------
  initPreferencesControls() {
    document.getElementById('pref-axes-toggle').addEventListener('change', (e) => {
      this.viewport.toggleAxes(e.target.checked);
    });

    document.getElementById('pref-grid-toggle').addEventListener('change', (e) => {
      this.viewport.toggleGrid(e.target.checked);
    });

    // Viewport HUD buttons
    document.getElementById('view-iso-btn').addEventListener('click', () => {
      this.viewport.resetCamera('iso');
      this.setActiveHudBtn('view-iso-btn');
    });
    document.getElementById('view-top-btn').addEventListener('click', () => {
      this.viewport.resetCamera('top');
      this.setActiveHudBtn('view-top-btn');
    });
    document.getElementById('view-front-btn').addEventListener('click', () => {
      this.viewport.resetCamera('front');
      this.setActiveHudBtn('view-front-btn');
    });
    document.getElementById('hud-wireframe-btn').addEventListener('click', () => {
      const curr = this.viewport.options.wireframe;
      this.viewport.toggleWireframe(!curr);
      document.getElementById('wireframe-toggle').checked = !curr;
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    });
  }

  setActiveHudBtn(btnId) {
    ['view-iso-btn', 'view-top-btn', 'view-front-btn'].forEach(id => {
      document.getElementById(id).classList.remove('active');
    });
    document.getElementById(btnId).classList.add('active');
  }

  // --------------------------------------------------------------------------
  // Camera Control System
  // --------------------------------------------------------------------------
  initCameraPanel() {
    const panel = document.getElementById('camera-panel');
    const toggleBtn = document.getElementById('camera-panel-toggle-btn');
    const closeBtn = document.getElementById('camera-panel-close-btn');

    toggleBtn.addEventListener('click', () => {
      const hidden = panel.style.display === 'none';
      panel.style.display = hidden ? 'block' : 'none';
      if (hidden) this.syncCameraPanel();
    });
    closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });

    ['cam-pos-x', 'cam-pos-y', 'cam-pos-z', 'cam-target-x', 'cam-target-y', 'cam-target-z'].forEach((id) => {
      document.getElementById(id).addEventListener('change', () => this.applyCameraFromPanel());
    });

    const fov = document.getElementById('cam-fov');
    fov.addEventListener('input', () => {
      document.getElementById('cam-fov-val').textContent = Math.round(parseFloat(fov.value)) + '°';
      this.viewport.setFov(parseFloat(fov.value));
    });

    document.getElementById('cam-projection').addEventListener('change', (e) => {
      this.viewport.setProjection(e.target.value);
      this.syncCameraPanel();
    });

    document.querySelectorAll('.cam-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewport.resetCamera(btn.dataset.view);
        this.syncCameraPanel();
      });
    });

    document.getElementById('cam-frame-all-btn').addEventListener('click', () => {
      this.viewport.frameAll();
      this.syncCameraPanel();
    });

    document.getElementById('cam-autorotate').addEventListener('change', (e) => {
      this.viewport.setAutoRotate(e.target.checked);
    });

    // Keep the panel in sync while the user orbits / zooms / pans the camera.
    if (this.viewport && this.viewport.controls) {
      let pending = false;
      this.viewport.controls.addEventListener('change', () => {
        if (panel.style.display === 'none' || pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; this.syncCameraPanel(); });
      });
    }
  }

  syncCameraPanel() {
    const s = this.viewport.getCameraState();
    const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.value = (+v).toFixed(2); };
    setNum('cam-pos-x', s.position.x);
    setNum('cam-pos-y', s.position.y);
    setNum('cam-pos-z', s.position.z);
    setNum('cam-target-x', s.target.x);
    setNum('cam-target-y', s.target.y);
    setNum('cam-target-z', s.target.z);
    const fov = document.getElementById('cam-fov');
    fov.value = s.fov;
    document.getElementById('cam-fov-val').textContent = Math.round(s.fov) + '°';
    document.getElementById('cam-projection').value = s.projection;
    document.getElementById('cam-autorotate').checked = s.autoRotate;
  }

  applyCameraFromPanel() {
    const num = (id) => parseFloat(document.getElementById(id).value) || 0;
    this.viewport.setCameraPosition(num('cam-pos-x'), num('cam-pos-y'), num('cam-pos-z'));
    this.viewport.setCameraTarget(num('cam-target-x'), num('cam-target-y'), num('cam-target-z'));
  }

  // --------------------------------------------------------------------------
  // Workspace Layout (resizable panes + persistence)
  // --------------------------------------------------------------------------
  initLayoutManager() {
    this.initSplitters();
    document.getElementById('save-layout-btn').addEventListener('click', () => this.saveLayout(true));
    document.getElementById('reset-layout-btn').addEventListener('click', () => this.resetLayout());
    this.restoreLayout().then(() => this.applyLayout());
  }

  initSplitters() {
    this.makeResizable('sidebar-splitter', 'sidebar', 'x', 200, 460, (v) => { this.layout.sidebar = v; });
    this.makeResizable('content-splitter', 'settings-scroll-pane', 'x', 360, 780, (v) => { this.layout.content = v; });
    this.makeResizable('timeline-splitter', 'timeline-panel', 'y', 140, 520, (v) => { this.layout.timeline = v; });
  }

  makeResizable(splitterId, paneId, axis, min, max, onSet) {
    const splitter = document.getElementById(splitterId);
    const pane = document.getElementById(paneId);
    if (!splitter || !pane) return;
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.classList.add('dragging');
      splitter.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = axis === 'x' ? pane.getBoundingClientRect().width : pane.getBoundingClientRect().height;

      const onMove = (ev) => {
        let size;
        if (axis === 'x') {
          size = startSize + (ev.clientX - startX);
        } else {
          size = startSize - (ev.clientY - startY);
        }
        size = Math.max(min, Math.min(max, size));
        if (axis === 'x') pane.style.width = size + 'px';
        else pane.style.height = size + 'px';
        onSet(size);
      };

      const onUp = () => {
        splitter.classList.remove('dragging');
        splitter.removeEventListener('pointermove', onMove);
        splitter.removeEventListener('pointerup', onUp);
        splitter.removeEventListener('pointercancel', onUp);
      };

      splitter.addEventListener('pointermove', onMove);
      splitter.addEventListener('pointerup', onUp);
      splitter.addEventListener('pointercancel', onUp);
    });
  }

  async restoreLayout() {
    let data = null;
    if (this.isNative()) {
      data = await this.nativeCall('load_layout', []);
    }
    if (!data || typeof data !== 'object') {
      try { data = JSON.parse(localStorage.getItem('mathstudio_layout_v1') || 'null'); } catch (e) { data = null; }
    }
    if (data && typeof data === 'object') {
      this.layout = Object.assign({}, this.layoutDefaults, data);
    }
  }

  async saveLayout(showToast = false) {
    const layout = Object.assign({}, this.layout);
    layout.cameraPanel = document.getElementById('camera-panel').style.display !== 'none';
    if (this.isNative()) {
      await this.nativeCall('save_layout', [layout]);
    }
    try { localStorage.setItem('mathstudio_layout_v1', JSON.stringify(layout)); } catch (e) {}
    if (showToast) this.toast('工作区布局已保存', 'success');
  }

  applyLayout() {
    const sidebar = document.getElementById('sidebar');
    const content = document.getElementById('settings-scroll-pane');
    const timeline = document.getElementById('timeline-panel');
    if (sidebar) sidebar.style.width = this.layout.sidebar + 'px';
    if (content) content.style.width = this.layout.content + 'px';
    if (timeline) timeline.style.height = this.layout.timeline + 'px';
    const panel = document.getElementById('camera-panel');
    if (panel) panel.style.display = this.layout.cameraPanel ? 'block' : 'none';
  }

  resetLayout() {
    this.layout = Object.assign({}, this.layoutDefaults);
    this.applyLayout();
    this.saveLayout(false).then(() => this.toast('已重置为默认布局', 'success'));
  }

  // --------------------------------------------------------------------------
  // Timeline Playback & Realtime Scrubbing
  // --------------------------------------------------------------------------
  initTimelinePlayback() {
    const playBtn = document.getElementById('play-pause-btn');
    const scrubber = document.getElementById('timeline-scrubber-slider');

    playBtn.addEventListener('click', () => {
      this.keyframes.togglePlay();
      playBtn.textContent = this.keyframes.isPlaying ? '⏸' : '▶';
    });

    document.getElementById('time-step-back-btn').addEventListener('click', () => {
      this.keyframes.setTime(this.keyframes.currentTime - 0.2);
    });

    document.getElementById('time-step-fwd-btn').addEventListener('click', () => {
      this.keyframes.setTime(this.keyframes.currentTime + 0.2);
    });

    scrubber.addEventListener('input', (e) => {
      this.keyframes.setTime(parseFloat(e.target.value));
    });

    document.getElementById('playback-speed-select').addEventListener('change', (e) => {
      this.keyframes.playbackSpeed = parseFloat(e.target.value);
    });

    // Loop toggle (previously unbound — now actually controls looping).
    document.getElementById('timeline-loop-toggle').addEventListener('change', (e) => {
      this.keyframes.loop = e.target.checked;
    });
  }

  initTimelineToolbar() {
    document.getElementById('tl-add-keyframe-btn').addEventListener('click', () => {
      const param = this.selectedParamForEdit;
      if (!param || !this.keyframes.parameters[param]) {
        this.toast('请先在时间轴中选中一个参数轨道', 'error');
        return;
      }
      const t = this.keyframes.currentTime;
      const v = this.keyframes.evaluateParameter(param, t);
      this.addKeyframeAt(param, t, v);
    });

    document.getElementById('tl-delete-keyframe-btn').addEventListener('click', () => {
      this.deleteSelectedKeyframe();
    });
  }

  onTimelineTick(t, scope) {
    document.getElementById('time-display-label').textContent = `${t.toFixed(2)}s / ${this.keyframes.duration.toFixed(2)}s`;
    document.getElementById('timeline-scrubber-slider').value = t;

    // Update real-time parameter badges
    for (const name in scope) {
      const el = document.getElementById(`val-${name}`);
      if (el) el.textContent = scope[name].toFixed(2);
    }

    if (this.timelineEditor) this.timelineEditor.setPlayhead(t);
    this.renderCurrentFrame(t, scope);
  }

  // --------------------------------------------------------------------------
  // 3D Frame Render Evaluation
  // --------------------------------------------------------------------------
  renderCurrentFrame(t, scope) {
    if (this.activeType === 'explicit') {
      const fn = this.parser.compileExplicit(this.activeSetup.expr);
      this.viewport.plotExplicitSurface(
        (x, y) => fn(x, y, scope),
        this.activeSetup.xRange,
        this.activeSetup.yRange,
        this.activeSetup.meshRes,
        this.activeSetup.meshRes
      );
    } else if (this.activeType === 'parametric_curve') {
      const fn = this.parser.compileParametricCurve(this.activeSetup.exprX, this.activeSetup.exprY, this.activeSetup.exprZ);
      this.viewport.plotParametricCurve((u) => fn(u, scope), this.activeSetup.uRange, 400);
    } else if (this.activeType === 'parametric_surface') {
      const fn = this.parser.compileParametricSurface(this.activeSetup.exprX, this.activeSetup.exprY, this.activeSetup.exprZ);
      this.viewport.plotParametricSurface((u, v) => fn(u, v, scope), this.activeSetup.uRange, this.activeSetup.vRange, 50, 50);
    } else if (this.activeType === 'vector_field') {
      const fn = this.parser.compileVectorField(this.activeSetup.vecU, this.activeSetup.vecV, this.activeSetup.vecW);
      this.viewport.plotVectorField((x, y, z) => fn(x, y, z, scope), 4, 1.8);
    }

    // Render Fourier Epicycles if active
    if (this.fourierEpicyclesActive && this.activeHarmonics.length > 0) {
      this.viewport.renderFourierEpicycles(this.activeHarmonics, t);
    }
  }
}

// Bootstrap on DOM ready. Defer by two animation frames so the browser can paint
// the shell (home page) first — the WebGL viewport, surface build and code
// generation then run without blocking the initial paint, avoiding a frozen
// startup window.
window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.app = new App();
      } catch (err) {
        console.error('Failed to initialize application:', err);
      }
    });
  });
});
