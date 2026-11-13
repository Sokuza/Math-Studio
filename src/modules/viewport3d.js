/**
 * 3D Vector Viewport Module using Three.js (High-Performance Fluent Edition).
 * Handles real-time WebGL rendering with zero-allocation buffer reuse,
 * explicit surfaces, parametric curves/surfaces, vector fields, coordinate axes,
 * interactive raycasting inspection, calculus overlays (tangent planes, gradients, Riemann sum boxes),
 * and Fourier epicycles.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewportGuides } from './viewport_guides.js';
import { PropertyShading, derivativeStencils, sampleSurfaceProperty, sampleCurveProperty } from './property_shading.js';

export class Viewport3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060606);

    // Camera. Guard against zero-sized container to avoid NaN projection matrix
    const cw = Math.max(this.container.clientWidth || 1, 100);
    const ch = Math.max(this.container.clientHeight || 1, 100);
    this.camera = new THREE.PerspectiveCamera(45, cw / ch, 0.1, 1000);
    this.camera.position.set(12, 12, 14);
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(this.cameraTarget);

    // High performance WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(cw, ch);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 200;
    this.controls.minZoom = 0.25;
    this.controls.maxZoom = 2.5;
    this.controls.target.copy(this.cameraTarget);
    this.autoRotate = false;

    // Lighting
    this.setupLighting();

    this.guides = new ViewportGuides(this.scene);
    this.shading = new PropertyShading();
    this.renderHeight = ch;
    this.plotGroup = new THREE.Group();
    this.scene.add(this.plotGroup);
    this.geometryCounts = { points: 0, edges: 0, faces: 0 };
    this.surfaceCache = null;
    this.plotMesh = null;
    this.wire = null;
    this.heatmapMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      toneMapped: false
    });
    this.solidMaterial = new THREE.MeshStandardMaterial({
      color: 0xaeb5c0,
      side: THREE.DoubleSide,
      roughness: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    this.wireMaterial = new THREE.LineBasicMaterial({
      color: 0xe2e6eb,
      transparent: true,
      depthWrite: false
    });

    // Calculus Visualizations Group (Tangent plane, Gradient arrows, Integral volume)
    this.calculusGroup = new THREE.Group();
    this.scene.add(this.calculusGroup);

    // Epicycles Group
    this.epicycleGroup = new THREE.Group();
    this.scene.add(this.epicycleGroup);

    // Rendering Options
    this.options = {
      showTangentPlane: false,
      showGradientField: false,
      showIntegralVolume: false,
      tangentPoint: { x: 1.0, y: 1.0 },
      isOrthographic: false
    };

    this.setProjection('orthographic');

    // Raycaster for surface picking and inspection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.onCursorPlaced = null;
    this.onSurfacePicked = null; // callback(x, y, z)
    this.bindRaycaster();

    // Resize Observer
    window.addEventListener('resize', () => this.onWindowResize());
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.onWindowResize()).observe(this.container);
    }

    // Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(20, 40, 20);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0078d4, 0.4);
    dirLight2.position.set(-20, -20, -20);
    this.scene.add(dirLight2);
  }

  bindRaycaster() {
    let downX = 0, downY = 0;
    this.container.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });

    this.container.addEventListener('pointerup', (e) => {
      // Only treat as pick if mouse barely moved (click, not orbit drag)
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;

      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const placeCursor = e.button === 2 && e.shiftKey;
      if (!placeCursor && e.button !== 0) return;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hit = this.plotGroup.visible
        ? this.raycaster.intersectObject(this.plotMesh || this.plotGroup, true)[0]
        : null;
      if (placeCursor) {
        this.guides.update(this.camera, this.renderHeight);
        const point = hit?.point || this.raycaster.ray.intersectPlane(this.guides.plane, new THREE.Vector3());
        if (point) {
          this.guides.setCursorPosition([point.x, point.z, point.y]);
          this.onCursorPlaced?.();
        }
      } else if (hit) {
        this.onSurfacePicked?.(hit.point.x, hit.point.z, hit.point.y);
      }
    });
  }

  onWindowResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.resizeRenderer(width, height);
  }

  resizeRenderer(width, height, updateStyle = true) {
    const aspect = width / height;
    if (this.camera.isOrthographicCamera) {
      this.camera.left = -this.camera.top * aspect;
      this.camera.right = this.camera.top * aspect;
    } else {
      this.camera.aspect = aspect;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, updateStyle);
    this.renderHeight = height;
    this.guides.update(this.camera, height);
  }

  bindViewGizmo(element) {
    const rotation = new THREE.Quaternion();
    const axes = [...element.querySelectorAll('[data-axis]')].map(button => {
      const axis = new THREE.Vector3(...button.dataset.axis.split(',').map(Number));
      const direction = axis.clone();
      const line = document.createElement('span');
      line.className = 'gizmo-line';
      element.prepend(line);
      button.addEventListener('click', () => this.resetCamera(button.dataset.cameraView));
      return { button, line, axis, direction };
    });
    const update = () => {
      rotation.copy(this.camera.quaternion).invert();
      for (const { button, line, axis, direction } of axes) {
        direction.copy(axis).applyQuaternion(rotation);
        const x = direction.x * 25;
        const y = -direction.y * 25;
        button.style.transform = `translate(${x}px, ${y}px)`;
        button.style.zIndex = direction.z < 0 ? '1' : '2';
        button.style.opacity = direction.z < -0.05 ? '0.65' : '1';
        line.style.width = `${Math.hypot(x, y)}px`;
        line.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
      }
    };
    this.controls.addEventListener('change', update);
    update();
  }

  setZoom(zoom) {
    this.camera.zoom = THREE.MathUtils.clamp(zoom, this.controls.minZoom, this.controls.maxZoom);
    this.camera.updateProjectionMatrix();
  }

  setGridCounts(columns, rows) {
    this.geometryCounts = {
      points: (columns + 1) * (rows + 1),
      edges: 3 * columns * rows + columns + rows,
      faces: 2 * columns * rows
    };
  }

  // --- Camera Control System ---
  getCameraState() {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
      fov: this.camera.isPerspectiveCamera ? this.camera.fov : 45,
      projection: this.options.isOrthographic ? 'orthographic' : 'perspective',
      autoRotate: this.autoRotate
    };
  }

  setCameraPosition(x, y, z) {
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  setCameraTarget(x, y, z) {
    this.controls.target.set(x, y, z);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  setFov(fov) {
    const clamped = Math.max(5, Math.min(120, fov));
    if (this.camera.isPerspectiveCamera) {
      this.camera.fov = clamped;
      this.camera.updateProjectionMatrix();
    }
  }

  setProjection(mode) {
    const isOrtho = mode === 'orthographic';
    if (isOrtho === this.options.isOrthographic) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const aspect = width / height;
    const position = this.camera.position.clone();
    const target = this.controls.target.clone();

    let newCamera;
    if (isOrtho) {
      const extent = 12;
      newCamera = new THREE.OrthographicCamera(
        -extent * aspect, extent * aspect, extent, -extent, 0.1, 500
      );
    } else {
      newCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    }
    newCamera.position.copy(position);
    newCamera.zoom = this.camera.zoom;
    newCamera.updateProjectionMatrix();
    this.camera = newCamera;
    this.camera.lookAt(target);
    this.options.isOrthographic = isOrtho;
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();
  }

  setAutoRotate(enabled) {
    this.autoRotate = !!enabled;
    this.controls.autoRotate = !!enabled;
    this.controls.autoRotateSpeed = 1.5;
  }

  frameAll() {
    const box = new THREE.Box3();
    let found = false;
    this.plotGroup.traverse((obj) => {
      if (obj.isMesh || obj.isLine || obj.isLineSegments) {
        if (obj.geometry) {
          if (obj === this.wire) return;
          box.expandByObject(obj, true);
          found = true;
        }
      }
    });
    if (!found) {
      this.resetCamera('iso');
      return;
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(sphere.radius, 0.001);
    const fov = (this.camera.fov || 45) * (Math.PI / 180);
    const dist = radius / Math.sin(fov / 2) * 1.35;
    if (this.camera.isOrthographicCamera) {
      const halfSpan = Math.min(this.camera.top, this.camera.right);
      this.setZoom(halfSpan / (radius * 1.35));
    }
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    this.camera.lookAt(center);
    this.controls.update();
  }

  getSurface(type, columns, rows) {
    const previous = this.surfaceCache;
    if (previous?.type === type && previous.columns === columns && previous.rows === rows) return previous;
    this.clearPlot();
    const count = (columns + 1) * (rows + 1);
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    const color = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    geometry.setAttribute('position', position.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', color.setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const a = row * (columns + 1) + col;
        const c = a + columns + 1;
        indices.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    geometry.setIndex(indices);
    this.setGridCounts(columns, rows);
    this.addPlotMesh(geometry);
    this.surfaceCache = {
      type, columns, rows, geometry, position, color,
      samples: new Float64Array(count * 3),
      valid: new Uint8Array(count),
      values: new Float64Array(count),
      uStencils: derivativeStencils(columns),
      vStencils: derivativeStencils(rows)
    };
    return this.surfaceCache;
  }

  addPlotMesh(geometry) {
    this.plotMesh = new THREE.Mesh(geometry, this.heatmapMaterial);
    this.plotGroup.add(this.plotMesh);
    this.syncWireframe();
  }

  syncWireframe() {
    if (!this.plotMesh) return;
    const { enabled, wireMode, wireOpacity } = this.guides.settings;
    const only = wireMode === 'only';
    const showWire = only || (wireMode === 'overlay' && enabled);
    this.plotMesh.visible = !only;
    if (showWire && !this.wire) {
      const source = this.plotMesh.geometry;
      const indices = source.index.array;
      const vertexCount = source.attributes.position.count;
      const edges = new Set();
      const lineIndices = [];
      for (let i = 0; i < indices.length; i += 3) {
        for (let j = 0; j < 3; j++) {
          const a = indices[i + j];
          const b = indices[i + (j + 1) % 3];
          const edge = Math.min(a, b) * vertexCount + Math.max(a, b);
          if (edges.has(edge)) continue;
          edges.add(edge);
          lineIndices.push(a, b);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', source.attributes.position);
      geometry.setIndex(lineIndices);
      this.wire = new THREE.LineSegments(geometry, this.wireMaterial);
      this.wire.frustumCulled = false;
      this.wire.renderOrder = 3;
      this.plotGroup.add(this.wire);
    }
    if (this.wire) this.wire.visible = showWire;
    this.wireMaterial.opacity = only ? 1 : wireOpacity;
  }

  finishSurface(cache, metric) {
    const { geometry, samples, position, values, color } = cache;
    position.array.set(samples);
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
    this.plotMesh.material = metric === 'solid' ? this.solidMaterial : this.heatmapMaterial;
    if (metric === 'solid') {
      geometry.computeVertexNormals();
    } else {
      sampleSurfaceProperty(cache, metric);
      this.shading.paint(values, color);
    }
  }

  plotExplicitSurface(fn, xRange, yRange, columns, rows, metric) {
    const cache = this.getSurface('explicit', columns, rows);
    const dx = (xRange[1] - xRange[0]) / columns;
    const dy = (yRange[1] - yRange[0]) / rows;
    let index = 0;
    for (let row = 0; row <= rows; row++) {
      const y = yRange[0] + row * dy;
      for (let col = 0; col <= columns; col++, index++) {
        const x = xRange[0] + col * dx;
        let z = NaN;
        try { z = fn(x, y); } catch {}
        const finite = Number.isFinite(Math.fround(z));
        cache.valid[index] = finite ? 1 : 0;
        cache.samples[index * 3] = x;
        cache.samples[index * 3 + 1] = finite ? z : 0;
        cache.samples[index * 3 + 2] = y;
      }
    }
    this.finishSurface(cache, metric);
  }

  plotParametricSurface(fn, uRange, vRange, columns, rows, metric) {
    const cache = this.getSurface('parametric_surface', columns, rows);
    const du = (uRange[1] - uRange[0]) / columns;
    const dv = (vRange[1] - vRange[0]) / rows;
    let index = 0;
    for (let row = 0; row <= rows; row++) {
      const v = vRange[0] + row * dv;
      for (let col = 0; col <= columns; col++, index++) {
        let point;
        try { point = fn(uRange[0] + col * du, v); } catch {}
        const valid = point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
        cache.valid[index] = valid ? 1 : 0;
        cache.samples[index * 3] = valid ? point.x : 0;
        cache.samples[index * 3 + 1] = valid ? point.z : 0;
        cache.samples[index * 3 + 2] = valid ? point.y : 0;
      }
    }
    this.finishSurface(cache, metric);
  }

  plotParametricCurve(fn, uRange, segments, metric) {
    this.clearPlot();
    const points = [];
    const du = (uRange[1] - uRange[0]) / segments;
    for (let i = 0; i <= segments; i++) {
      let point;
      try { point = fn(uRange[0] + i * du); } catch {}
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
        points.push(new THREE.Vector3(point.x, point.z, point.y));
      }
    }
    if (points.length < 2) {
      this.shading.measure([]);
      return;
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const radialSegments = 10;
    const geometry = new THREE.TubeGeometry(curve, segments, 0.08, radialSegments, false);
    this.setGridCounts(segments, radialSegments);
    this.addPlotMesh(geometry);
    if (metric === 'solid') {
      this.plotMesh.material = this.solidMaterial;
    } else {
      const values = sampleCurveProperty(curve, segments, metric);
      const color = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3);
      this.shading.paint(values, color, radialSegments + 1);
      geometry.setAttribute('color', color);
    }
    this.addFrenetFrame(curve, 0.5);
  }

  addFrenetFrame(curve, tVal = 0.5) {
    try {
      const pt = curve.getPointAt(tVal);
      const tangent = curve.getTangentAt(tVal).normalize();
      const normal = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      const frameGroup = new THREE.Group();
      frameGroup.position.copy(pt);

      frameGroup.add(new THREE.ArrowHelper(tangent, new THREE.Vector3(0,0,0), 1.5, 0xff0055, 0.4, 0.15));
      frameGroup.add(new THREE.ArrowHelper(normal, new THREE.Vector3(0,0,0), 1.5, 0x00ff88, 0.4, 0.15));
      frameGroup.add(new THREE.ArrowHelper(binormal, new THREE.Vector3(0,0,0), 1.5, 0x00c6ff, 0.4, 0.15));

      this.plotGroup.add(frameGroup);
    } catch (e) {}
  }

  plotVectorField(fn, bound, step, metric) {
    this.clearPlot();
    const samples = [];
    for (let x = -bound; x <= bound; x += step) {
      for (let y = -bound; y <= bound; y += step) {
        for (let z = -bound; z <= bound; z += step) {
          let vector;
          try { vector = fn(x, y, z); } catch { continue; }
          const direction = new THREE.Vector3(vector.u, vector.w, vector.v);
          const length = direction.length();
          if (!Number.isFinite(length) || length <= 0.001) continue;
          samples.push({
            origin: new THREE.Vector3(x, z, y),
            direction: direction.divideScalar(length),
            arrowLength: Math.min(step * 0.85, length * 0.6),
            value: metric === 'height' ? z : length
          });
        }
      }
    }

    this.shading.measure(samples.map(sample => sample.value));
    for (const { origin, direction, arrowLength, value } of samples) {
      const color = metric === 'solid' ? this.shading.solidColor : this.shading.colorFor(value);
      const arrow = new THREE.ArrowHelper(direction, origin, arrowLength, color, arrowLength * 0.25, arrowLength * 0.12);
      this.plotGroup.add(arrow);
    }
    this.geometryCounts = { points: samples.length * 2, edges: samples.length, faces: 0 };
  }

  // --- Calculus Visualizations: Tangent Plane & Gradient Vector ---
  updateCalculusOverlays(fn, fx, fy, x0 = 1.0, y0 = 1.0, showPlane = true, showGrad = true) {
    while (this.calculusGroup.children.length > 0) {
      const obj = this.calculusGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.calculusGroup.remove(obj);
    }

    if (!showPlane && !showGrad) return;

    let z0 = 0, dz_dx = 0, dz_dy = 0;
    try {
      z0 = fn(x0, y0);
      dz_dx = fx(x0, y0);
      dz_dy = fy(x0, y0);
      if (!isFinite(z0)) z0 = 0;
      if (!isFinite(dz_dx)) dz_dx = 0;
      if (!isFinite(dz_dy)) dz_dy = 0;
    } catch (e) {
      return;
    }

    // 1. Tangent Plane: z - z0 = dz_dx*(x - x0) + dz_dy*(y - y0)
    if (showPlane) {
      const planeSize = 2.8;
      const planeGeo = new THREE.PlaneGeometry(planeSize * 2, planeSize * 2, 6, 6);
      const planeMat = new THREE.MeshStandardMaterial({
        color: 0x00c6ff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);

      // Normal in 3D: (X: -dz_dx, Y: 1, Z: -dz_dy)
      const normal = new THREE.Vector3(-dz_dx, 1, -dz_dy).normalize();
      planeMesh.position.set(x0, z0, y0);
      planeMesh.lookAt(new THREE.Vector3(x0, z0, y0).add(normal));
      this.calculusGroup.add(planeMesh);

      // Red Sphere indicator at tangent contact point
      const pointGeo = new THREE.SphereGeometry(0.14, 16, 16);
      const pointMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
      const pointMesh = new THREE.Mesh(pointGeo, pointMat);
      pointMesh.position.set(x0, z0, y0);
      this.calculusGroup.add(pointMesh);
    }

    // 2. Gradient Vector: (dz_dx, dz_dy) in horizontal plane
    if (showGrad) {
      const gradLen = Math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy);
      if (gradLen > 0.001) {
        const gradDir = new THREE.Vector3(dz_dx / gradLen, 0, dz_dy / gradLen);
        const gradArrow = new THREE.ArrowHelper(
          gradDir,
          new THREE.Vector3(x0, z0 + 0.05, y0),
          Math.min(3.5, gradLen * 1.2),
          0xffbb00,
          0.35,
          0.14
        );
        this.calculusGroup.add(gradArrow);
      }
    }
  }

  // --- Real 3D Riemann Sum Prisms Visualization ---
  renderRiemannSum(fn, xRange = [-3, 3], yRange = [-3, 3], nx = 8, ny = 8) {
    while (this.calculusGroup.children.length > 0) {
      const obj = this.calculusGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.calculusGroup.remove(obj);
    }

    const dx = (xRange[1] - xRange[0]) / nx;
    const dy = (yRange[1] - yRange[0]) / ny;

    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x00c6ff,
      transparent: true,
      opacity: 0.45,
      roughness: 0.4
    });

    for (let i = 0; i < nx; i++) {
      const x = xRange[0] + (i + 0.5) * dx;
      for (let j = 0; j < ny; j++) {
        const y = yRange[0] + (j + 0.5) * dy;
        let h = 0;
        try {
          h = fn(x, y);
          if (!isFinite(h)) h = 0;
        } catch (e) {
          h = 0;
        }

        if (Math.abs(h) > 0.05) {
          const height = Math.abs(h);
          const geo = new THREE.BoxGeometry(dx * 0.9, height, dy * 0.9);
          const prism = new THREE.Mesh(geo, boxMat);
          prism.position.set(x, h >= 0 ? height / 2 : -height / 2, y);
          this.calculusGroup.add(prism);
        }
      }
    }
  }

  // --- Fourier Epicycles Visualizer ---
  renderFourierEpicycles(harmonics, tVal, scale = 1.0) {
    while (this.epicycleGroup.children.length > 0) {
      this.epicycleGroup.remove(this.epicycleGroup.children[0]);
    }

    let curX = 0, curY = 0, curZ = 0;

    for (let k = 0; k < harmonics.length; k++) {
      const h = harmonics[k];
      const radius = h.amp * scale;
      const angle = h.freq * tVal + (h.phase || 0);

      const circleGeo = new THREE.BufferGeometry();
      const circlePts = [];
      const numSegs = 36;
      for (let s = 0; s <= numSegs; s++) {
        const th = (s / numSegs) * Math.PI * 2;
        circlePts.push(curX + radius * Math.cos(th), curY + radius * Math.sin(th), curZ);
      }
      circleGeo.setAttribute('position', new THREE.Float32BufferAttribute(circlePts, 3));
      const circleMat = new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.6 });
      const circleLine = new THREE.Line(circleGeo, circleMat);
      this.epicycleGroup.add(circleLine);

      const nextX = curX + radius * Math.cos(angle);
      const nextY = curY + radius * Math.sin(angle);
      const armDir = new THREE.Vector3(nextX - curX, nextY - curY, 0).normalize();
      const armArrow = new THREE.ArrowHelper(armDir, new THREE.Vector3(curX, curY, curZ), radius, 0x00c6ff, radius * 0.25, radius * 0.1);
      this.epicycleGroup.add(armArrow);

      curX = nextX;
      curY = nextY;
    }
  }

  clearPlot() {
    this.geometryCounts = { points: 0, edges: 0, faces: 0 };
    this.wire?.geometry.dispose();
    this.plotMesh?.geometry.dispose();
    this.plotGroup.traverse(object => {
      // Arrow helpers share geometry and own their individual materials.
      if (object.type === 'ArrowHelper') {
        object.line.material.dispose();
        object.cone.material.dispose();
      }
    });
    this.plotGroup.clear();
    this.surfaceCache = null;
    this.plotMesh = null;
    this.wire = null;
  }

  resetCamera(viewMode = 'iso') {
    const d = 24;
    if (viewMode === 'top') {
      this.camera.position.set(0, d, 0.001);
    } else if (viewMode === 'bottom') {
      this.camera.position.set(0, -d, 0.001);
    } else if (viewMode === 'front') {
      this.camera.position.set(0, 0, d);
    } else if (viewMode === 'back') {
      this.camera.position.set(0, 0, -d);
    } else if (viewMode === 'left') {
      this.camera.position.set(-d, 0, 0.001);
    } else if (viewMode === 'right') {
      this.camera.position.set(d, 0, 0.001);
    } else {
      // Isometric
      this.camera.position.set(12, 12, 14);
    }
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  configureGuides(settings) {
    this.guides.configure(settings);
    this.syncWireframe();
  }

  setGuideTheme(light) {
    this.guides.setLightTheme(light);
    this.wireMaterial.color.setHex(light ? 0x30353b : 0xe2e6eb);
  }

  animate() {
    requestAnimationFrame(this.animate);
    if (!this.container || this.container.clientWidth === 0 || this.container.clientHeight === 0) {
      return;
    }
    this.controls.update();
    this.guides.update(this.camera, this.renderHeight);
    this.renderer.render(this.scene, this.camera);
  }
}
