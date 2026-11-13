/**
 * Main Application Orchestrator for "数学函数表达式工具" (Windows 11 Fluent Edition).
 * Connects Viewport3D, ExpressionParser, KeyframeEngine, PresetsManager, CodeGenerator,
 * and the Python Native API (SymPy & FFmpeg).
 */

import katex from 'katex';
import { Viewport3D } from './modules/viewport3d.js';
import { propertyMetrics } from './modules/property_shading.js';
import { ExpressionParser } from './modules/expression_parser.js';
import { KeyframeEngine } from './modules/keyframe_engine.js';
import { PresetsManager } from './modules/presets_manager.js';
import { CodeGenerator } from './modules/code_generator.js';
import { PanelManager } from './modules/panel_manager.js';
import { TimelineEditor } from './modules/timeline_editor.js';
import { MathNodes } from './modules/math_nodes.js';
import { MeshWorkspace } from './modules/mesh_workspace.js';
import { OrthographicViews } from './modules/orthographic_views.js';
import { InterfaceLanguage, getLocale, translate } from './modules/i18n.js';

const legendNumberFormats = {
  'zh-CN': new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 5 }),
  en: new Intl.NumberFormat('en', { maximumSignificantDigits: 5 })
};

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
    this.layoutDefaults = { version: 2, leftWidth: null, attributeWidth: null, bottomHeight: null, layerWidthPercent: null, cameraPanel: false };
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

    this._compiledFn = null;
    this._compiledType = null;

    // Connect 3D surface click picking to calculus tangent plane
    this.viewport.onSurfacePicked = (mx, my, mz) => {
      for (const [axis, value] of [['x', mx], ['y', my], ['z', mz]]) {
        document.getElementById(`picked-${axis}`).textContent = value.toFixed(2);
      }
      const tanX0 = document.getElementById('tangent-x0');
      const tanY0 = document.getElementById('tangent-y0');
      if (tanX0 && tanY0) {
        tanX0.value = mx.toFixed(2);
        tanY0.value = my.toFixed(2);
        this.refreshCalculusOverlays();
        this.toast(`已拾取切点: (${mx.toFixed(2)}, ${my.toFixed(2)}, ${mz.toFixed(2)})`, 'info');
      }
    };

    this.projectName = null;
    this.projectPath = null;

    this.initWorkspaceNavigation();
    this.initStudioControls();
    this.initKeyframeControls();
    this.initCalculusControls();
    this.initPresetControls();
    this.initExportControls();
    this.initPreferencesControls();
    this.initTimelinePlayback();
    this.initTimelineToolbar();
    this.initCameraPanel();
    const renderFrame = () => {
      const time = this.keyframes.currentTime;
      this.renderCurrentFrame(time, this.keyframes.evaluateAll(time));
    };
    this.mathNodes = new MathNodes(() => {
      renderFrame();
      this.updateCodeGenerator(document.querySelector('.code-tab-btn.active')?.dataset.lang);
    });
    this.meshWorkspace = new MeshWorkspace(this.viewport, renderFrame);
    this.orthographicViews = new OrthographicViews(document.getElementById('workspace-algebra'), this.viewport);
    this.initWorkspaceControls();
    this.initViewportDisplayControls();
    this.initLayoutManager();
    this.initProjectManagement();
    this.initTopMenubar();
    this.initGlobalShortcuts();
    this.initRichModals();

    // Blender-style collapsible panel management (per-panel type dropdown).
    this.panels = new PanelManager();
    this.initLanguageSettings();

    this.hasInitializedStudio = false;

    // The keyframe curve control panel (composite g(f(τ)) editor + curve preview)
    // must render immediately and reliably — draw it synchronously so it never
    // disappears, then let the heavier 3D warm-up continue in the background.
    try {
      this.renderTransitionCanvas();
    } catch (e) {
      console.warn('Initial transition curve render failed:', e);
    }

    // Listen for pywebview ready if not already available
    window.addEventListener('pywebviewready', () => {
      this.refreshProjectList();
    });

    // Deferred initialization: allow UI to paint and become responsive immediately
    setTimeout(() => {
      this.ensureStudioReady();
    }, 180);

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

  initLanguageSettings() {
    const select = document.getElementById('language-select');
    this.interfaceLanguage = new InterfaceLanguage(document.body);
    let remembered;
    try { remembered = localStorage.getItem('mathstudio_interface_language'); } catch {}
    this.setInterfaceLanguage(remembered);

    let userChanged = false;
    let saveRequest = Promise.resolve();
    const saveNativeLanguage = language => {
      saveRequest = saveRequest.then(async () => {
        if (!await this.nativeCall('save_language', [language])) this.toast('语言设置保存失败', 'error');
      });
    };
    const loadNativeLanguage = async () => {
      if (userChanged) {
        saveNativeLanguage(select.value);
        return;
      }
      const preference = await this.nativeCall('load_language', []);
      if (!userChanged && preference) this.setInterfaceLanguage(preference);
    };
    if (this.isNative()) loadNativeLanguage();
    else window.addEventListener('pywebviewready', loadNativeLanguage, { once: true });

    select.addEventListener('change', () => {
      userChanged = true;
      const selected = select.value;
      this.setInterfaceLanguage(selected);
      if (this.isNative()) saveNativeLanguage(selected);
    });
  }

  setInterfaceLanguage(language) {
    this.interfaceLanguage.setLocale(language);
    const locale = getLocale();
    document.getElementById('language-select').value = locale;
    try { localStorage.setItem('mathstudio_interface_language', locale); } catch {}
    this.syncPresetLanguage();
    this.mathNodes.render();
    this.legendKey = null;
    this.updateShadingLegend();
    this.geometryKey = null;
    this.updateGeometryInfo();
    const codeTab = document.querySelector('.code-tab-btn.active');
    this.updateCodeGenerator(codeTab?.dataset.lang || 'threejs');
  }

  // --------------------------------------------------------------------------
  // Workspace Navigation & Page Tabs
  // --------------------------------------------------------------------------
  initWorkspaceNavigation() {
    const navItems = document.querySelectorAll('.workspace-nav .nav-item');
    const sections = document.querySelectorAll('.page-section');
    const program = document.getElementById('settings-scroll-pane');
    const back = document.getElementById('program-back');

    navItems.forEach(item => {
      item.setAttribute('aria-pressed', String(item.classList.contains('active')));
      item.addEventListener('click', () => {
        document.body.classList.remove('focus-3d');
        if (!document.getElementById('page-studio').classList.contains('active')) this.showPage('studio');
        navItems.forEach(button => {
          button.classList.toggle('active', button === item);
          button.setAttribute('aria-pressed', String(button === item));
        });
        sections.forEach(section => section.classList.toggle('active', section.id === `sec-${item.dataset.target}`));
        back.hidden = item.dataset.target === 'studio';
        program.scrollTop = 0;
        if (item.dataset.target === 'export') this.updateCodeGenerator();
      });
    });

    const entries = [...program.querySelectorAll('[data-program]')];
    entries.forEach(button => {
      button.addEventListener('click', () => {
        this.switchToTab(button.dataset.program);
        back.focus();
      });
    });
    back.addEventListener('click', () => {
      const activeTool = [...navItems].find(item => item.classList.contains('active'));
      this.switchToTab('studio');
      const entry = entries.find(button => button.dataset.program === activeTool?.dataset.target);
      (entry || entries[0]).focus();
    });
    document.getElementById('workspace-home-btn').addEventListener('click', () => this.showPage('home'));

    const search = document.getElementById('nav-search-input');
    const presets = this.presets.getAllPresets();
    document.getElementById('function-search').addEventListener('submit', event => {
      event.preventDefault();
      const query = search.value.trim().toLocaleLowerCase();
      if (!query) return;
      const match = presets.find(preset => translate(preset.name).toLocaleLowerCase() === query)
        || presets.find(preset => [preset.name, preset.category, translate(preset.name), translate(preset.category), preset.id]
          .some(value => value.toLocaleLowerCase().includes(query)));
      if (!match) {
        this.toast('未找到匹配的函数预设', 'info');
        return;
      }
      this.switchToTab('presets');
      const selector = document.getElementById('preset-selector');
      selector.value = match.id;
      selector.dispatchEvent(new Event('change'));
      search.blur();
    });
  }

  // --------------------------------------------------------------------------
  // Page Navigation, Modal, Toast & Project Management (First Page)
  // --------------------------------------------------------------------------
  ensureStudioReady() {
    if (this.hasInitializedStudio) return;
    this.hasInitializedStudio = true;

    // Render the keyframe curve panel first (independent of the heavier 3D
    // pipeline) so it can never be skipped if a later step throws.
    try {
      this.renderTransitionCanvas();
    } catch (e) {
      console.warn("Transition curve warm-up notice:", e);
    }

    try {
      this.updateActiveFormulaPreview();
    } catch (e) {
      console.warn("Formula preview warm-up notice:", e);
    }

    try {
      this.renderCurrentFrame(0, this.keyframes.evaluateAll(0));
    } catch (e) {
      console.warn("Studio warm-up notice:", e);
    }

    try {
      this.updateCodeGenerator();
    } catch (e) {
      console.warn("Code generator warm-up notice:", e);
    }
  }

  showPage(page) {
    const home = document.getElementById('page-home');
    const studio = document.getElementById('page-studio');
    if (page === 'home') {
      this.mathNodes.closeMenu();
      home.classList.add('active');
      studio.classList.remove('active');
      this.refreshProjectList();
    } else {
      home.classList.remove('active');
      studio.classList.add('active');
      this.ensureStudioReady();
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
          <div class="pj-name" data-i18n-keep>${this.escapeHtml(p.name)}</div>
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
    document.getElementById('new-project-btn')?.addEventListener('click', () => this.newProject());
    document.getElementById('open-project-btn')?.addEventListener('click', () => this.openProject());
    this.refreshProjectList();
  }

  updateProjectPill() {
    const el = document.getElementById('menubar-project-name');
    if (el) {
      el.toggleAttribute('data-i18n-keep', Boolean(this.projectName));
      el.textContent = this.projectName || '未命名项目';
    }
  }

  async newProject() {
    const name = await this.showPrompt('新建项目', '请输入新项目的名称', translate('未命名项目'));
    if (!name || !name.trim()) return;
    this.projectName = name.trim();
    this.projectPath = null;
    this.resetProjectState();
    this.updateProjectPill();
    this.showPage('studio');
    this.toast(`已新建项目: ${this.projectName}`, 'success');
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
      this.updateProjectPill();
      this.showPage('studio');
      this.toast(`已加载项目: ${this.projectName}`, 'success');
    }
  }

  async saveProject(saveAs) {
    const data = this.serializeProject();
    if (this.isNative()) {
      const target = (this.projectPath && !saveAs) ? this.projectPath : null;
      const res = await this.nativeCall('save_project', [data, target]);
      if (res && res.success) {
        this.projectPath = res.path;
        if (res.path) {
          const base = res.path.split(/[\\/]/).pop().replace('.mathstudio.json', '');
          if (base) this.projectName = base;
        }
        this.updateProjectPill();
        this.toast('项目已保存至: ' + (this.projectPath || ''), 'success');
      }
      else if (res && res.cancelled) {}
      else if (res && res.error) this.toast('保存失败: ' + res.error, 'error');
    } else {
      this.saveLocalProject(data);
      this.toast('项目已保存', 'success');
    }
    this.refreshProjectList();
  }

  // --------------------------------------------------------------------------
  // Top Navigation Menu Bar (Math-Studio File Edit View Windows)
  // --------------------------------------------------------------------------
  initTopMenubar() {
    const menubar = document.getElementById('app-top-menubar');
    if (!menubar) return;

    const menuItems = menubar.querySelectorAll('.menu-item');
    let anyMenuOpen = false;

    // Toggle menu dropdown on click
    menuItems.forEach(item => {
      const label = item.querySelector('.menu-label');
      if (!label) return;

      label.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = item.classList.contains('open');
        menuItems.forEach(i => i.classList.remove('open'));
        if (!isOpen) {
          item.classList.add('open');
          anyMenuOpen = true;
        } else {
          anyMenuOpen = false;
        }
      });

      // Hover over other menus when one is already active
      item.addEventListener('mouseenter', () => {
        if (anyMenuOpen) {
          menuItems.forEach(i => i.classList.remove('open'));
          item.classList.add('open');
        }
      });
    });

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-dropdown') && !e.target.closest('.menu-label')) {
        menuItems.forEach(i => i.classList.remove('open'));
        anyMenuOpen = false;
      }
    });

    // Handle menu option actions
    menubar.querySelectorAll('.menu-option[data-action]').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        menuItems.forEach(i => i.classList.remove('open'));
        anyMenuOpen = false;
        const action = opt.dataset.action;
        this.handleMenuAction(action);
      });
    });

    // Window controls
    document.getElementById('win-btn-minimize')?.addEventListener('click', () => {
      this.nativeCall('minimize_window', []);
    });
    document.getElementById('win-btn-fullscreen')?.addEventListener('click', async () => {
      await this.toggleFullScreenMode();
    });
    document.getElementById('win-btn-maximize')?.addEventListener('click', () => {
      this.nativeCall('maximize_window', []);
    });
    document.getElementById('win-btn-close')?.addEventListener('click', async () => {
      const ok = await this.showConfirm('退出程序', '确定要退出 Math Studio 吗？未保存的更改可能会丢失。');
      if (ok) {
        if (this.isNative()) await this.nativeCall('close_window', []);
        else window.close();
      }
    });

    // Save button on menubar
    document.getElementById('menubar-save-btn')?.addEventListener('click', () => {
      this.saveProject(false);
    });

    // Theme button on menubar
    document.getElementById('menubar-theme-btn')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      this.setTheme(next);
      this.toast(`已切换至${next === 'dark' ? '深色' : '浅色'}模式`, 'success');
    });

    // Project pill rename
    document.getElementById('menubar-project-pill')?.addEventListener('click', async () => {
      const newName = await this.showPrompt('重命名项目', '请输入项目的新名称：', this.projectName || translate('未命名项目'));
      if (newName && newName.trim()) {
        this.projectName = newName.trim();
        this.updateProjectPill();
        this.toast('项目已重命名为: ' + this.projectName, 'success');
      }
    });

    this.updateProjectPill();
  }

  async handleMenuAction(action) {
    switch (action) {
      // --- Math-Studio Menu ---
      case 'mathstudio-about':
        this.openRichModal('dialog-about');
        break;
      case 'mathstudio-help':
        this.openRichModal('dialog-help');
        break;
      case 'mathstudio-report':
        await this.prepareReportData();
        this.openRichModal('dialog-report');
        break;
      case 'mathstudio-version':
        this.openRichModal('dialog-version');
        break;

      // --- File Menu ---
      case 'file-new':
        this.newProject();
        break;
      case 'file-open':
        this.openProject();
        break;
      case 'file-save':
        this.saveProject(false);
        break;
      case 'file-save-as':
        this.saveProject(true);
        break;
      case 'import-expression':
        this.openImportDialog('expression');
        break;
      case 'import-keyframes':
        this.openImportDialog('keyframes');
        break;
      case 'export-mp4':
        this.showPage('studio');
        this.switchToTab('export');
        this.toast('已导航至视频导出面板，点击下方按钮开始导出', 'success');
        break;
      case 'export-threejs':
        this.downloadFile('math_studio_standalone.html', CodeGenerator.generateThreeJsHtml(this.activeSetup), 'text/html');
        this.toast('独立 HTML5+Three.js 交互单文件已导出！', 'success');
        break;
      case 'export-python':
        this.downloadFile('math_studio_animation.py', CodeGenerator.generatePythonMatplotlib(this.activeSetup), 'text/x-python');
        this.toast('Python (Matplotlib 3D) 动画脚本已导出！', 'success');
        break;
      case 'export-png':
        this.exportPngSnapshot();
        break;

      // --- Edit Menu ---
      case 'edit-preferences':
        this.showPage('studio');
        this.switchToTab('preferences');
        break;
      case 'mode-explicit':
        this.switchFunctionMode('explicit');
        break;
      case 'mode-curve':
        this.switchFunctionMode('parametric_curve');
        break;
      case 'mode-surface':
        this.switchFunctionMode('parametric_surface');
        break;
      case 'mode-vector':
        this.switchFunctionMode('vector_field');
        break;
      case 'op-partials':
        this.showPage('studio');
        this.switchToTab('calculus');
        document.getElementById('calc-partials-btn')?.click();
        break;
      case 'op-integral':
        this.showPage('studio');
        this.switchToTab('calculus');
        document.getElementById('calc-integral-btn')?.click();
        break;
      case 'op-tangent-plane':
        const tanToggle = document.getElementById('tangent-plane-toggle');
        if (tanToggle) {
          tanToggle.checked = !tanToggle.checked;
          tanToggle.dispatchEvent(new Event('change'));
          this.toast(tanToggle.checked ? '切平面探索已开启' : '切平面已关闭', 'success');
        }
        break;
      case 'op-gradient-field':
        const gradToggle = document.getElementById('gradient-field-toggle');
        if (gradToggle) {
          gradToggle.checked = !gradToggle.checked;
          gradToggle.dispatchEvent(new Event('change'));
          this.toast(gradToggle.checked ? '梯度矢量场已开启' : '梯度矢量场已关闭', 'success');
        }
        break;
      case 'more-reset-params':
        for (const k in this.keyframes.parameters) {
          const p = this.keyframes.parameters[k];
          p.currentVal = p.defaultVal;
        }
        this.refreshParameterUI();
        this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
        this.toast('所有参数已重置为初始默认值', 'success');
        break;
      case 'more-clear-keyframes':
        const okClear = await this.showConfirm('清空时间轴', '确定清空所有参数的关键帧吗？');
        if (okClear) {
          for (const k in this.keyframes.parameters) {
            this.keyframes.parameters[k].keyframes = [];
          }
          this.refreshParameterUI();
          this.toast('关键帧已全部清空', 'success');
        }
        break;
      case 'more-random-math':
        this.applyRandomMathPreset();
        break;
      case 'more-copy-formula':
        const formula = this.activeType === 'explicit' 
          ? (this.activeSetup.expr || '') 
          : `${this.activeSetup.exprX || ''}, ${this.activeSetup.exprY || ''}, ${this.activeSetup.exprZ || ''}`;
        navigator.clipboard.writeText(formula);
        this.toast('公式已复制到剪贴板: ' + formula, 'success');
        break;

      // --- View Menu ---
      case 'layout-split':
        document.body.classList.remove('focus-3d');
        this.showPage('studio');
        requestAnimationFrame(() => this.viewport.onWindowResize());
        this.toast('已恢复工作台布局', 'success');
        break;
      case 'layout-fullscreen-3d':
        this.showPage('studio');
        document.querySelector('[data-view-tab="view"]').click();
        document.body.classList.toggle('focus-3d');
        requestAnimationFrame(() => this.viewport.onWindowResize());
        const isFocus = document.body.classList.contains('focus-3d');
        this.toast(isFocus ? '已开启纯净 3D 沉浸模式 (可从 View 菜单还原)' : '已恢复工作台面板', 'success');
        break;
      case 'layout-home':
        this.showPage('home');
        break;
      case 'layout-studio':
        this.showPage('studio');
        break;
      case 'theme-dark':
        this.setTheme('dark');
        this.toast('已切换为深色模式', 'success');
        break;
      case 'theme-light':
        this.setTheme('light');
        this.toast('已切换为浅色模式', 'success');
        break;
      case 'theme-black':
        this.setTheme('dark', 0x000000);
        this.toast('已切换为赛博纯黑高对比模式', 'success');
        break;
      case 'zoom-iso':
        this.viewport.resetCamera('iso');
        break;
      case 'zoom-top':
        this.viewport.resetCamera('top');
        break;
      case 'zoom-front':
        this.viewport.resetCamera('front');
        break;
      case 'zoom-in':
        this.zoomCamera(0.2);
        break;
      case 'zoom-out':
        this.zoomCamera(-0.25);
        break;
      case 'zoom-reset':
        this.viewport.resetCamera('iso');
        document.getElementById('viewport-zoom').value = 100;
        document.getElementById('viewport-zoom').dispatchEvent(new Event('input'));
        break;
      case 'view-overlays':
        this.openViewportSettings('overlay-menu');
        break;
      case 'view-shading':
        this.openViewportSettings('shading-menu');
        break;

      // --- Windows Menu ---
      case 'win-fullscreen':
        await this.toggleFullScreenMode();
        break;
      case 'win-maximize':
        if (this.isNative()) await this.nativeCall('maximize_window', []);
        break;
      case 'win-restore':
        if (this.isNative()) await this.nativeCall('restore_window', []);
        break;
      case 'win-minimize':
        if (this.isNative()) await this.nativeCall('minimize_window', []);
        break;
      case 'win-reset-size':
        if (this.isNative()) {
          await this.nativeCall('reset_window_size', [1380, 880]);
          this.toast('已恢复为标准窗口尺寸 1380×880', 'success');
        }
        break;
      case 'win-dev-tools':
        const hud = document.getElementById('hud-stats-badge');
        if (hud) {
          const isHidden = hud.style.display === 'none';
          hud.style.display = isHidden ? 'block' : 'none';
          this.toast(isHidden ? '性能与 FPS 面板已显示' : '性能与 FPS 面板已隐藏', 'success');
        }
        break;
      case 'win-exit':
        const confirmExit = await this.showConfirm('退出程序', '确定要退出 Math Studio 吗？未保存的更改可能会丢失。');
        if (confirmExit) {
          if (this.isNative()) await this.nativeCall('close_window', []);
          else window.close();
        }
        break;
    }
  }

  switchToTab(tabName) {
    const item = document.querySelector(`.workspace-nav .nav-item[data-target="${tabName}"]`);
    if (item) item.click();
  }

  switchFunctionMode(mode) {
    this.showPage('studio');
    const sel = document.getElementById('func-type-select');
    if (sel) {
      sel.value = mode;
      sel.dispatchEvent(new Event('change'));
      this.toast(`已切换至: ${sel.options[sel.selectedIndex].text}`, 'success');
    }
  }

  zoomCamera(factor) {
    if (!this.viewport || !this.viewport.camera || !this.viewport.controls) return;
    const cam = this.viewport.camera;
    if (cam.isOrthographicCamera) {
      this.viewport.setZoom(cam.zoom / (1 - factor));
      this.syncViewportZoom();
      return;
    }
    const target = this.viewport.controls.target;
    if (factor > 0) {
      cam.position.lerp(target, factor);
    } else {
      const dir = cam.position.clone().sub(target).multiplyScalar(1 - factor);
      cam.position.copy(target).add(dir);
    }
    this.viewport.controls.update();
  }

  exportPngSnapshot() {
    try {
      this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
      this.viewport.renderer.render(this.viewport.scene, this.viewport.camera);
      const url = this.viewport.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.projectName || 'Math_Studio'}_snapshot.png`;
      a.click();
      this.toast('3D 超清渲染截图已导出下载！', 'success');
    } catch (e) {
      this.toast('截图导出失败: ' + e, 'error');
    }
  }

  downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  async toggleFullScreenMode() {
    if (this.isNative()) {
      const isFull = await this.nativeCall('toggle_fullscreen', []);
      this.toast(isFull ? '已进入全屏模式 (按 F11 退出)' : '已退出全屏模式', 'success');
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
        this.toast('已进入全屏模式 (按 F11 退出)', 'success');
      } else {
        document.exitFullscreen?.();
        this.toast('已退出全屏模式', 'success');
      }
    }
    requestAnimationFrame(() => this.viewport.onWindowResize());
  }

  applyRandomMathPreset() {
    const list = [
      {
        name: '涟漪干涉曲面',
        type: 'explicit',
        expr: 'A * cos(omega * sqrt(x^2 + y^2) - t) / (1 + 0.12 * (x^2 + y^2))',
        params: { A: 2.8, omega: 2.2 }
      },
      {
        name: '猴鞍面 (Monkey Saddle)',
        type: 'explicit',
        expr: '0.15 * (x^3 - 3*x*y^2) * cos(0.6*t)',
        params: {}
      },
      {
        name: '双曲环波 (Hyperbolic Wave)',
        type: 'explicit',
        expr: 'A * sin(x*cos(t) + y*sin(t)) * cos(0.3 * (x^2 - y^2))',
        params: { A: 2.0 }
      },
      {
        name: '3D 环面 (Torus)',
        type: 'parametric_surface',
        exprX: '(R + 1.2*cos(v))*cos(u)',
        exprY: '(R + 1.2*cos(v))*sin(u)',
        exprZ: '1.2*sin(v)',
        params: { R: 3.2 }
      },
      {
        name: '3D 李萨如扭结 (Lissajous Knot)',
        type: 'parametric_curve',
        exprX: 'A * sin(3*u + phi)',
        exprY: 'A * sin(4*u)',
        exprZ: 'A * cos(5*u)',
        params: { A: 3.5, phi: 0 }
      }
    ];

    const pick = list[Math.floor(Math.random() * list.length)];
    this.showPage('studio');
    this.loadPresetIntoStudio({
      id: 'random_' + Date.now(),
      name: pick.name,
      category: '随机探索',
      type: pick.type,
      expr: pick.expr,
      exprX: pick.exprX,
      exprY: pick.exprY,
      exprZ: pick.exprZ,
      defaultParams: pick.params
    });
    this.toast(`已生成随机探索函数:「${pick.name}」`, 'success');
  }

  async prepareReportData() {
    const pre = document.getElementById('report-diag-pre');
    if (!pre) return;
    pre.textContent = '正在检测系统环境与 GPU 状态...';

    let sysInfo = null;
    if (this.isNative()) {
      sysInfo = await this.nativeCall('get_system_info', []);
    }

    let glInfo = 'WebGL2 Active';
    try {
      const gl = this.viewport.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        glInfo = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      }
    } catch (e) {}

    const reportObj = {
      app: 'Math Studio v2.1.0 Enterprise',
      time: new Date().toISOString(),
      screen: `${window.screen.width}x${window.screen.height} (ratio: ${window.devicePixelRatio})`,
      gpu: glInfo,
      system: sysInfo || {
        os: navigator.userAgent,
        python: '3.13.14',
        sympy: '1.14.0',
        ffmpeg: '8.1.2-essentials_build'
      }
    };

    pre.textContent = JSON.stringify(reportObj, null, 2);
  }

  // --------------------------------------------------------------------------
  // Global Keyboard Shortcuts
  // --------------------------------------------------------------------------
  initGlobalShortcuts() {
    window.addEventListener('keydown', async (e) => {
      // Don't intercept if user is typing in input or textarea
      const tag = (e.target.tagName || '').toLowerCase();
      const isInput = ['input', 'textarea', 'select', 'button'].includes(tag);

      // F11: Toggle Fullscreen
      if (e.key === 'F11') {
        e.preventDefault();
        await this.toggleFullScreenMode();
        return;
      }

      // F1: Help Dialog
      if (e.key === 'F1') {
        e.preventDefault();
        this.openRichModal('dialog-help');
        return;
      }

      // Ctrl + S: Save
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveProject(false);
        return;
      }

      // Ctrl + Shift + S: Save As
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveProject(true);
        return;
      }

      // Ctrl + O: Open
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.openProject();
        return;
      }

      // Ctrl + N: New
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.newProject();
        return;
      }

      // Ctrl + , : Preferences
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        this.showPage('studio');
        this.switchToTab('preferences');
        return;
      }

      // Escape: Close open modals
      if (e.key === 'Escape') {
        document.querySelectorAll('.rich-modal-overlay').forEach(m => m.style.display = 'none');
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
        return;
      }

      // Space: Play/Pause animation when not in text input
      if (e.key === ' ' && !isInput) {
        e.preventDefault();
        document.getElementById('play-pause-btn')?.click();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Rich Modals (About, Help, Report, Version, Import)
  // --------------------------------------------------------------------------
  initRichModals() {
    // Close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        this.closeRichModal(modalId);
      });
    });

    // Close on overlay backdrop click
    document.querySelectorAll('.rich-modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
      });
    });

    // Help dialog tab switching
    document.querySelectorAll('.help-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.help-tab-btn').forEach(b => b.classList.remove('primary', 'active'));
        document.querySelectorAll('.help-tab-content').forEach(c => c.style.display = 'none');
        btn.classList.add('primary', 'active');
        const target = document.getElementById(btn.dataset.tab);
        if (target) target.style.display = 'block';
      });
    });

    // Copy Diagnostics button
    document.getElementById('copy-diag-btn')?.addEventListener('click', () => {
      const text = document.getElementById('report-diag-pre')?.textContent || '';
      navigator.clipboard.writeText(text);
      this.toast('系统诊断信息已复制到剪贴板！', 'success');
    });

    // Submit Report button
    document.getElementById('submit-report-btn')?.addEventListener('click', () => {
      const desc = document.getElementById('report-desc-input')?.value;
      if (!desc || !desc.trim()) {
        this.toast('请填写详细情况描述', 'error');
        return;
      }
      this.closeRichModal('dialog-report');
      this.toast('感谢您的反馈！诊断数据与问题报告已成功保存。', 'success');
      document.getElementById('report-desc-input').value = '';
    });

    // Check updates button
    document.getElementById('check-update-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('check-update-btn');
      btn.textContent = '正在检测最新版本...';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = '🔄 检查更新';
        btn.disabled = false;
        this.toast('当前版本：Math Studio 2.1.0', 'success');
      }, 600);
    });

    // Confirm Import button
    document.getElementById('confirm-import-btn')?.addEventListener('click', () => {
      const raw = document.getElementById('import-json-input')?.value;
      if (!raw || !raw.trim()) {
        this.toast('请输入合法的 JSON 配置', 'error');
        return;
      }
      try {
        const obj = JSON.parse(raw);
        if (obj.expr || obj.activeSetup) {
          if (obj.activeSetup) this.applyProject(obj);
          else {
            if (obj.type) this.activeType = obj.type;
            if (obj.expr) this.activeSetup.expr = obj.expr;
            if (obj.params) {
              for (const k in obj.params) {
                if (!this.keyframes.parameters[k]) this.keyframes.addParameter(k, obj.params[k]);
                else this.keyframes.parameters[k].currentVal = obj.params[k];
              }
            }
          }
          this.syncTypeBlocks();
          this.refreshParameterUI();
          this.updateActiveFormulaPreview();
          this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
          this.closeRichModal('dialog-import');
          this.toast('成功导入数学配置！', 'success');
        } else {
          this.toast('JSON 格式未包含有效的数学表达式字段', 'error');
        }
      } catch (err) {
        this.toast('JSON 解析失败: ' + err.message, 'error');
      }
    });
  }

  openRichModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
  }

  closeRichModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
  }

  openImportDialog(type = 'expression') {
    const inp = document.getElementById('import-json-input');
    if (inp) {
      if (type === 'expression') {
        inp.placeholder = '{\n  "type": "explicit",\n  "expr": "A * cos(omega * sqrt(x^2 + y^2) - t) / (1 + 0.1 * (x^2+y^2))",\n  "params": { "A": 3.0, "omega": 1.5 }\n}';
      } else {
        inp.placeholder = '{\n  "parameters": {\n    "A": { "defaultVal": 2.5, "keyframes": [{ "time": 0, "value": 1.0 }, { "time": 4, "value": 3.5 }] }\n  }\n}';
      }
      inp.value = '';
    }
    this.openRichModal('dialog-import');
  }

  serializeProject() {
    const { guides, shading } = this.viewport;
    return {
      name: this.projectName || translate('未命名项目'),
      activeType: this.activeType,
      activeSetup: JSON.parse(JSON.stringify(this.activeSetup)),
      parameters: JSON.parse(JSON.stringify(this.keyframes.parameters)),
      duration: this.keyframes.duration,
      loop: this.keyframes.loop,
      currentTime: this.keyframes.currentTime,
      fourierEpicyclesActive: this.fourierEpicyclesActive,
      activeHarmonics: JSON.parse(JSON.stringify(this.activeHarmonics || [])),
      mathNodes: this.mathNodes.serialize(),
      meshSnapshot: this.meshWorkspace.serialize(),
      viewport: {
        colormap: shading.palette,
        wireframe: guides.settings.wireMode === 'only',
        showAxes: guides.settings.axes.some(Boolean),
        showGrid: guides.settings.floor,
        guides: structuredClone(guides.settings),
        shading: {
          metric: this.shadingMetric,
          range: shading.manualRange ? [...shading.manualRange] : null,
          showLegend: this.showColorLegend
        }
      }
    };
  }

  applyProject(data) {
    this.mathNodes.load(data.mathNodes);
    this.meshWorkspace.load(data.meshSnapshot);
    this.invalidateCompiledFunction();
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

    this.restoreViewportDisplay(data.viewport);
    this.setLayerVisibility(true);

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
    this.mathNodes.load();
    this.meshWorkspace.load();
    this.invalidateCompiledFunction();
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

    this.restoreViewportDisplay();
    this.geometryKey = null;
    this.setLayerVisibility(true);

    this.syncTypeBlocks();
    this.syncInputsFromSetup();
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
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? el.defaultValue; };
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
    const riemannToggle = document.getElementById('riemann-sum-toggle');
    const tanX0 = document.getElementById('tangent-x0');
    const tanY0 = document.getElementById('tangent-y0');
    const showPlane = tangentToggle ? tangentToggle.checked : false;
    const showGrad = gradToggle ? gradToggle.checked : false;
    const showRiemann = riemannToggle ? riemannToggle.checked : false;
    const x0 = parseFloat(tanX0 ? tanX0.value : 0) || 0;
    const y0 = parseFloat(tanY0 ? tanY0.value : 0) || 0;

    const scope = this.keyframes.evaluateAll(this.keyframes.currentTime);
    const fn = this.parser.compileExplicit(this.activeSetup.expr || '0');

    if (showRiemann) {
      this.viewport.renderRiemannSum(
        (x, y) => fn(x, y, scope),
        this.activeSetup.xRange || [-3, 3],
        this.activeSetup.yRange || [-3, 3],
        8, 8
      );
    } else if (!showPlane && !showGrad) {
      this.viewport.updateCalculusOverlays(() => 0, () => 0, () => 0, 0, 0, false, false);
      return;
    }

    if (showPlane || showGrad) {
      const { fx, fy } = this.parser.numericalPartials(fn);
      this.viewport.updateCalculusOverlays(
        (x, y) => fn(x, y, scope),
        (x, y) => fx(x, y, scope),
        (x, y) => fy(x, y, scope),
        x0, y0, showPlane, showGrad
      );
    }
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
      this.applyExpressionsFromInputs();
    });

    // Domain range inputs
    const xMinInput = document.getElementById('range-xmin');
    const xMaxInput = document.getElementById('range-xmax');
    const yMinInput = document.getElementById('range-ymin');
    const yMaxInput = document.getElementById('range-ymax');

    const updateDomain = () => {
      const [xMin, xMax, yMin, yMax] = [xMinInput, xMaxInput, yMinInput, yMaxInput].map(input => input.valueAsNumber);
      if (![xMin, xMax, yMin, yMax].every(Number.isFinite) || xMin >= xMax || yMin >= yMax) {
        this.toast('定义域的最小值必须小于最大值', 'error');
        return;
      }
      this.activeSetup.xRange = [xMin, xMax];
      this.activeSetup.yRange = [yMin, yMax];
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
    this.invalidateCompiledFunction();
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
            <span>参数:</span> <b data-i18n-keep>${this.escapeHtml(name)}</b>
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
    this.selectKeyframeForEdit(param, idx);
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
            const h = res.hessian || {};
            const outTex = `
              \\begin{aligned}
              \\frac{\\partial z}{\\partial x} &= ${res.dz_dx_latex} \\\\[4pt]
              \\frac{\\partial z}{\\partial y} &= ${res.dz_dy_latex} \\\\[4pt]
              \\nabla f &= \\left( ${res.dz_dx_latex}, \\, ${res.dz_dy_latex} \\right) \\\\[6pt]
              H &= \\begin{pmatrix} f_{xx} & f_{xy} \\\\ f_{yx} & f_{yy} \\end{pmatrix} = \\begin{pmatrix} ${h.f_xx_latex || 'f_{xx}'} & ${h.f_xy_latex || 'f_{xy}'} \\\\ ${h.f_xy_latex || 'f_{xy}'} & ${h.f_yy_latex || 'f_{yy}'} \\end{pmatrix}
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
        katex.render(`\\nabla f = \\left( \\frac{\\partial z}{\\partial x}, \\frac{\\partial z}{\\partial y} \\right)`, katexOut, { throwOnError: false });
      }
    });

    // Tangent Plane Toggle & Coordinates
    const tangentToggle = document.getElementById('tangent-plane-toggle');
    const gradToggle = document.getElementById('gradient-field-toggle');
    const riemannToggle = document.getElementById('riemann-sum-toggle');
    const tanX0 = document.getElementById('tangent-x0');
    const tanY0 = document.getElementById('tangent-y0');

    [tangentToggle, gradToggle, riemannToggle, tanX0, tanY0].filter(Boolean).forEach(el =>
      el.addEventListener('change', () => this.refreshCalculusOverlays())
    );

    // Taylor Series Button
    const taylorBtn = document.getElementById('calc-taylor-btn');
    const taylorCard = document.getElementById('card-taylor-result');
    const taylorOut = document.getElementById('taylor-katex-out');

    if (taylorBtn) {
      taylorBtn.addEventListener('click', async () => {
        const expr = this.activeSetup.expr || document.getElementById('expr-explicit-input').value;
        const targetVar = document.getElementById('taylor-var-select')?.value || 'x';
        const x0 = parseFloat(document.getElementById('taylor-x0')?.value) || 0;
        const order = parseInt(document.getElementById('taylor-order')?.value) || 4;

        taylorOut.innerHTML = '<span style="color: var(--win-accent);">SymPy 泰勒多项式展开计算中...</span>';
        taylorCard.style.display = 'block';

        if (window.pywebview && window.pywebview.api) {
          try {
            const res = await window.pywebview.api.compute_taylor(expr, targetVar, x0, order);
            if (res.success) {
              const latexStr = `P_{${order}}(${targetVar}) = ${res.latex}`;
              katex.render(latexStr, taylorOut, { throwOnError: false, displayMode: true });
            } else {
              taylorOut.textContent = "展开失败: " + res.error;
            }
          } catch (e) {
            taylorOut.textContent = "调用异常: " + e;
          }
        }
      });
    }

    // Integral Button
    const integralBtn = document.getElementById('calc-integral-btn');
    const integralCard = document.getElementById('card-integral-result');
    const integralOut = document.getElementById('integral-katex-out');

    integralBtn.addEventListener('click', async () => {
      const expr = this.activeSetup.expr || document.getElementById('expr-explicit-input').value;
      const targetVar = document.getElementById('integral-var-select')?.value || 'x';
      const aVal = document.getElementById('integral-a-input')?.value.trim();
      const bVal = document.getElementById('integral-b-input')?.value.trim();

      integralOut.innerHTML = '<span style="color: var(--win-accent);">SymPy 定积分计算中...</span>';
      integralCard.style.display = 'block';

      if (window.pywebview && window.pywebview.api) {
        try {
          const res = await window.pywebview.api.compute_integral(expr, targetVar, aVal, bVal);
          if (res.success) {
            let outLatex = res.latex;
            if (res.numeric_val !== null && res.numeric_val !== undefined) {
              outLatex += ` \\approx ${res.numeric_val.toFixed(6)}`;
            }
            katex.render(outLatex, integralOut, { throwOnError: false, displayMode: true });
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
  syncPresetLanguage() {
    const presets = this.presets.getAllPresets();
    for (const id of ['preset-selector', 'mix-preset-a', 'mix-preset-b']) {
      const select = document.getElementById(id);
      const previous = select.value;
      select.replaceChildren(...presets.map(preset => new Option(
        `${translate(preset.category)} · ${translate(preset.name)}`, preset.id
      )));
      if (presets.some(preset => preset.id === previous)) select.value = previous;
    }
    const suggestions = document.getElementById('function-search-options');
    suggestions.replaceChildren(...presets.map(preset => new Option(translate(preset.category), translate(preset.name))));
    this.updatePresetDetail();
  }

  updatePresetDetail() {
    const preset = this.presets.getPresetById(document.getElementById('preset-selector').value);
    if (!preset) return;
    document.getElementById('preset-detail-title').textContent = preset.name;
    document.getElementById('preset-detail-desc').textContent = preset.description;
  }

  initPresetControls() {
    const selector = document.getElementById('preset-selector');
    const mixA = document.getElementById('mix-preset-a');
    const mixB = document.getElementById('mix-preset-b');

    this.syncPresetLanguage();
    selector.addEventListener('change', () => this.updatePresetDetail());

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
    this.invalidateCompiledFunction();
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
    const cancelBtn = document.getElementById('cancel-mp4-export-btn');
    const progressCard = document.getElementById('export-progress-card');
    const progressBar = document.getElementById('export-progress-bar');
    const percentText = document.getElementById('export-percent-text');
    const statusText = document.getElementById('export-status-text');
    const finishActions = document.getElementById('export-finish-actions');
    let exportedFilePath = "";
    let isExportCancelled = false;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        isExportCancelled = true;
        statusText.textContent = "已请求取消导出，正在终止 FFmpeg 进程...";
        if (window.pywebview && window.pywebview.api && window.pywebview.api.cancel_video_render) {
          await window.pywebview.api.cancel_video_render();
        }
        exportBtn.disabled = false;
        this.toast('已取消视频导出并清理临时文件', 'info');
      });
    }

    exportBtn.addEventListener('click', async () => {
      if (!window.pywebview || !window.pywebview.api) {
        this.toast('请在打包的 Windows 工具环境下运行以调用本地 FFmpeg 视频编码器。', 'error');
        return;
      }

      // 1. Choose Save Destination via Native Dialog
      const savePath = await window.pywebview.api.select_save_path("math_animation_1080p.mp4");
      if (!savePath) return;

      exportedFilePath = savePath;
      isExportCancelled = false;
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
      document.querySelector('[data-view-tab="view"]').click();
      const origWidth = this.viewport.container.clientWidth;
      const origHeight = this.viewport.container.clientHeight;
      this.viewport.resizeRenderer(width, height, false);

      // 3. Render Frame by Frame
      for (let f = 0; f < totalFrames; f++) {
        if (isExportCancelled) {
          statusText.textContent = "视频导出已由用户中止。";
          break;
        }

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

      // Restore renderer size
      this.viewport.resizeRenderer(origWidth, origHeight, false);
      exportBtn.disabled = false;

      // 4. Finish Rendering if not cancelled
      if (!isExportCancelled) {
        statusText.textContent = "正在封闭封装 MP4 文件容器...";
        const finishRes = await window.pywebview.api.finish_video_render();
        if (finishRes.success) {
          statusText.textContent = `✓ 导出完成！文件大小: ${finishRes.file_size_mb} MB`;
          finishActions.style.display = 'flex';
          this.toast('视频导出成功！', 'success');
        } else {
          statusText.textContent = `导出出错: ${finishRes.error}`;
        }
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

    const currentParams = this.mathNodes.evaluate(this.keyframes.evaluateAll(this.keyframes.currentTime));
    if (lang === 'threejs') {
      codeBox.textContent = CodeGenerator.generateThreeJsHtml(this.activeSetup, currentParams);
    } else {
      codeBox.textContent = CodeGenerator.generatePythonMatplotlib(this.activeSetup, currentParams);
    }
  }

  // --------------------------------------------------------------------------
  // Preferences & Viewport Controls
  // --------------------------------------------------------------------------
  initPreferencesControls() {
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
      this.syncViewportZoom();
      this.syncCameraPanel();
    });

    document.getElementById('cam-autorotate').addEventListener('change', (e) => {
      this.viewport.setAutoRotate(e.target.checked);
    });

    if (this.viewport && this.viewport.controls) {
      let pending = false;
      this.viewport.controls.addEventListener('change', () => {
        if (panel.style.display === 'none' || pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; this.syncCameraPanel(); });
      });
    }
  }

  initWorkspaceControls() {
    const viewTabs = document.querySelectorAll('[data-view-tab]');
    const timelineTabs = document.querySelectorAll('[data-timeline-tab]');
    const activate = (buttons, active) => buttons.forEach(button => {
      button.classList.toggle('active', button === active);
      button.setAttribute('aria-pressed', String(button === active));
    });

    viewTabs.forEach(button => button.addEventListener('click', () => {
      activate(viewTabs, button);
      const workspace = button.dataset.viewTab;
      if (workspace !== 'algebra') this.mathNodes.closeMenu();
      for (const name of ['view', 'algebra', 'geometry']) {
        document.getElementById(`workspace-${name}`).hidden = name !== workspace;
      }
      document.querySelector('.viewport-settings').hidden = workspace !== 'view';
      if (workspace === 'algebra') this.orthographicViews.refresh();
      if (workspace === 'geometry') this.meshWorkspace.show();
    }));

    timelineTabs.forEach(button => button.addEventListener('click', () => {
      activate(timelineTabs, button);
      this.timelineEditor.setCurveMode(button.dataset.timelineTab === 'curve');
    }));

    const zoom = document.getElementById('viewport-zoom');
    zoom.addEventListener('input', () => {
      this.viewport.setZoom(Number(zoom.value) / 100);
      this.syncViewportZoom();
    });
    this.viewport.controls.addEventListener('change', () => this.syncViewportZoom());

    const geometry = document.getElementById('geometry-attributes');
    const layerButton = document.getElementById('layer-object-btn');
    const layerDetails = document.getElementById('layer-details');
    layerButton.addEventListener('click', () => {
      const expanded = layerDetails.hidden;
      layerDetails.hidden = !expanded;
      layerButton.setAttribute('aria-expanded', String(expanded));
    });
    document.getElementById('view-quality-btn').addEventListener('click', () => {
      if (document.body.classList.contains('focus-3d')) document.body.classList.remove('focus-3d');
      geometry.open = true;
      document.getElementById('mesh-res-slider').focus();
    });
    document.getElementById('attribute-camera-btn').addEventListener('click', () => {
      document.getElementById('camera-panel-toggle-btn').click();
    });
    document.getElementById('layer-visible').addEventListener('change', event => {
      this.setLayerVisibility(event.target.checked);
    });

    this.viewport.bindViewGizmo(document.getElementById('viewport-gizmo'));
    this.syncCameraPanel();
  }

  syncViewportZoom() {
    const percent = Math.round(this.viewport.camera.zoom * 100);
    document.getElementById('viewport-zoom').value = percent;
    document.getElementById('viewport-zoom-value').value = `${percent}%`;
  }

  setLayerVisibility(visible) {
    document.getElementById('layer-visible').checked = visible;
    this.viewport.plotGroup.visible = visible;
    this.viewport.epicycleGroup.visible = visible;
    this.updateShadingLegend();
  }

  initViewportDisplayControls() {
    const element = id => document.getElementById(id);
    this.viewportMenus = [element('overlay-menu'), element('shading-menu')];
    this.viewportMenus.forEach(menu => {
      menu.addEventListener('toggle', () => {
        if (menu.open) this.viewportMenus.forEach(other => { if (other !== menu) other.open = false; });
      });
    });
    document.addEventListener('pointerdown', event => {
      this.viewportMenus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      this.viewportMenus.forEach(menu => {
        if (!menu.open) return;
        menu.open = false;
        menu.querySelector('summary').focus();
      });
    });
    element('attribute-shading-btn').addEventListener('click', () => this.openViewportSettings('shading-menu'));

    const guideControls = element('guide-controls');
    this.guideInputs = [...guideControls.querySelectorAll('[data-guide], [data-axis-guide], [data-cursor-axis]')];
    guideControls.addEventListener('change', event => {
      const input = event.target;
      const { guide, axisGuide, cursorAxis } = input.dataset;
      const current = this.viewport.guides.settings;
      if (input.type === 'number' && (!Number.isFinite(input.valueAsNumber) || !input.checkValidity())) {
        this.syncGuideControls();
        return;
      }
      if (guide) {
        const value = input.type === 'checkbox' ? input.checked
          : input.tagName === 'SELECT' ? input.value : input.valueAsNumber;
        this.viewport.configureGuides({ ...current, [guide]: value });
      } else if (axisGuide !== undefined) {
        const axes = [...current.axes];
        axes[Number(axisGuide)] = input.checked;
        this.viewport.configureGuides({ ...current, axes });
      } else if (cursorAxis !== undefined) {
        const position = [...current.cursorPosition];
        position[Number(cursorAxis)] = input.valueAsNumber;
        this.viewport.guides.setCursorPosition(position);
      }
      this.syncGuideControls();
      this.updateShadingLegend();
    });
    element('cursor-reset').addEventListener('click', () => {
      this.viewport.guides.setCursorPosition([0, 0, 0]);
      this.syncGuideControls();
    });
    this.viewport.onCursorPlaced = () => this.syncGuideControls();

    this.shadingControls = {
      metric: element('property-metric'),
      palette: element('colormap-select'),
      rangeMode: element('color-range-mode'),
      rangeForm: element('color-range-form'),
      min: element('color-range-min'),
      max: element('color-range-max'),
      error: element('color-range-error'),
      legendToggle: element('color-legend-toggle'),
      legend: element('color-legend'),
      legendName: element('color-legend-name'),
      ramp: element('color-legend-ramp'),
      legendMin: element('color-legend-min'),
      legendMax: element('color-legend-max')
    };
    const controls = this.shadingControls;
    const shading = this.viewport.shading;
    const redraw = () => this.renderCurrentFrame(this.keyframes.currentTime, this.keyframes.evaluateAll(this.keyframes.currentTime));
    controls.metric.addEventListener('change', () => {
      this.shadingMetric = controls.metric.value;
      this.syncShadingControls();
      redraw();
    });
    controls.palette.addEventListener('change', () => {
      shading.setPalette(controls.palette.value);
      redraw();
    });
    controls.rangeMode.addEventListener('change', () => {
      if (controls.rangeMode.value === 'auto') {
        shading.manualRange = null;
      } else {
        const [min, max] = shading.dataRange || [0, 1];
        const padding = Math.max(Math.abs(min) * 0.05, 0.01);
        shading.manualRange = this.lastManualRange || (min < max ? [min, max] : [min - padding, max + padding]);
      }
      this.syncShadingControls(true);
      redraw();
    });
    controls.rangeForm.addEventListener('submit', event => {
      event.preventDefault();
      const min = controls.min.valueAsNumber, max = controls.max.valueAsNumber;
      const valid = Number.isFinite(min) && Number.isFinite(max) && min < max;
      controls.error.hidden = valid;
      if (!valid) return;
      shading.manualRange = this.lastManualRange = [min, max];
      redraw();
    });
    controls.legendToggle.addEventListener('change', () => {
      this.showColorLegend = controls.legendToggle.checked;
      this.updateShadingLegend();
    });
    this.restoreViewportDisplay();
  }

  openViewportSettings(id) {
    this.showPage('studio');
    document.querySelector('[data-view-tab="view"]').click();
    this.viewportMenus.forEach(menu => { menu.open = menu.id === id; });
    document.getElementById(id).querySelector('summary').focus();
  }

  restoreViewportDisplay(viewport) {
    viewport ??= {};
    const previousGuides = viewport.guides || {
      floor: viewport.showGrid,
      orthoGrid: viewport.showGrid,
      axes: typeof viewport.showAxes === 'boolean' ? Array(3).fill(viewport.showAxes) : undefined,
      wireMode: viewport.wireframe ? 'only' : 'off'
    };
    this.viewport.configureGuides(previousGuides);
    this.viewport.shading.configure({ palette: viewport.colormap, range: viewport.shading?.range });
    this.shadingMetric = viewport.shading?.metric || null;
    this.lastManualRange = this.viewport.shading.manualRange;
    this.showColorLegend = viewport.shading?.showLegend !== false;
    this.syncGuideControls();
    this.syncShadingControls(true);
  }

  syncGuideControls() {
    const settings = this.viewport.guides.settings;
    for (const input of this.guideInputs) {
      const { guide, axisGuide, cursorAxis } = input.dataset;
      if (axisGuide !== undefined) input.checked = settings.axes[Number(axisGuide)];
      else if (cursorAxis !== undefined) input.value = Number(settings.cursorPosition[Number(cursorAxis)].toPrecision(8));
      else if (input.type === 'checkbox') input.checked = settings[guide];
      else input.value = settings[guide];
    }
    this.guideInputs.find(input => input.dataset.guide === 'wireMode').disabled = this.activeType === 'vector_field';
    this.guideInputs.find(input => input.dataset.guide === 'wireOpacity').disabled =
      this.activeType === 'vector_field' || settings.wireMode !== 'overlay';
  }

  currentShadingMetric() {
    const metrics = propertyMetrics[this.activeType] || propertyMetrics.explicit;
    return metrics.includes(this.shadingMetric) ? this.shadingMetric : metrics[0];
  }

  syncShadingControls(writeRange = false) {
    const controls = this.shadingControls;
    const { palette, manualRange } = this.viewport.shading;
    const metric = this.currentShadingMetric();
    const available = propertyMetrics[this.activeType] || propertyMetrics.explicit;
    for (const option of controls.metric.options) option.disabled = !available.includes(option.value);
    controls.metric.value = metric;
    controls.palette.value = palette;
    controls.rangeMode.value = manualRange ? 'manual' : 'auto';
    controls.palette.disabled = controls.rangeMode.disabled = controls.legendToggle.disabled = metric === 'solid';
    controls.rangeForm.hidden = !manualRange || metric === 'solid';
    controls.legendToggle.checked = this.showColorLegend;
    if (writeRange) {
      controls.error.hidden = true;
      [controls.min.value, controls.max.value] = manualRange || ['', ''];
    }
  }

  updateShadingLegend() {
    const controls = this.shadingControls;
    const metric = this.currentShadingMetric();
    const { displayRange, gradient } = this.viewport.shading;
    controls.legend.hidden = !this.showColorLegend || metric === 'solid' || !this.viewport.plotGroup.visible ||
      (this.activeType !== 'vector_field' && this.viewport.guides.settings.wireMode === 'only');
    if (controls.legend.hidden) return;
    const label = controls.metric.selectedOptions[0]?.textContent;
    const format = value => {
      const size = Math.abs(value);
      return size && (size < 0.001 || size >= 10000)
        ? value.toExponential(3) : legendNumberFormats[getLocale()].format(value);
    };
    const min = displayRange ? format(displayRange[0]) : '无有效数据';
    const max = displayRange ? format(displayRange[1]) : '';
    const key = JSON.stringify([label, gradient, min, max]);
    if (key === this.legendKey) return;
    this.legendKey = key;
    controls.legendName.textContent = label;
    controls.ramp.style.background = displayRange ? gradient : 'var(--workspace-divider)';
    controls.legendMin.textContent = min;
    controls.legendMax.textContent = max;
  }

  setTheme(theme, sceneColor = theme === 'light' ? 0xf5f5f5 : 0x060606) {
    document.documentElement.setAttribute('data-theme', theme);
    this.viewport.scene.background.setHex(sceneColor);
    this.viewport.setGuideTheme(theme === 'light');
    this.orthographicViews.refresh();
    this.meshWorkspace.refresh();
    this.timelineEditor.draw();
  }

  updateGeometryInfo() {
    const { points, edges, faces } = this.viewport.geometryCounts;
    const key = `${this.activeType}/${points}/${edges}/${faces}`;
    if (key === this.geometryKey) return;
    this.geometryKey = key;
    const names = {
      explicit: '显式曲面',
      parametric_curve: '参数曲线',
      parametric_surface: '参数曲面',
      vector_field: '向量场'
    };
    document.getElementById('layer-object-name').textContent = names[this.activeType];
    const counts = { points, edges, faces };
    for (const [name, count] of Object.entries(counts)) {
      const value = count.toLocaleString(getLocale());
      document.getElementById(`geometry-${name}`).textContent = value;
      document.getElementById(`layer-${name}`).textContent = value;
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
    this.restoreLayout().then(() => this.applyLayout());
    if (!this.isNative()) {
      window.addEventListener('pywebviewready', async () => {
        await this.restoreLayout();
        this.applyLayout();
      }, { once: true });
    }
  }

  initSplitters() {
    this.makeResizable('sidebar-splitter', 'sidebar', 'leftWidth', '--left-width', 'x', 1, 154, 360);
    this.makeResizable('content-splitter', 'attribute-panel', 'attributeWidth', '--attribute-width', 'x', -1, 152, 320);
    this.makeResizable('timeline-splitter', 'workspace-bottom', 'bottomHeight', '--bottom-height', 'y', -1, 140, 520);
    const bottom = document.getElementById('workspace-bottom');
    this.makeResizable('layer-timeline-splitter', 'layer-panel', 'layerWidthPercent', '--layer-width', 'x', 1, 0, 100, bottom);
  }

  makeResizable(splitterId, paneId, key, property, axis, direction, min, max, relativeTo) {
    const splitter = document.getElementById(splitterId);
    const pane = document.getElementById(paneId);
    const workspace = document.getElementById('workspace');
    splitter.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      splitter.classList.add('dragging');
      splitter.setPointerCapture(event.pointerId);
      const start = axis === 'x' ? event.clientX : event.clientY;
      const startSize = axis === 'x' ? pane.offsetWidth : pane.offsetHeight;

      const move = pointer => {
        const coord = axis === 'x' ? pointer.clientX : pointer.clientY;
        const pixels = startSize + direction * (coord - start);
        const value = relativeTo ? 100 * pixels / relativeTo.clientWidth : pixels;
        const size = Math.max(min, Math.min(max, value));
        this.layout[key] = size;
        (relativeTo || workspace).style.setProperty(property, `${size}${relativeTo ? '%' : 'px'}`);
      };
      const finish = () => {
        splitter.classList.remove('dragging');
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('lostpointercapture', finish);
        this.saveLayout(false);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('lostpointercapture', finish);
    });
  }

  async restoreLayout() {
    let data = null;
    if (this.isNative()) {
      data = await this.nativeCall('load_layout', []);
    }
    if (!data || typeof data !== 'object') {
      try { data = JSON.parse(localStorage.getItem('mathstudio_layout_v2') || localStorage.getItem('mathstudio_layout_v1') || 'null'); } catch (e) { data = null; }
    }
    if (data?.version === 2) {
      this.layout = { ...this.layoutDefaults, ...data };
    } else if (data?.cameraPanel === true) {
      this.layout.cameraPanel = true;
    }
  }

  async saveLayout(showToast = false) {
    const layout = Object.assign({}, this.layout);
    layout.cameraPanel = document.getElementById('camera-panel').style.display !== 'none';
    if (this.isNative()) {
      await this.nativeCall('save_layout', [layout]);
    }
    try { localStorage.setItem('mathstudio_layout_v2', JSON.stringify(layout)); } catch (e) {}
    if (showToast) this.toast('工作区布局已保存', 'success');
  }

  applyLayout() {
    const workspace = document.getElementById('workspace');
    for (const [key, property] of [
      ['leftWidth', '--left-width'],
      ['attributeWidth', '--attribute-width'],
      ['bottomHeight', '--bottom-height']
    ]) {
      if (Number.isFinite(this.layout[key]) && this.layout[key] > 0) {
        workspace.style.setProperty(property, `${this.layout[key]}px`);
      }
    }
    const bottom = document.getElementById('workspace-bottom');
    const widthPercent = this.layout.layerWidthPercent;
    if (Number.isFinite(widthPercent) && widthPercent >= 0 && widthPercent <= 100) {
      bottom.style.setProperty('--layer-width', `${widthPercent}%`);
    } else {
      bottom.style.removeProperty('--layer-width');
    }
    const panel = document.getElementById('camera-panel');
    panel.style.display = this.layout.cameraPanel ? 'block' : 'none';
    if (this.layout.cameraPanel) this.syncCameraPanel();
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

  invalidateCompiledFunction() {
    this._compiledFn = null;
    this._compiledType = null;
  }

  getCompiledFunction() {
    if (this._compiledFn && this._compiledType === this.activeType) {
      return this._compiledFn;
    }
    this._compiledType = this.activeType;
    if (this.activeType === 'explicit') {
      this._compiledFn = this.parser.compileExplicit(this.activeSetup.expr);
    } else if (this.activeType === 'parametric_curve') {
      this._compiledFn = this.parser.compileParametricCurve(this.activeSetup.exprX, this.activeSetup.exprY, this.activeSetup.exprZ);
    } else if (this.activeType === 'parametric_surface') {
      this._compiledFn = this.parser.compileParametricSurface(this.activeSetup.exprX, this.activeSetup.exprY, this.activeSetup.exprZ);
    } else if (this.activeType === 'vector_field') {
      this._compiledFn = this.parser.compileVectorField(this.activeSetup.vecU, this.activeSetup.vecV, this.activeSetup.vecW);
    }
    return this._compiledFn;
  }

  // --------------------------------------------------------------------------
  // 3D Frame Render Evaluation
  // --------------------------------------------------------------------------
  renderCurrentFrame(t, scope) {
    scope = this.mathNodes.evaluate(scope);
    const fn = this.getCompiledFunction();
    const metric = this.currentShadingMetric();
    const resolution = Math.max(20, Math.min(140, Math.round(Number(this.activeSetup.meshRes)) || 70));
    if (this.displayedPlotType !== this.activeType) {
      this.displayedPlotType = this.activeType;
      this.syncGuideControls();
      this.syncShadingControls();
    }
    if (this.activeType === 'explicit') {
      this.viewport.plotExplicitSurface(
        (x, y) => fn(x, y, scope),
        this.activeSetup.xRange,
        this.activeSetup.yRange,
        resolution,
        resolution,
        metric
      );
    } else if (this.activeType === 'parametric_curve') {
      this.viewport.plotParametricCurve((u) => fn(u, scope), this.activeSetup.uRange, 400, metric);
    } else if (this.activeType === 'parametric_surface') {
      this.viewport.plotParametricSurface((u, v) => fn(u, v, scope), this.activeSetup.uRange, this.activeSetup.vRange, resolution, resolution, metric);
    } else if (this.activeType === 'vector_field') {
      this.viewport.plotVectorField((x, y, z) => fn(x, y, z, scope), 4, 1.8, metric);
    }

    this.updateGeometryInfo();
    this.updateShadingLegend();

    // Render Fourier Epicycles if active
    if (this.fourierEpicyclesActive && this.activeHarmonics.length > 0) {
      this.viewport.renderFourierEpicycles(this.activeHarmonics, t);
    }
    this.orthographicViews.refresh();
  }
}

// Bootstrap on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
