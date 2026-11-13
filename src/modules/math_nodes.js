import { translate } from './i18n.js';

const operations = {
  add: ['加法', 2, (a, b) => a + b],
  subtract: ['减法', 2, (a, b) => a - b],
  multiply: ['乘法', 2, (a, b) => a * b],
  divide: ['除法', 2, (a, b) => a / b],
  power: ['乘方', 2, (a, b) => a ** b],
  mod: ['取余', 2, (a, b) => a % b],
  sin: ['正弦', 1, Math.sin],
  cos: ['余弦', 1, Math.cos],
  tan: ['正切', 1, Math.tan],
  sqrt: ['平方根', 1, Math.sqrt],
  exp: ['指数', 1, Math.exp],
  log: ['自然对数', 1, Math.log],
  abs: ['绝对值', 1, Math.abs],
  min: ['取最小值', 2, Math.min],
  max: ['取最大值', 2, Math.max],
  clamp: ['限制范围', 3, (a, low, high) => Math.min(Math.max(a, low), high)],
  mix: ['线性插值', 3, (a, b, t) => a + (b - a) * t]
};

const kinds = {
  parameter: ['读取参数', 0],
  constant: ['常数', 0],
  time: ['时间', 0],
  output: ['写入参数', 1],
  ...operations
};

const groups = [
  ['参数与时间', ['parameter', 'constant', 'time', 'output']],
  ['运算', ['add', 'subtract', 'multiply', 'divide', 'power', 'mod']],
  ['函数组', ['sin', 'cos', 'tan', 'sqrt', 'exp', 'log', 'abs']],
  ['范围与混合', ['min', 'max', 'clamp', 'mix']]
];

const element = (tag, className, label) => {
  const node = document.createElement(tag);
  node.className = className;
  if (label) node.textContent = label;
  return node;
};

export class MathNodes {
  constructor(onChange) {
    this.onChange = onChange;
    this.board = document.getElementById('node-board');
    this.scroll = document.getElementById('node-scroll');
    this.cards = this.board.querySelector('.node-cards');
    this.svg = this.board.querySelector('svg');
    this.status = document.getElementById('node-status');
    this.zoom = 1;
    this.pan = [0, 0];
    this.selectionBox = element('div', 'node-box-select');
    this.selectionBox.hidden = true;
    this.selectionBox.setAttribute('aria-hidden', 'true');
    this.scroll.append(this.selectionBox);

    this.menu = element('div', 'node-menu');
    this.menu.hidden = true;
    this.menu.setAttribute('aria-label', '添加节点');
    this.categories = element('div', 'node-menu-categories');
    this.choices = element('div', 'node-menu-items');
    this.menu.append(this.categories, this.choices);
    document.body.append(this.menu);
    this.load();

    this.scroll.addEventListener('pointerdown', event => this.pointerDown(event));
    this.scroll.addEventListener('click', event => this.portClick(event));
    this.scroll.addEventListener('contextmenu', event => {
      event.preventDefault();
      this.openMenu(event.clientX, event.clientY);
    });
    this.scroll.addEventListener('wheel', event => this.zoomAt(event), { passive: false });
    this.scroll.addEventListener('dblclick', event => {
      const input = event.target.closest('[data-input]');
      if (!input) return;
      const node = this.byId.get(input.closest('.math-node').dataset.id);
      node.inputs[Number(input.dataset.input)] = null;
      this.pending = null;
      this.changed();
      this.scroll.focus({ preventScroll: true });
    });
    this.scroll.addEventListener('keydown', event => {
      if (event.target.matches('input, select, textarea, [contenteditable]')) return;
      if (event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        this.remove();
        this.scroll.focus({ preventScroll: true });
      } else if (event.key === 'Home' && this.nodes.length) {
        event.preventDefault();
        this.frameNodes();
      } else if (event.key === 'Escape' && this.pending) {
        this.pending = null;
        this.drawLinks();
      } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        const rect = this.scroll.getBoundingClientRect();
        this.openMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    });
    this.menu.addEventListener('keydown', event => this.menuKey(event));
    this.menu.addEventListener('focusout', event => {
      if (event.relatedTarget && !this.menu.contains(event.relatedTarget)) this.closeMenu();
    });
    document.addEventListener('pointerdown', event => {
      if (!this.menu.contains(event.target)) this.closeMenu();
    });
    window.addEventListener('blur', () => this.closeMenu());
    new ResizeObserver(() => {
      this.closeMenu();
      if (this.fitOnOpen && this.scroll.clientWidth && this.scroll.clientHeight) this.frameNodes();
      this.drawLinks();
    }).observe(this.scroll);
  }

  load(data) {
    this.selected = new Set();
    this.pending = null;
    this.closeMenu();
    this.zoom = 1;
    this.pan = [0, 0];
    this.paintView();
    this.nodes = [];
    this.byId = new Map();
    for (const record of (Array.isArray(data) ? data.slice(0, 200) : [])) {
      if (!record || typeof record.id !== 'string' || this.byId.has(record.id) || !Object.hasOwn(kinds, record.kind)) continue;
      const node = {
        id: record.id,
        kind: record.kind,
        x: Number.isFinite(record.x) ? record.x : 18,
        y: Number.isFinite(record.y) ? record.y : 18,
        parameter: typeof record.parameter === 'string' ? record.parameter : 'A',
        value: Number.isFinite(record.value) ? record.value : 1,
        inputs: Array.from({length: kinds[record.kind][1]}, (_, i) =>
          typeof record.inputs?.[i] === 'string' ? record.inputs[i] : null)
      };
      this.nodes.push(node);
      this.byId.set(node.id, node);
    }
    this.fitOnOpen = this.nodes.length > 0;
    if (this.fitOnOpen && this.scroll.clientWidth && this.scroll.clientHeight) this.frameNodes();
    this.render();
  }

  serialize() { return structuredClone(this.nodes); }

  add(kind, [x, y]) {
    if (!Object.hasOwn(kinds, kind) || this.nodes.length >= 200) return;
    const id = globalThis.crypto.randomUUID();
    const node = {
      id, kind, x, y,
      value: 1, parameter: 'A', inputs: Array(kinds[kind][1]).fill(null)
    };
    this.nodes.push(node);
    this.byId.set(id, node);
    this.selected = new Set([id]);
    this.pending = null;
    this.changed();
  }

  remove() {
    if (!this.selected.size) return;
    this.nodes = this.nodes.filter(node => !this.selected.has(node.id));
    for (const id of this.selected) this.byId.delete(id);
    for (const node of this.nodes) node.inputs = node.inputs.map(input => this.selected.has(input) ? null : input);
    this.selected.clear();
    this.pending = null;
    this.changed();
  }

  evaluate(scope) {
    if (!this.nodes.some(node => node.kind === 'output' && node.inputs[0])) return scope;
    const cache = new Map();
    const visiting = new Set();
    const read = id => {
      if (cache.has(id)) return cache.get(id);
      const node = this.byId.get(id);
      if (!node || visiting.has(id)) return NaN;
      visiting.add(id);
      let value;
      if (node.kind === 'parameter') value = Object.hasOwn(scope, node.parameter) ? scope[node.parameter] : NaN;
      else if (node.kind === 'time') value = scope.t;
      else if (node.kind === 'constant') value = node.value;
      else if (Object.hasOwn(operations, node.kind)) {
        value = operations[node.kind][2](...node.inputs.map((input, index) => input ? read(input) : index === 0 ? 0 : 1));
      }
      visiting.delete(id);
      cache.set(id, value);
      return value;
    };
    const result = { ...scope };
    for (const node of this.nodes) {
      if (node.kind !== 'output' || !node.inputs[0] || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(node.parameter)) continue;
      if (['x','y','z','u','v','t','pi','e','__proto__','constructor','prototype','toString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','toLocaleString'].includes(node.parameter)) continue;
      const value = read(node.inputs[0]);
      if (Number.isFinite(value)) result[node.parameter] = value;
    }
    return result;
  }

  connect(source, target, slot) {
    const node = this.byId.get(target);
    const queue = [source];
    const visited = new Set();
    while (queue.length) {
      const id = queue.pop();
      if (id === target) {
        this.status.textContent = '连接会形成循环';
        return;
      }
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...(this.byId.get(id)?.inputs.filter(Boolean) || []));
    }
    if (node && this.byId.has(source) && this.byId.get(source).kind !== 'output' && slot < node.inputs.length) {
      node.inputs[slot] = source;
      this.changed();
    }
  }

  changed() {
    this.render();
    this.onChange();
  }

  render() {
    this.closeMenu();
    this.cards.replaceChildren(...this.nodes.map(node => this.createCard(node)));
    this.paintSelection();
    this.status.textContent = '右键添加节点 · 中键平移 · 滚轮缩放 · 左键拖动框选 · Delete 删除';
    this.drawLinks();
  }

  viewportPoint(clientX, clientY) {
    const rect = this.scroll.getBoundingClientRect();
    return [clientX - rect.left - this.scroll.clientLeft, clientY - rect.top - this.scroll.clientTop];
  }

  worldPoint(clientX, clientY) {
    const [x, y] = this.viewportPoint(clientX, clientY);
    return [(x - this.pan[0]) / this.zoom, (y - this.pan[1]) / this.zoom];
  }

  frameNodes() {
    const left = Math.min(...this.nodes.map(node => node.x));
    const top = Math.min(...this.nodes.map(node => node.y));
    const right = Math.max(...this.nodes.map(node => node.x + 140));
    const bottom = Math.max(...this.nodes.map(node => node.y + 132));
    const margin = 16;
    this.zoom = Math.max(0.25, Math.min(1,
      (this.scroll.clientWidth - 2 * margin) / (right - left),
      (this.scroll.clientHeight - 2 * margin) / (bottom - top)
    ));
    this.pan = [margin - left * this.zoom, margin - top * this.zoom];
    this.fitOnOpen = false;
    this.paintView();
  }

  paintView() {
    const [x, y] = this.pan;
    this.board.style.transform = `translate(${x}px, ${y}px) scale(${this.zoom})`;
    this.scroll.style.backgroundPosition = `${x}px ${y}px`;
    const spacing = Math.max(8, this.zoom * 16);
    this.scroll.style.backgroundSize = `${spacing}px ${spacing}px`;
  }

  zoomAt(event) {
    event.preventDefault();
    if (this.gesture) return;
    this.closeMenu();
    const anchor = this.worldPoint(event.clientX, event.clientY);
    const cursor = this.viewportPoint(event.clientX, event.clientY);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 160 : 1);
    this.zoom = Math.max(0.25, Math.min(2.75, this.zoom * Math.exp(-delta * 0.0015)));
    this.pan = cursor.map((value, index) => value - anchor[index] * this.zoom);
    this.paintView();
  }

  openMenu(clientX, clientY) {
    if (this.gesture) return;
    this.closeMenu();
    this.menuPoint = [clientX, clientY];
    this.menuOrigin = this.worldPoint(clientX, clientY);
    this.categories.replaceChildren(...groups.map(([label], index) => {
      const button = element('button', 'node-menu-row', translate(label));
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('pointerenter', () => this.showCategory(index));
      button.addEventListener('click', () => {
        this.showCategory(index);
        this.choices.firstElementChild.focus({ preventScroll: true });
      });
      return button;
    }));
    this.menu.hidden = false;
    this.showCategory(0);
    this.categories.firstElementChild.focus({ preventScroll: true });
  }

  showCategory(index) {
    if (this.category === index && this.choices.childElementCount) return;
    this.category = index;
    [...this.categories.children].forEach((button, i) => button.setAttribute('aria-expanded', String(i === index)));
    this.choices.replaceChildren(...groups[index][1].map(kind => {
      const button = element('button', 'node-menu-row', translate(kinds[kind][0]));
      button.type = 'button';
      button.dataset.nodeKind = kind;
      button.addEventListener('click', () => {
        const origin = this.menuOrigin;
        this.closeMenu(true);
        this.add(kind, origin);
      });
      return button;
    }));
    this.positionMenu();
  }

  positionMenu() {
    const [x, y] = this.menuPoint;
    this.menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - this.menu.offsetWidth - 4))}px`;
    this.menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - this.menu.offsetHeight - 4))}px`;
  }

  closeMenu(focus = false) {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.category = null;
    if (focus) this.scroll.focus({ preventScroll: true });
  }

  menuKey(event) {
    const inCategory = this.categories.contains(event.target);
    const column = inCategory ? this.categories : this.choices;
    const buttons = [...column.children];
    const index = buttons.indexOf(event.target);
    if (event.key === 'Escape') {
      this.closeMenu(true);
      event.stopPropagation();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + step + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
      if (inCategory) this.showCategory(next);
    } else if (event.key === 'ArrowRight' && inCategory) {
      this.showCategory(index);
      this.choices.firstElementChild.focus({ preventScroll: true });
    } else if (event.key === 'ArrowLeft' && !inCategory) {
      this.categories.children[this.category].focus({ preventScroll: true });
    } else {
      return;
    }
    event.preventDefault();
  }

  createCard(node) {
    const card = element('article', 'math-node');
    card.dataset.id = node.id;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    const header = element('header', 'math-node-title', kinds[node.kind][0]);
    card.append(header);
    if (node.kind === 'constant' || node.kind === 'parameter' || node.kind === 'output') {
      const input = element('input', 'win11-input node-field');
      input.type = node.kind === 'constant' ? 'number' : 'text';
      input.setAttribute('aria-label', node.kind === 'constant' ? '常数' : '参数名称');
      input.value = node.kind === 'constant' ? node.value : node.parameter;
      if (node.kind === 'constant') input.step = 'any';
      input.addEventListener('change', () => {
        if (node.kind === 'constant') node.value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : node.value;
        else node.parameter = input.value.trim();
        this.onChange();
      });
      card.append(input);
    }
    node.inputs.forEach((_, index) => {
      const row = element('div', 'node-port-row');
      const port = element('button', 'node-port');
      port.type = 'button';
      port.dataset.input = String(index);
      port.setAttribute('aria-label', '输入端口');
      row.append(port, String.fromCharCode(65 + index));
      card.append(row);
    });
    if (node.kind !== 'output') {
      const row = element('div', 'node-port-row node-output');
      const port = element('button', 'node-port');
      port.type = 'button';
      port.dataset.output = '';
      port.setAttribute('aria-label', '输出端口');
      row.append(port);
      card.append(row);
    }
    return card;
  }

  paintSelection() {
    for (const card of this.cards.children) card.classList.toggle('selected', this.selected.has(card.dataset.id));
  }

  portClick(event) {
    if (this.suppressClick) return;
    const port = event.target.closest('.node-port');
    if (!port) return;
    const id = port.closest('.math-node').dataset.id;
    if ('output' in port.dataset) {
      this.pending = this.pending === id ? null : id;
      this.drawLinks();
    } else if (this.pending) {
      const source = this.pending;
      this.pending = null;
      this.connect(source, id, Number(port.dataset.input));
      this.drawLinks();
    }
  }

  pointerDown(event) {
    if (this.gesture || (event.button !== 0 && event.button !== 1)) return;
    const card = event.target.closest('.math-node');
    const id = card?.dataset.id;
    const port = event.target.closest('[data-output]');
    const header = event.target.closest('.math-node-title');
    const pan = event.button === 1;
    if (pan || !event.target.closest('input, button, select')) {
      event.preventDefault();
      this.scroll.focus({ preventScroll: true });
    }

    if (!pan && id) {
      if (event.shiftKey) {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
      } else if (!this.selected.has(id) || !header) {
        this.selected = new Set([id]);
      }
      this.paintSelection();
      if (!port && !header) return;
    }

    const start = [event.clientX, event.clientY];
    const oldPan = [...this.pan];
    const initial = new Set(this.selected);
    const dragging = header && this.selected.has(id)
      ? [...this.cards.children].filter(node => this.selected.has(node.dataset.id)).map(node => {
        const record = this.byId.get(node.dataset.id);
        return [node, record, record.x, record.y];
      })
      : [];
    if (!pan && !id) {
      this.pending = null;
      if (!event.shiftKey) this.selected.clear();
      this.paintSelection();
      this.drawLinks();
    }
    const pointer = event.pointerId;
    this.gesture = true;
    if (pan) this.scroll.classList.add('panning');
    if (!port || pan) this.scroll.setPointerCapture(pointer);
    let moved = false;
    const move = next => {
      if (next.pointerId !== pointer) return;
      const dx = next.clientX - start[0], dy = next.clientY - start[1];
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved && port && !pan) this.scroll.setPointerCapture(pointer);
      moved = true;
      if (pan) {
        this.pan = [oldPan[0] + dx, oldPan[1] + dy];
        this.paintView();
      } else if (port) {
        this.drawLinks(id, this.worldPoint(next.clientX, next.clientY));
      } else if (header) {
        for (const [node, record, x, y] of dragging) {
          record.x = x + dx / this.zoom;
          record.y = y + dy / this.zoom;
          node.style.left = `${record.x}px`;
          node.style.top = `${record.y}px`;
        }
        this.drawLinks();
      } else {
        this.boxSelect(start, [next.clientX, next.clientY], event.shiftKey ? initial : []);
      }
    };
    const finish = next => {
      if (next.pointerId !== pointer) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      this.scroll.removeEventListener('lostpointercapture', finish);
      this.gesture = false;
      this.scroll.classList.remove('panning');
      this.selectionBox.hidden = true;
      if (!moved || pan || !port) return;
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 0);
      this.pending = null;
      const input = next.type === 'pointerup' && document.elementFromPoint(next.clientX, next.clientY)?.closest('[data-input]');
      if (input) this.connect(id, input.closest('.math-node').dataset.id, Number(input.dataset.input));
      this.drawLinks();
      this.scroll.focus({ preventScroll: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    this.scroll.addEventListener('lostpointercapture', finish);
  }

  boxSelect(start, end, initial) {
    const left = Math.min(start[0], end[0]), right = Math.max(start[0], end[0]);
    const top = Math.min(start[1], end[1]), bottom = Math.max(start[1], end[1]);
    const [x, y] = this.viewportPoint(left, top);
    this.selectionBox.hidden = false;
    Object.assign(this.selectionBox.style, {
      left: `${x}px`, top: `${y}px`, width: `${right - left}px`, height: `${bottom - top}px`
    });
    this.selected = new Set(initial);
    for (const card of this.cards.children) {
      const bounds = card.getBoundingClientRect();
      if (left < bounds.right && right > bounds.left && top < bounds.bottom && bottom > bounds.top) {
        this.selected.add(card.dataset.id);
      }
    }
    this.paintSelection();
  }

  drawLinks(previewId, previewEnd) {
    if (!this.board.clientWidth) return;
    const cards = new Map([...this.cards.children].map(card => [card.dataset.id, card]));
    const paths = [];
    const center = port => {
      const r = port.getBoundingClientRect();
      return this.worldPoint(r.left + r.width / 2, r.top + r.height / 2);
    };
    const wire = (from, to) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const bend = Math.max(35, Math.abs(to[0] - from[0]) * 0.45);
      path.setAttribute('d', `M ${from.join(' ')} C ${from[0] + bend} ${from[1]}, ${to[0] - bend} ${to[1]}, ${to.join(' ')}`);
      paths.push(path);
    };
    for (const node of this.nodes) {
      const card = cards.get(node.id);
      const out = card.querySelector('[data-output]');
      out?.classList.toggle('pending', node.id === this.pending);
      node.inputs.forEach((source, slot) => {
        const output = cards.get(source)?.querySelector('[data-output]');
        const input = card.querySelector(`[data-input="${slot}"]`);
        input.classList.toggle('linked', Boolean(output));
        if (output) wire(center(output), center(input));
      });
    }
    const preview = cards.get(previewId)?.querySelector('[data-output]');
    if (preview) wire(center(preview), previewEnd);
    this.svg.replaceChildren(...paths);
  }
}
