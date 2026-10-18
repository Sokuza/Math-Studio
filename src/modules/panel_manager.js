/**
 * PanelManager — Blender-style collapsible panel management.
 *
 * Turns every `.win11-card` and `.win11-expander` inside the settings pane into a
 * managed "panel" with:
 *   - a collapse chevron in the top-left corner,
 *   - a small dropdown (top-left) to customize the panel TYPE (default / accent /
 *     compact / floating) plus quick actions (collapse/expand, reset).
 *
 * Collapse + type state is persisted to localStorage (and survives within a
 * session; the native backend may additionally persist it if private mode is
 * disabled). Existing card content, event listeners and functionality are left
 * untouched — only a small tools cluster is prepended and CSS classes are toggled.
 */

export class PanelManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'mathstudio_panels_v1';
    this.scopeSelector = options.scopeSelector || '#settings-scroll-pane';
    this.state = this._load();
    this._menu = null;
    this._docClickHandler = null;
    this._init();
  }

  // ---- persistence ----------------------------------------------------------
  _load() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '{}');
    } catch (e) {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch (e) {}
  }

  // ---- helpers --------------------------------------------------------------
  _panelId(el, index) {
    const title = el.querySelector('.card-title');
    const base = title ? title.textContent.trim() : 'panel';
    const slug = base.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
    return (slug || 'panel') + '-' + index;
  }

  _stateFor(id) {
    if (!this.state[id]) this.state[id] = {};
    return this.state[id];
  }

  // ---- setup ----------------------------------------------------------------
  _init() {
    const scope = document.querySelector(this.scopeSelector);
    if (!scope) return;
    scope.querySelectorAll('.win11-card').forEach((card, i) => this._enhanceCard(card, i));
    scope.querySelectorAll('.win11-expander').forEach((exp, i) => this._enhanceExpander(exp, i));
  }

  _makeTools(id) {
    const tools = document.createElement('span');
    tools.className = 'panel-tools';

    const chevron = document.createElement('span');
    chevron.className = 'panel-chevron';
    chevron.textContent = '▾';
    chevron.title = '折叠 / 展开';
    chevron.setAttribute('role', 'button');

    const typeBtn = document.createElement('button');
    typeBtn.className = 'panel-type-btn';
    typeBtn.type = 'button';
    typeBtn.textContent = '⚙';
    typeBtn.title = '面板类型与操作';

    tools.appendChild(chevron);
    tools.appendChild(typeBtn);

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._toggleCollapse(id, tools.closest('.panel'));
    });

    typeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._openMenu(id, tools.closest('.panel'), typeBtn);
    });

    return tools;
  }

  _enhanceCard(card, index) {
    const id = this._panelId(card, index);
    card.classList.add('panel');
    card.dataset.panelId = id;
    card.dataset.panelKind = 'card';

    card.insertBefore(this._makeTools(id), card.firstChild);

    const st = this._stateFor(id);
    if (st.collapsed) card.classList.add('collapsed');
    this._applyType(card, st.type);
  }

  _enhanceExpander(exp, index) {
    const id = 'expander-' + index;
    const header = exp.querySelector('.expander-header');
    if (!header) return;

    exp.classList.add('panel');
    exp.dataset.panelId = id;
    exp.dataset.panelKind = 'expander';

    header.insertBefore(this._makeTools(id), header.firstChild);

    // Make the whole header clickable to collapse, like Blender panels.
    header.addEventListener('click', (e) => {
      if (e.target.closest('.panel-tools, button, input, select, a')) return;
      this._toggleCollapse(id, exp);
    });

    const st = this._stateFor(id);
    // Collapsed state is represented by the absence of the `open` class.
    if (st.collapsed) exp.classList.remove('open');
    else if (!exp.classList.contains('open')) exp.classList.add('open');
    this._applyType(exp, st.type);
  }

  // ---- actions --------------------------------------------------------------
  _isCollapsed(panel) {
    if (panel.dataset.panelKind === 'expander') {
      return !panel.classList.contains('open');
    }
    return panel.classList.contains('collapsed');
  }

  _setCollapsed(panel, collapsed) {
    if (panel.dataset.panelKind === 'expander') {
      panel.classList.toggle('open', !collapsed);
      panel.classList.toggle('collapsed', collapsed);
    } else {
      panel.classList.toggle('collapsed', collapsed);
    }
  }

  _toggleCollapse(id, panel) {
    if (!panel) return;
    const collapsed = !this._isCollapsed(panel);
    this._setCollapsed(panel, collapsed);
    this._stateFor(id).collapsed = collapsed;
    this._save();
  }

  _applyType(panel, type) {
    ['panel-accent', 'panel-compact', 'panel-floating'].forEach((c) => panel.classList.remove(c));
    if (type && type !== 'default' && type !== 'normal') panel.classList.add('panel-' + type);
  }

  _setType(id, panel, type) {
    this._applyType(panel, type);
    this._stateFor(id).type = type;
    this._save();
  }

  _reset(id, panel) {
    panel.classList.remove('collapsed', 'panel-accent', 'panel-compact', 'panel-floating');
    if (panel.dataset.panelKind === 'expander') panel.classList.add('open');
    delete this.state[id];
    this._save();
  }

  // ---- dropdown menu --------------------------------------------------------
  _openMenu(id, panel, anchor) {
    this._closeMenu();

    const menu = document.createElement('div');
    menu.className = 'panel-menu';

    const collapsed = this._isCollapsed(panel);
    const currentType = (this.state[id] && this.state[id].type) || 'default';

    const types = [
      ['default', '默认面板'],
      ['accent', '高亮面板'],
      ['compact', '紧凑面板'],
      ['floating', '悬浮面板'],
    ];

    const items = [];
    items.push(`<div class="panel-menu-title">面板管理</div>`);
    items.push(`<div class="panel-menu-item" data-act="toggle">${collapsed ? '展开面板' : '折叠面板'}</div>`);
    items.push(`<div class="panel-menu-divider"></div>`);
    items.push(`<div class="panel-menu-label">面板类型</div>`);
    types.forEach(([val, label]) => {
      const active = currentType === val ? ' active' : '';
      items.push(`<div class="panel-menu-item${active}" data-act="type" data-type="${val}">${label}</div>`);
    });
    items.push(`<div class="panel-menu-divider"></div>`);
    items.push(`<div class="panel-menu-item" data-act="reset">重置面板</div>`);

    menu.innerHTML = items.join('');

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.panel-menu-item');
      if (!item) return;
      const act = item.dataset.act;
      if (act === 'toggle') this._toggleCollapse(id, panel);
      else if (act === 'type') this._setType(id, panel, item.dataset.type);
      else if (act === 'reset') this._reset(id, panel);
      this._closeMenu();
    });

    document.body.appendChild(menu);

    const r = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 4;
    if (left + menuRect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuRect.width - 8);
    if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, r.top - menuRect.height - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    this._menu = menu;
    this._docClickHandler = (ev) => {
      if (!menu.contains(ev.target)) this._closeMenu();
    };
    setTimeout(() => document.addEventListener('click', this._docClickHandler), 0);
  }

  _closeMenu() {
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
    if (this._docClickHandler) {
      document.removeEventListener('click', this._docClickHandler);
      this._docClickHandler = null;
    }
  }
}
