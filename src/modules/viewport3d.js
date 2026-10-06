/**
 * 3D Vector Viewport Module using Three.js.
 * Handles interactive 3D rendering, explicit surfaces, parametric curves/surfaces,
 * vector fields, coordinate axes, calculus overlays (tangent planes, gradients), and Fourier epicycles.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Viewport3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x181818);

    // Camera. Guard against a zero-sized (hidden) container which would otherwise
    // produce a NaN aspect ratio and break the initial projection matrix.
    const cw = this.container.clientWidth || 1;
    const ch = this.container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(45, cw / ch, 0.1, 1000);
    this.camera.position.set(12, 12, 14);
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(this.cameraTarget);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(cw, ch);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.controls.target.copy(this.cameraTarget);
    this.autoRotate = false;

    // Lighting
    this.setupLighting();

    // Coordinate System & Helpers
    this.axisGroup = new THREE.Group();
    this.gridHelper = null;
    this.setupCoordinateSystem();

    // Plot Objects Group
    this.plotGroup = new THREE.Group();
    this.scene.add(this.plotGroup);

    // Calculus Visualizations Group (Tangent plane, Gradient arrows, Integral volume)
    this.calculusGroup = new THREE.Group();
    this.scene.add(this.calculusGroup);

    // Epicycles Group
    this.epicycleGroup = new THREE.Group();
    this.scene.add(this.epicycleGroup);

    // Rendering Options
    this.options = {
      wireframe: false,
      colorMap: 'coolwarm', // 'viridis', 'plasma', 'coolwarm', 'rainbow', 'neon'
      showAxes: true,
      showGrid: true,
      showTangentPlane: false,
      showGradientField: false,
      showIntegralVolume: false,
      tangentPoint: { x: 0, y: 0 },
      isOrthographic: false
    };

    // Resize Observer
    window.addEventListener('resize', () => this.onWindowResize());
    new ResizeObserver(() => this.onWindowResize()).observe(this.container);

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

  setupCoordinateSystem() {
    this.scene.remove(this.axisGroup);
    this.axisGroup = new THREE.Group();

    // Ground Grid
    this.gridHelper = new THREE.GridHelper(20, 20, 0x0078d4, 0x333333);
    this.gridHelper.position.y = 0;
    this.axisGroup.add(this.gridHelper);

    // 3D Vector Axes (X = Red, Y = Green, Z = Blue)
    const axisLen = 10;
    const arrowRadius = 0.2;
    const arrowHeadLen = 0.8;

    // X Axis (Red)
    const xDir = new THREE.Vector3(1, 0, 0);
    const xArrow = new THREE.ArrowHelper(xDir, new THREE.Vector3(0, 0, 0), axisLen, 0xff4d4d, arrowHeadLen, arrowRadius);
    this.axisGroup.add(xArrow);

    // Y Axis (Green / Height in Three.js or standard math Z. In math space we can map Y as vertical)
    const yDir = new THREE.Vector3(0, 1, 0);
    const yArrow = new THREE.ArrowHelper(yDir, new THREE.Vector3(0, 0, 0), axisLen, 0x4dff4d, arrowHeadLen, arrowRadius);
    this.axisGroup.add(yArrow);

    // Z Axis (Blue)
    const zDir = new THREE.Vector3(0, 0, 1);
    const zArrow = new THREE.ArrowHelper(zDir, new THREE.Vector3(0, 0, 0), axisLen, 0x4da6ff, arrowHeadLen, arrowRadius);
    this.axisGroup.add(zArrow);

    this.scene.add(this.axisGroup);
  }

  onWindowResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
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
      const extent = 16;
      newCamera = new THREE.OrthographicCamera(
        -extent * aspect, extent * aspect, extent, -extent, 0.1, 500
      );
    } else {
      newCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    }
    newCamera.position.copy(position);
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
    // Compute a bounding sphere for all visible scene content, then fit the camera to it.
    const box = new THREE.Box3();
    const target = this.controls.target;
    let found = false;
    this.scene.traverse((obj) => {
      if (obj.isMesh || obj.isLine || obj.isLineSegments || obj.isPoints) {
        if (obj.geometry) {
          if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
          box.expandByObject(obj);
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
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = radius / Math.sin(fov / 2) * 1.3;
    const dir = this.camera.position.clone().sub(target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    this.camera.lookAt(center);
    this.controls.update();
  }

  // --- Colormap Helper ---
  getColor(t, mapName = 'coolwarm') {
    // t normalized in [0, 1]
    const clampedT = Math.max(0, Math.min(1, t));
    const color = new THREE.Color();

    if (mapName === 'coolwarm') {
      // Blue (0) -> White (0.5) -> Red (1)
      if (clampedT < 0.5) {
        const s = clampedT * 2;
        color.setRGB(0.2 + 0.8 * s, 0.4 + 0.6 * s, 1.0);
      } else {
        const s = (clampedT - 0.5) * 2;
        color.setRGB(1.0, 1.0 - 0.6 * s, 1.0 - 0.8 * s);
      }
    } else if (mapName === 'viridis') {
      // Purple -> Teal -> Yellow
      color.setHSL(0.75 - clampedT * 0.6, 0.9, 0.2 + clampedT * 0.6);
    } else if (mapName === 'plasma') {
      // Dark Blue -> Pink -> Orange -> Yellow
      color.setHSL(0.8 - clampedT * 0.7, 1.0, 0.2 + clampedT * 0.6);
    } else if (mapName === 'neon') {
      // Cyan to Magenta
      color.setRGB(clampedT, 1.0 - clampedT, 1.0);
    } else {
      // Rainbow
      color.setHSL((1 - clampedT) * 0.7, 1.0, 0.5);
    }
    return color;
  }

  // --- Explicit 3D Surface Rendering: z = f(x, y) ---
  plotExplicitSurface(fn, xRange = [-5, 5], yRange = [-5, 5], segX = 70, segY = 70) {
    this.clearPlot();

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const indices = [];

    const dx = (xRange[1] - xRange[0]) / segX;
    const dy = (yRange[1] - yRange[0]) / segY;

    // Track min/max z for normalization
    let minZ = Infinity;
    let maxZ = -Infinity;
    const zValues = [];

    for (let j = 0; j <= segY; j++) {
      const y = yRange[0] + j * dy;
      for (let i = 0; i <= segX; i++) {
        const x = xRange[0] + i * dx;
        let z = 0;
        try {
          z = fn(x, y);
          if (isNaN(z) || !isFinite(z)) z = 0;
        } catch (e) {
          z = 0;
        }
        // In 3D space: Math x -> 3D X, Math y -> 3D Z, Math z -> 3D Y (elevation)
        positions.push(x, z, y);
        zValues.push(z);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }

    const zSpan = (maxZ - minZ) || 1;
    for (let k = 0; k < zValues.length; k++) {
      const normZ = (zValues[k] - minZ) / zSpan;
      const col = this.getColor(normZ, this.options.colorMap);
      colors.push(col.r, col.g, col.b);
    }

    // Indices for grid quads
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * (segX + 1) + i;
        const b = a + 1;
        const c = a + (segX + 1);
        const d = c + 1;
        // Two triangles
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      wireframe: this.options.wireframe,
      roughness: 0.35,
      metalness: 0.15
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.plotGroup.add(mesh);

    // Optional vector wireframe overlay
    if (!this.options.wireframe) {
      const wireGeo = new THREE.WireframeGeometry(geometry);
      const wireMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08
      });
      const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
      this.plotGroup.add(wireMesh);
    }
  }

  // --- 3D Space Curve Rendering: (x(u), y(u), z(u)) ---
  plotParametricCurve(fn, uRange = [0, 20], samples = 400) {
    this.clearPlot();

    const points = [];
    const colors = [];
    const du = (uRange[1] - uRange[0]) / samples;

    for (let i = 0; i <= samples; i++) {
      const u = uRange[0] + i * du;
      try {
        const pt = fn(u);
        const px = isFinite(pt.x) ? pt.x : 0;
        const py = isFinite(pt.y) ? pt.y : 0;
        const pz = isFinite(pt.z) ? pt.z : 0;
        // Map: x -> X, z -> Y (elevation), y -> Z
        points.push(new THREE.Vector3(px, pz, py));
        const col = this.getColor(i / samples, this.options.colorMap);
        colors.push(col.r, col.g, col.b);
      } catch (e) {}
    }

    if (points.length < 2) return;

    // Tube Geometry for vector 3D look
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, samples, 0.08, 12, false);
    
    // Assign vertex colors to tube
    const tubeColors = [];
    const count = tubeGeo.attributes.position.count;
    for (let k = 0; k < count; k++) {
      const uRatio = k / count;
      const col = this.getColor(uRatio, this.options.colorMap);
      tubeColors.push(col.r, col.g, col.b);
    }
    tubeGeo.setAttribute('color', new THREE.Float32BufferAttribute(tubeColors, 3));

    const tubeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.2,
      metalness: 0.3
    });

    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    this.plotGroup.add(tubeMesh);

    // Frenet Frame on dynamic point (moving tangent/normal frame)
    this.addFrenetFrame(curve, 0.5);
  }

  addFrenetFrame(curve, tVal = 0.5) {
    const pt = curve.getPointAt(tVal);
    const tangent = curve.getTangentAt(tVal).normalize();
    
    // Frenet Normal
    const normal = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    const frameGroup = new THREE.Group();
    frameGroup.position.copy(pt);

    // Tangent (Red)
    frameGroup.add(new THREE.ArrowHelper(tangent, new THREE.Vector3(0,0,0), 1.5, 0xff0055, 0.4, 0.15));
    // Normal (Green)
    frameGroup.add(new THREE.ArrowHelper(normal, new THREE.Vector3(0,0,0), 1.5, 0x00ff88, 0.4, 0.15));
    // Binormal (Blue)
    frameGroup.add(new THREE.ArrowHelper(binormal, new THREE.Vector3(0,0,0), 1.5, 0x00c6ff, 0.4, 0.15));

    this.plotGroup.add(frameGroup);
  }

  // --- 3D Parametric Surface: (x(u,v), y(u,v), z(u,v)) ---
  plotParametricSurface(fn, uRange = [0, 6.28], vRange = [0, 6.28], segU = 50, segV = 50) {
    this.clearPlot();

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const indices = [];

    const du = (uRange[1] - uRange[0]) / segU;
    const dv = (vRange[1] - vRange[0]) / segV;

    let minZ = Infinity, maxZ = -Infinity;
    const rawPoints = [];

    for (let j = 0; j <= segV; j++) {
      const v = vRange[0] + j * dv;
      for (let i = 0; i <= segU; i++) {
        const u = uRange[0] + i * du;
        try {
          const pt = fn(u, v);
          const px = isFinite(pt.x) ? pt.x : 0;
          const py = isFinite(pt.y) ? pt.y : 0;
          const pz = isFinite(pt.z) ? pt.z : 0;
          positions.push(px, pz, py);
          rawPoints.push({ x: px, y: py, z: pz });
          if (pz < minZ) minZ = pz;
          if (pz > maxZ) maxZ = pz;
        } catch (e) {
          positions.push(0, 0, 0);
          rawPoints.push({ x: 0, y: 0, z: 0 });
        }
      }
    }

    const span = (maxZ - minZ) || 1;
    for (let k = 0; k < rawPoints.length; k++) {
      const norm = (rawPoints[k].z - minZ) / span;
      const col = this.getColor(norm, this.options.colorMap);
      colors.push(col.r, col.g, col.b);
    }

    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = j * (segU + 1) + i;
        const b = a + 1;
        const c = a + (segU + 1);
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      wireframe: this.options.wireframe,
      roughness: 0.3,
      metalness: 0.2
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.plotGroup.add(mesh);
  }

  // --- 3D Vector Field: F(x,y,z) = (u,v,w) ---
  plotVectorField(fn, bound = 4, step = 1.8) {
    this.clearPlot();

    for (let x = -bound; x <= bound; x += step) {
      for (let y = -bound; y <= bound; y += step) {
        for (let z = -bound; z <= bound; z += step) {
          try {
            const vec = fn(x, y, z);
            const dir = new THREE.Vector3(vec.u, vec.w, vec.v);
            const len = dir.length();
            if (len > 0.001) {
              dir.normalize();
              const arrowLen = Math.min(step * 0.85, len * 0.6);
              const col = this.getColor(Math.min(1, len / 5), this.options.colorMap);
              const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(x, z, y), arrowLen, col.getHex(), arrowLen * 0.25, arrowLen * 0.12);
              this.plotGroup.add(arrow);
            }
          } catch (e) {}
        }
      }
    }
  }

  // --- Calculus Visualizations: Tangent Plane & Gradient Vector ---
  updateCalculusOverlays(fn, fx, fy, x0 = 0, y0 = 0, showPlane = true, showGrad = true) {
    while (this.calculusGroup.children.length > 0) {
      this.calculusGroup.remove(this.calculusGroup.children[0]);
    }

    if (!showPlane && !showGrad) return;

    let z0 = 0, dz_dx = 0, dz_dy = 0;
    try {
      z0 = fn(x0, y0);
      dz_dx = fx(x0, y0);
      dz_dy = fy(x0, y0);
    } catch (e) {
      return;
    }

    // 1. Tangent Plane: z - z0 = dz_dx*(x - x0) + dz_dy*(y - y0)
    if (showPlane) {
      const planeSize = 2.5;
      const planeGeo = new THREE.PlaneGeometry(planeSize * 2, planeSize * 2, 4, 4);
      const planeMat = new THREE.MeshStandardMaterial({
        color: 0x00c6ff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);

      // Normal to plane: (-dz_dx, 1, -dz_dy) in math coords -> (-dz_dx, 1, -dz_dy) in 3D: (X: -dz_dx, Y: 1, Z: -dz_dy)
      const normal = new THREE.Vector3(-dz_dx, 1, -dz_dy).normalize();
      planeMesh.position.set(x0, z0, y0);
      planeMesh.lookAt(new THREE.Vector3(x0, z0, y0).add(normal));

      this.calculusGroup.add(planeMesh);

      // Sphere at tangent point
      const pointGeo = new THREE.SphereGeometry(0.12, 16, 16);
      const pointMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
      const pointMesh = new THREE.Mesh(pointGeo, pointMat);
      pointMesh.position.set(x0, z0, y0);
      this.calculusGroup.add(pointMesh);
    }

    // 2. Gradient Vector: (dz_dx, dz_dy) in XY plane
    if (showGrad) {
      const gradLen = Math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy);
      if (gradLen > 0.001) {
        const gradDir = new THREE.Vector3(dz_dx / gradLen, 0, dz_dy / gradLen);
        const gradArrow = new THREE.ArrowHelper(
          gradDir,
          new THREE.Vector3(x0, z0 + 0.05, y0),
          Math.min(3, gradLen),
          0xffbb00,
          0.3,
          0.12
        );
        this.calculusGroup.add(gradArrow);
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
      const h = harmonics[k]; // { freq, amp, phase }
      const radius = h.amp * scale;
      const angle = h.freq * tVal + (h.phase || 0);

      // Draw phasor circle
      const circleGeo = new THREE.BufferGeometry();
      const circlePts = [];
      const numSegs = 40;
      for (let s = 0; s <= numSegs; s++) {
        const th = (s / numSegs) * Math.PI * 2;
        circlePts.push(curX + radius * Math.cos(th), curY + radius * Math.sin(th), curZ);
      }
      circleGeo.setAttribute('position', new THREE.Float32BufferAttribute(circlePts, 3));
      const circleMat = new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.6 });
      const circleLine = new THREE.Line(circleGeo, circleMat);
      this.epicycleGroup.add(circleLine);

      // Phasor arm vector
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
    while (this.plotGroup.children.length > 0) {
      const obj = this.plotGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
      this.plotGroup.remove(obj);
    }
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

  toggleAxes(show) {
    this.options.showAxes = show;
    this.axisGroup.visible = show;
  }

  toggleGrid(show) {
    this.options.showGrid = show;
    if (this.gridHelper) this.gridHelper.visible = show;
  }

  toggleWireframe(wire) {
    this.options.wireframe = wire;
  }

  setColorMap(mapName) {
    this.options.colorMap = mapName;
  }

  animate() {
    requestAnimationFrame(this.animate);
    // Skip rendering when the container is hidden or has no size (e.g. the studio
    // page is not the active page), which avoids wasted GPU work and startup churn.
    if (this.container.clientWidth === 0 || this.container.clientHeight === 0) {
      return;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
