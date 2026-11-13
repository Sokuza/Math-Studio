import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { derivativeStencils, sampleSurfaceProperty } from './property_shading.js';

const ids = [
  'mesh-canvas', 'mesh-capture', 'mesh-frame', 'mesh-source', 'mesh-selection',
  'mesh-properties', 'mesh-position', 'mesh-curvature', 'mesh-marking', 'mesh-material',
  'mesh-mark-color', 'mesh-mark', 'mesh-unmark', 'mesh-base-color', 'mesh-roughness',
  'mesh-attribute-select', 'mesh-attribute', 'mesh-attribute-min', 'mesh-attribute-max', 'mesh-attribute-status'
];

export class MeshWorkspace {
  constructor(viewport, captureFrame) {
    this.viewport = viewport;
    this.captureFrame = captureFrame;
    this.ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    this.canvas = this.ui['mesh-canvas'];
    this.mode = 'vertex';
    this.selection = new Set();
    this.modes = [...document.querySelectorAll('[data-mesh-mode]')];
    this.fields = [...this.ui['mesh-position'].querySelectorAll('input')];
    this.modes.forEach(button => button.addEventListener('click', () => {
      this.mode = button.dataset.meshMode;
      if (this.verticesDisplay) this.verticesDisplay.visible = this.mode === 'vertex';
      for (const option of this.modes) {
        option.classList.toggle('active', option === button);
        option.setAttribute('aria-pressed', String(option === button));
      }
      this.select([]);
    }));
    this.ui['mesh-capture'].addEventListener('click', () => {
      if (this.data && !this.confirmReplace) {
        this.confirmReplace = true;
        this.status('再次点击以替换当前网格');
        return;
      }
      this.capture();
    });
    this.ui['mesh-frame'].addEventListener('click', () => this.frame());
    this.ui['mesh-position'].addEventListener('submit', event => {
      event.preventDefault();
      if (this.mode !== 'vertex' || this.selected === null) return;
      const point = this.fields.map(field => field.valueAsNumber);
      if (!point.every(value => Number.isFinite(Math.fround(value)))) return;
      this.data.positions.splice(this.selected * 3, 3, point[0], point[2], point[1]);
      this.confirmReplace = false;
      this.updateMesh();
      this.select([...this.selection]);
    });
    this.ui['mesh-attribute-select'].addEventListener('submit', event => {
      event.preventDefault();
      this.selectByAttribute();
    });
    this.ui['mesh-mark'].addEventListener('click', () => this.mark(this.ui['mesh-mark-color'].value));
    this.ui['mesh-unmark'].addEventListener('click', () => this.mark(null));
    for (const id of ['mesh-base-color', 'mesh-roughness']) {
      this.ui[id].addEventListener('input', () => {
        this.data.color = this.ui['mesh-base-color'].value;
        this.data.roughness = this.ui['mesh-roughness'].valueAsNumber;
        this.confirmReplace = false;
        this.material.roughness = this.data.roughness;
        this.paintFaces();
        this.refresh();
      });
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
    this.load();
  }

  initScene() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.canvas.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x53627a, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(4, 8, 3);
    this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    this.camera.position.set(8, 7, 10);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('change', () => this.refresh());
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    this.wireMaterial = new THREE.LineBasicMaterial({ color: 0x334157, transparent: true, opacity: 0.6 });
    this.ray = new THREE.Raycaster();
    this.bindSelection();
  }

  bindSelection() {
    const target = this.renderer.domElement;
    target.style.cursor = 'crosshair';
    const box = document.createElement('div');
    box.className = 'mesh-selection-box';
    box.hidden = true;
    this.canvas.append(box);
    let drag;
    const point = event => {
      const bounds = this.canvas.getBoundingClientRect();
      return [event.clientX - bounds.left - this.canvas.clientLeft,
        event.clientY - bounds.top - this.canvas.clientTop];
    };
    const bounds = (a, b) => ({
      left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]),
      top: Math.min(a[1], b[1]), bottom: Math.max(a[1], b[1])
    });
    target.addEventListener('pointerdown', event => {
      if (!this.mesh || event.button !== 0 || event.pointerType === 'touch' || drag) return;
      // Own the primary mouse gesture without passing it to OrbitControls.
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { pointerId: event.pointerId, start: point(event), additive: event.shiftKey };
      target.setPointerCapture(event.pointerId);
    }, true);
    target.addEventListener('pointermove', event => {
      if (event.pointerId !== drag?.pointerId) return;
      const end = point(event);
      if (box.hidden && Math.hypot(end[0] - drag.start[0], end[1] - drag.start[1]) < 5) return;
      const rect = bounds(drag.start, end);
      box.hidden = false;
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.right - rect.left}px`;
      box.style.height = `${rect.bottom - rect.top}px`;
    });
    const finish = event => {
      if (event.pointerId !== drag?.pointerId) return;
      const { start, additive } = drag;
      const wasBox = !box.hidden;
      box.hidden = true;
      drag = null;
      if (event.type !== 'pointerup' || !this.mesh) return;
      const end = point(event);
      if (wasBox || Math.hypot(end[0] - start[0], end[1] - start[1]) >= 5) {
        this.selectBox(bounds(start, end), additive || event.shiftKey);
      } else {
        this.pick(event, additive || event.shiftKey);
      }
    };
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
    target.addEventListener('lostpointercapture', finish);
  }

  show() {
    this.initScene();
    if (!this.data) this.capture();
    else if (!this.mesh) this.updateMesh(true);
    this.resize();
    if (this.mesh && !this.framed) this.frame();
  }

  capture() {
    this.confirmReplace = false;
    this.captureFrame();
    const geometry = this.viewport.plotMesh?.geometry;
    if (!geometry?.index) {
      this.status('当前函数没有可捕获的网格');
      return;
    }
    const surface = this.viewport.surfaceCache;
    this.load({
      positions: Array.from(geometry.attributes.position.array),
      indices: Array.from(geometry.index.array),
      grid: surface ? [surface.columns, surface.rows] : null,
      color: this.ui['mesh-base-color'].defaultValue,
      roughness: 0.65,
      marks: {}
    });
  }

  status(message) { this.ui['mesh-source'].textContent = message; }

  load(data) {
    this.confirmReplace = false;
    this.clearObjects();
    this.framed = false;
    this.data = null;
    const colorValid = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    if (Array.isArray(data?.positions) && data.positions.length <= 61000 && data.positions.length >= 9 &&
        data.positions.length % 3 === 0 && data.positions.every(value => Number.isFinite(Math.fround(value))) &&
        Array.isArray(data.indices) && data.indices.length <= 118000 && data.indices.length >= 3 &&
        data.indices.length % 3 === 0 && data.indices.every(index =>
          Number.isInteger(index) && index >= 0 && index < data.positions.length / 3)) {
      const grid = Array.isArray(data.grid) && data.grid.length === 2 &&
        data.grid.every(value => Number.isInteger(value) && value >= 2) &&
        (data.grid[0] + 1) * (data.grid[1] + 1) * 3 === data.positions.length ? [...data.grid] : null;
      const marks = Object.fromEntries(Object.entries(data.marks || {}).filter(([key, value]) =>
        /^(vertex|edge|face):\d+(,\d+)?$/.test(key) && colorValid(value)));
      this.data = {
        positions: [...data.positions], indices: [...data.indices], grid, marks,
        color: colorValid(data.color) ? data.color : '#667d9d',
        roughness: Number.isFinite(data.roughness) ? THREE.MathUtils.clamp(data.roughness, 0, 1) : 0.65
      };
      this.ui['mesh-base-color'].value = this.data.color;
      this.ui['mesh-roughness'].value = this.data.roughness;
      this.status('当前帧的独立网格');
      if (this.renderer) this.updateMesh(true);
    } else {
      this.ui['mesh-base-color'].value = this.ui['mesh-base-color'].defaultValue;
      this.status('');
    }
    this.curvatures = this.edgeIds = null;
    this.select([]);
  }

  serialize() { return this.data ? structuredClone(this.data) : null; }

  clearObjects() {
    for (const name of ['mesh', 'wire', 'selectionHighlight', 'markedEdges', 'markedVertices', 'verticesDisplay']) {
      const object = this[name];
      if (!object) continue;
      object.removeFromParent();
      object.geometry.dispose();
      if (name !== 'mesh' && name !== 'wire') object.material.dispose();
      this[name] = null;
    }
  }

  updateMesh(frame = false) {
    this.clearObjects();
    const { positions, indices, roughness } = this.data;
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setIndex(indices);
    indexed.computeVertexNormals();
    const geometry = indexed.toNonIndexed();
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(indices.length * 3), 3));
    this.material.roughness = roughness;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.wire = new THREE.LineSegments(new THREE.WireframeGeometry(indexed), this.wireMaterial);
    indexed.dispose();
    this.verticesDisplay = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
      new THREE.PointsMaterial({ color: 0xa4bad5, size: 2.7, sizeAttenuation: false })
    );
    this.verticesDisplay.visible = this.mode === 'vertex';
    this.scene.add(this.mesh, this.wire, this.verticesDisplay);
    this.curvatures = null;
    this.paintFaces();
    this.drawMarks();
    if (frame) this.frame();
    this.refresh();
  }

  paintFaces() {
    const { indices, marks, color } = this.data;
    const attr = this.mesh.geometry.getAttribute('color');
    const base = new THREE.Color(color), tint = new THREE.Color();
    for (let face = 0; face < indices.length / 3; face++) {
      const mark = marks[`face:${face}`];
      tint.copy(base);
      if (mark) tint.set(mark);
      for (let i = 0; i < 3; i++) attr.setXYZ(face * 3 + i, tint.r, tint.g, tint.b);
    }
    attr.needsUpdate = true;
  }

  vertices(type, value) {
    if (type === 'vertex') return [value];
    if (type === 'edge') return String(value).split(',').map(Number);
    return this.data.indices.slice(value * 3, value * 3 + 3);
  }

  point(index) { return new THREE.Vector3().fromArray(this.data.positions, index * 3); }

  drawMarks() {
    for (const name of ['markedEdges', 'markedVertices']) {
      const object = this[name];
      if (object) {
        object.removeFromParent();
        object.geometry.dispose();
        object.material.dispose();
      }
    }
    const buffers = { vertex: [[], []], edge: [[], []] };
    for (const [key, color] of Object.entries(this.data.marks)) {
      const [type, id] = key.split(':');
      if (type === 'face') continue;
      const vertices = this.vertices(type, type === 'vertex' ? Number(id) : id);
      if (vertices.length !== (type === 'edge' ? 2 : 1) ||
          !vertices.every(index => Number.isInteger(index) && index >= 0 && index * 3 < this.data.positions.length)) continue;
      const [coords, colors] = buffers[type];
      const tint = new THREE.Color(color);
      for (const index of vertices) {
        coords.push(...this.point(index));
        colors.push(tint.r, tint.g, tint.b);
      }
    }
    const geometry = ([positions, colors]) => {
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return result;
    };
    this.markedEdges = new THREE.LineSegments(geometry(buffers.edge), new THREE.LineBasicMaterial({ vertexColors: true }));
    this.markedVertices = new THREE.Points(geometry(buffers.vertex), new THREE.PointsMaterial({
      vertexColors: true, size: 7, sizeAttenuation: false
    }));
    this.scene.add(this.markedEdges, this.markedVertices);
  }

  mark(color) {
    if (!this.selection.size) return;
    this.confirmReplace = false;
    this.status('当前帧的独立网格');
    for (const value of this.selection) {
      const key = `${this.mode}:${value}`;
      if (color) this.data.marks[key] = color;
      else delete this.data.marks[key];
    }
    this.paintFaces();
    this.drawMarks();
    this.refresh();
  }

  edgeKey(a, b) { return a <= b ? `${a},${b}` : `${b},${a}`; }

  *elements() {
    const { positions, indices } = this.data;
    if (this.mode === 'edge') {
      if (!this.edgeIds) {
        this.edgeIds = new Set();
        for (let i = 0; i < indices.length; i += 3) {
          const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
          this.edgeIds.add(this.edgeKey(a, b)).add(this.edgeKey(b, c)).add(this.edgeKey(c, a));
        }
      }
      yield* this.edgeIds;
      return;
    }
    const count = this.mode === 'vertex' ? positions.length / 3 : indices.length / 3;
    for (let index = 0; index < count; index++) yield index;
  }

  center(vertices, target, scratch) {
    target.set(0, 0, 0);
    for (const index of vertices) target.add(scratch.fromArray(this.data.positions, index * 3));
    return target.divideScalar(vertices.length);
  }

  pick(event, additive) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2
    ), this.camera);
    const [hit] = this.ray.intersectObject(this.mesh);
    if (!hit) {
      if (!additive) this.select([]);
      return;
    }
    const indices = this.vertices('face', hit.faceIndex);
    let value = hit.faceIndex;
    if (this.mode === 'vertex') {
      value = indices.reduce((nearest, index) =>
        this.point(index).distanceToSquared(hit.point) < this.point(nearest).distanceToSquared(hit.point) ? index : nearest);
    } else if (this.mode === 'edge') {
      const sides = [[indices[0], indices[1]], [indices[1], indices[2]], [indices[2], indices[0]]];
      const distance = ([a, b]) => new THREE.Line3(this.point(a), this.point(b))
        .closestPointToPoint(hit.point, true, new THREE.Vector3()).distanceToSquared(hit.point);
      value = this.edgeKey(...sides.reduce((a, b) => distance(a) <= distance(b) ? a : b));
    }
    this.select([value], additive);
  }

  selectBox(rect, additive) {
    const width = this.renderer.domElement.clientWidth, height = this.renderer.domElement.clientHeight;
    const projected = new THREE.Vector3(), scratch = new THREE.Vector3();
    const selection = [];
    for (const value of this.elements()) {
      this.center(this.vertices(this.mode, value), projected, scratch).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x + 1) * width / 2;
      const y = (1 - projected.y) * height / 2;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) selection.push(value);
    }
    this.select(selection, additive);
  }

  selectByAttribute() {
    if (!this.data) return;
    const attribute = this.ui['mesh-attribute'].value;
    const min = this.ui['mesh-attribute-min'].valueAsNumber;
    const max = this.ui['mesh-attribute-max'].valueAsNumber;
    const low = Number.isNaN(min) ? -Infinity : min;
    const high = Number.isNaN(max) ? Infinity : max;
    const status = this.ui['mesh-attribute-status'];
    if (low > high) {
      status.textContent = '最小值不能大于最大值';
      return;
    }
    const curvature = attribute === 'curvature';
    if (curvature && !this.data.grid) {
      status.textContent = '当前网格没有可用的曲率';
      return;
    }
    const axis = { x: 'x', y: 'z', z: 'y' }[attribute];
    if (!curvature && !axis) return;
    const center = new THREE.Vector3(), scratch = new THREE.Vector3();
    const selection = [];
    for (const id of this.elements()) {
      const vertices = this.vertices(this.mode, id);
      const value = curvature ? this.curvature(vertices) : this.center(vertices, center, scratch)[axis];
      if (Number.isFinite(value) && value >= low && value <= high) selection.push(id);
    }
    this.select(selection);
    if (!selection.length) status.textContent = '没有符合条件的元素';
  }

  get selected() {
    return this.selection.size === 1 ? this.selection.values().next().value : null;
  }

  select(values, additive = false) {
    if (!additive) this.selection.clear();
    for (const value of values) this.selection.add(value);
    this.confirmReplace = false;
    if (this.data) this.status('当前帧的独立网格');
    const single = this.selected !== null;
    this.ui['mesh-properties'].hidden = !single;
    this.ui['mesh-position'].hidden = !single || this.mode !== 'vertex';
    this.ui['mesh-material'].disabled = !this.data;
    this.ui['mesh-marking'].disabled = !this.selection.size;
    this.ui['mesh-frame'].disabled = !this.data;
    this.ui['mesh-attribute-select'].hidden = !this.data;
    this.ui['mesh-attribute-status'].textContent = '';
    const label = this.ui['mesh-selection'];
    label.hidden = single;
    label.textContent = this.selection.size ? `已选中 ${this.selection.size} 项` : '选择顶点、边或面';
    if (single) this.inspect();
    this.highlight();
    this.refresh();
  }

  curvature(vertices) {
    if (!this.data.grid) return NaN;
    if (!this.curvatures) {
      const [columns, rows] = this.data.grid;
      const size = this.data.positions.length / 3;
      this.curvatures = new Float64Array(size);
      sampleSurfaceProperty({
        values: this.curvatures, samples: this.data.positions, valid: new Uint8Array(size).fill(1),
        columns, rows, uStencils: derivativeStencils(columns), vStencils: derivativeStencils(rows)
      }, 'gaussian');
    }
    let count = 0, sum = 0;
    for (const index of vertices) {
      const value = this.curvatures[index];
      if (!Number.isFinite(value)) continue;
      sum += value;
      count++;
    }
    return count ? sum / count : NaN;
  }

  inspect() {
    const vertices = this.vertices(this.mode, this.selected);
    const center = this.center(vertices, new THREE.Vector3(), new THREE.Vector3());
    const values = [center.x, center.z, center.y];
    values.forEach((value, index) => {
      document.getElementById(`mesh-${'xyz'[index]}`).textContent = value.toFixed(5);
      this.fields[index].value = Number(value.toPrecision(8));
    });
    const curvature = this.curvature(vertices);
    this.ui['mesh-curvature'].textContent = Number.isFinite(curvature) ? curvature.toPrecision(5) : '—';
  }

  highlight() {
    if (this.selectionHighlight) {
      this.selectionHighlight.removeFromParent();
      this.selectionHighlight.geometry.dispose();
      this.selectionHighlight.material.dispose();
      this.selectionHighlight = null;
    }
    if (!this.selection.size) return;
    const coords = [];
    for (const value of this.selection) {
      for (const index of this.vertices(this.mode, value)) {
        const offset = index * 3;
        coords.push(this.data.positions[offset], this.data.positions[offset + 1], this.data.positions[offset + 2]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const color = 0xff9e63;
    if (this.mode === 'vertex') {
      this.selectionHighlight = new THREE.Points(geometry, new THREE.PointsMaterial({
        color, size: 8, sizeAttenuation: false, depthTest: false
      }));
    } else if (this.mode === 'edge') {
      this.selectionHighlight = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
    } else {
      this.selectionHighlight = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true, opacity: 0.58, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      }));
    }
    this.selectionHighlight.renderOrder = 2;
    this.scene.add(this.selectionHighlight);
  }

  frame() {
    if (!this.mesh || !this.canvas.clientHeight) return;
    this.framed = true;
    const geometry = this.mesh.geometry;
    geometry.computeBoundingSphere();
    const { center, radius } = geometry.boundingSphere;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const fit = Math.max(radius, 0.5) * 1.18 / Math.min(1, this.camera.aspect);
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, fit / Math.sin(THREE.MathUtils.degToRad(21)));
    this.camera.far = Math.max(100, fit * 12);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resize() {
    if (!this.renderer || !this.canvas.clientWidth || !this.canvas.clientHeight) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.refresh();
  }

  refresh() {
    if (!this.renderer || !this.canvas.clientWidth) return;
    const light = document.documentElement.dataset.theme === 'light';
    this.scene.background ??= new THREE.Color();
    this.scene.background.setHex(light ? 0xf0f2f5 : 0x11161f);
    this.renderer.render(this.scene, this.camera);
  }
}
