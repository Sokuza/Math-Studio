import { getLocale, translate } from './i18n.js';

/**
 * Code Generator Module for Math Studio.
 * Generates standalone, production-ready code in JavaScript (Three.js HTML5)
 * and Python (NumPy & Matplotlib 3D) for the active mathematical model and parameters.
 */

export class CodeGenerator {
  /**
   * Convert user mathematical string into valid JavaScript expression
   */
  static toJsExpr(expr) {
    if (!expr || typeof expr !== 'string') return '0';
    let s = expr.trim();
    // Power operator
    s = s.replace(/\^/g, '**');

    // Constants
    s = s.replace(/\bpi\b/gi, 'Math.PI');
    s = s.replace(/\be\b(?![a-zA-Z0-9_])/g, 'Math.E');

    // Mathematical functions
    const funcs = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'exp', 'log', 'sinh', 'cosh', 'tanh'];
    funcs.forEach(fn => {
      const reg = new RegExp(`\\b${fn}\\(`, 'g');
      s = s.replace(reg, `Math.${fn}(`);
    });

    // Special custom helpers
    s = s.replace(/\bsinc\((.*?)\)/g, '(($1) === 0 ? 1 : Math.sin($1)/($1))');
    s = s.replace(/\bsigmoid\((.*?)\)/g, '(1 / (1 + Math.exp(-($1))))');
    return s;
  }

  /**
   * Convert user mathematical string into valid Python / NumPy expression
   */
  static toPyExpr(expr) {
    if (!expr || typeof expr !== 'string') return '0';
    let s = expr.trim();
    s = s.replace(/\^/g, '**');
    s = s.replace(/\bpi\b/gi, 'np.pi');
    s = s.replace(/\be\b(?![a-zA-Z0-9_])/g, 'np.e');

    const funcs = ['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sqrt', 'abs', 'exp', 'log', 'sinh', 'cosh', 'tanh'];
    funcs.forEach(fn => {
      const reg = new RegExp(`\\b${fn}\\(`, 'g');
      s = s.replace(reg, `np.${fn}(`);
    });

    // asin/acos/atan mapping in numpy
    s = s.replace(/\basin\(/g, 'np.arcsin(');
    s = s.replace(/\bacos\(/g, 'np.arccos(');
    s = s.replace(/\batan\(/g, 'np.arctan(');
    s = s.replace(/\bsinc\((.*?)\)/g, 'np.sinc(($1) / np.pi)');
    s = s.replace(/\bsigmoid\((.*?)\)/g, '(1.0 / (1.0 + np.exp(-($1))))');
    return s;
  }

  /**
   * Generate standalone HTML5 + Three.js application
   */
  static generateThreeJsHtml(setup, currentParams = {}) {
    const {
      type = 'explicit',
      expr = 'cos(sqrt(x^2 + y^2) - t)',
      exprX = 'sin(u)',
      exprY = 'cos(u)',
      exprZ = 'u * 0.1',
      vecU = '-y',
      vecV = 'x',
      vecW = '0.5 * sin(t)',
      xRange = [-5, 5],
      yRange = [-5, 5],
      uRange = [0, 6.283],
      vRange = [0, 6.283],
      meshRes = 60
    } = setup;

    const paramEntries = Object.entries(currentParams);
    const paramInitJs = paramEntries.length > 0
      ? paramEntries.map(([k, v]) => `      const ${k} = p.${k} ?? ${v};`).join('\n')
      : '      // No dynamic parameters';

    const paramObjJs = paramEntries.length > 0
      ? '{ ' + paramEntries.map(([k, v]) => `${k}: ${v}`).join(', ') + ', t }'
      : '{ t }';

    let renderLogic = '';
    let descriptionText = '';

    if (type === 'explicit') {
      const jsFormula = this.toJsExpr(expr);
      descriptionText = `显式曲面: z = f(x, y, t) = ${expr}`;
      renderLogic = `
    // Dynamic Surface Geometry
    const segX = ${meshRes}, segY = ${meshRes};
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segX + 1) * (segY + 1) * 3);
    const colors = new Float32Array((segX + 1) * (segY + 1) * 3);
    const indices = [];

    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * (segX + 1) + i;
        const b = a + 1;
        const c = a + (segX + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    function evaluateFormula(x, y, t, p) {
${paramInitJs}
      try {
        const val = ${jsFormula};
        return isFinite(val) ? Math.min(Math.max(val, -30), 30) : 0;
      } catch (err) {
        return 0;
      }
    }

    function updateFrame(t) {
      const p = ${paramObjJs};
      const xMin = ${xRange[0]}, xMax = ${xRange[1]};
      const yMin = ${yRange[0]}, yMax = ${yRange[1]};
      const dx = (xMax - xMin) / segX;
      const dy = (yMax - yMin) / segY;
      let ptr = 0;

      for (let j = 0; j <= segY; j++) {
        const y = yMin + j * dy;
        for (let i = 0; i <= segX; i++) {
          const x = xMin + i * dx;
          const z = evaluateFormula(x, y, t, p);
          positions[ptr] = x;
          positions[ptr + 1] = z; // height elevation
          positions[ptr + 2] = y;

          // Cool-warm color map
          const normZ = Math.max(0, Math.min(1, (z + 2.5) / 5));
          positions[ptr + 1] = z;
          colors[ptr] = normZ;
          colors[ptr + 1] = 0.4 + 0.5 * (1 - Math.abs(normZ - 0.5) * 2);
          colors[ptr + 2] = 1 - normZ;
          ptr += 3;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.computeVertexNormals();
    }
`;
    } else if (type === 'parametric_curve') {
      const jsX = this.toJsExpr(exprX);
      const jsY = this.toJsExpr(exprY);
      const jsZ = this.toJsExpr(exprZ);
      descriptionText = `参数曲线: r(u, t) = (${exprX}, ${exprY}, ${exprZ})`;
      renderLogic = `
    let curveMesh = null;
    function evaluateCurve(u, t, p) {
${paramInitJs}
      const x = ${jsX};
      const y = ${jsY};
      const z = ${jsZ};
      return new THREE.Vector3(isFinite(x)?x:0, isFinite(z)?z:0, isFinite(y)?y:0);
    }

    function updateFrame(t) {
      const p = ${paramObjJs};
      const samples = 300;
      const uMin = ${uRange[0]}, uMax = ${uRange[1]};
      const points = [];
      for (let i = 0; i <= samples; i++) {
        const u = uMin + (uMax - uMin) * (i / samples);
        points.push(evaluateCurve(u, t, p));
      }

      if (curveMesh) {
        scene.remove(curveMesh);
        curveMesh.geometry.dispose();
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, samples, 0.08, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({ color: 0x00c6ff, roughness: 0.3, metalness: 0.3 });
      curveMesh = new THREE.Mesh(tubeGeo, tubeMat);
      scene.add(curveMesh);
    }
`;
    } else if (type === 'parametric_surface') {
      const jsX = this.toJsExpr(exprX);
      const jsY = this.toJsExpr(exprY);
      const jsZ = this.toJsExpr(exprZ);
      descriptionText = `参数曲面: r(u, v, t) = (${exprX}, ${exprY}, ${exprZ})`;
      renderLogic = `
    const segU = 50, segV = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segU + 1) * (segV + 1) * 3);
    const colors = new Float32Array((segU + 1) * (segV + 1) * 3);
    const indices = [];

    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = j * (segU + 1) + i;
        const b = a + 1;
        const c = a + (segU + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.3,
      metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    function evaluateSurface(u, v, t, p) {
${paramInitJs}
      const rx = ${jsX};
      const ry = ${jsY};
      const rz = ${jsZ};
      return { x: isFinite(rx)?rx:0, y: isFinite(ry)?ry:0, z: isFinite(rz)?rz:0 };
    }

    function updateFrame(t) {
      const p = ${paramObjJs};
      const uMin = ${uRange[0]}, uMax = ${uRange[1]};
      const vMin = ${vRange[0]}, vMax = ${vRange[1]};
      let ptr = 0;

      for (let j = 0; j <= segV; j++) {
        const v = vMin + (vMax - vMin) * (j / segV);
        for (let i = 0; i <= segU; i++) {
          const u = uMin + (uMax - uMin) * (i / segU);
          const pt = evaluateSurface(u, v, t, p);
          positions[ptr] = pt.x;
          positions[ptr + 1] = pt.z;
          positions[ptr + 2] = pt.y;

          const norm = Math.max(0, Math.min(1, (pt.z + 3) / 6));
          colors[ptr] = norm;
          colors[ptr + 1] = 0.6;
          colors[ptr + 2] = 1 - norm;
          ptr += 3;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.computeVertexNormals();
    }
`;
    } else {
      const jsU = this.toJsExpr(vecU);
      const jsV = this.toJsExpr(vecV);
      const jsW = this.toJsExpr(vecW);
      descriptionText = `向量场: F(x, y, z, t) = (${vecU}, ${vecV}, ${vecW})`;
      renderLogic = `
    const arrowGroup = new THREE.Group();
    scene.add(arrowGroup);

    function evaluateField(x, y, z, t, p) {
${paramInitJs}
      const u = ${jsU};
      const v = ${jsV};
      const w = ${jsW};
      return new THREE.Vector3(isFinite(u)?u:0, isFinite(w)?w:0, isFinite(v)?v:0);
    }

    function updateFrame(t) {
      const p = ${paramObjJs};
      while (arrowGroup.children.length > 0) {
        arrowGroup.remove(arrowGroup.children[0]);
      }
      const bound = 3, step = 1.5;
      for (let x = -bound; x <= bound; x += step) {
        for (let y = -bound; y <= bound; y += step) {
          for (let z = -bound; z <= bound; z += step) {
            const vec = evaluateField(x, y, z, t, p);
            const len = vec.length();
            if (len > 0.01) {
              const dir = vec.clone().normalize();
              const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(x, z, y), Math.min(1.2, len * 0.5), 0x00c6ff, 0.25, 0.1);
              arrowGroup.add(arrow);
            }
          }
        }
      }
    }
`;
    }

    return `<!DOCTYPE html>
<html lang="${getLocale()}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${translate('Math Studio - 独立三维动画')}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; background: #141414; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #f3f3f3; }
    #overlay-hud {
      position: absolute;
      top: 16px;
      left: 16px;
      background: rgba(26, 26, 26, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 12px 18px;
      pointer-events: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    #overlay-hud h3 { margin: 0 0 6px 0; font-size: 15px; color: #60cdff; }
    #overlay-hud p { margin: 0; font-size: 13px; color: #cccccc; font-family: Consolas, monospace; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
</head>
<body>
  <div id="overlay-hud">
    <h3>${translate('Math Studio 3D Export')}</h3>
    <p>${translate(descriptionText)}</p>
  </div>
  <script>
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141414);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(12, 12, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lights & Coordinate Grid
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(20, 40, 20);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0x0078d4, 0.4);
    dirLight2.position.set(-20, -20, -20);
    scene.add(dirLight2);

    scene.add(new THREE.GridHelper(20, 20, 0x0078d4, 0x333333));
    scene.add(new THREE.AxesHelper(10));

${renderLogic}

    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      updateFrame(t);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  </script>
</body>
</html>`;
  }

  /**
   * Generate Python animation code using NumPy and Matplotlib 3D
   */
  static generatePythonMatplotlib(setup, currentParams = {}) {
    const {
      type = 'explicit',
      expr = 'cos(sqrt(x^2 + y^2) - t)',
      exprX = 'sin(u)',
      exprY = 'cos(u)',
      exprZ = '0.2 * u',
      xRange = [-5, 5],
      yRange = [-5, 5],
      uRange = [0, 6.283],
      vRange = [0, 6.283]
    } = setup;

    const paramEntries = Object.entries(currentParams);
    const paramInitPy = paramEntries.length > 0
      ? paramEntries.map(([k, v]) => `    ${k} = ${v}`).join('\n')
      : '    pass';

    if (type === 'explicit') {
      const pyFormula = this.toPyExpr(expr);
      return `"""
Mathematical Function 3D Animation using Python and Matplotlib.
Generated by Math Studio (Windows 11 Fluent Edition).
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib import cm
from matplotlib.animation import FuncAnimation

# Domain Setup
x = np.linspace(${xRange[0]}, ${xRange[1]}, 70)
y = np.linspace(${yRange[0]}, ${yRange[1]}, 70)
X, Y = np.meshgrid(x, y)

fig = plt.figure(figsize=(10, 7), facecolor='#1f1f1f')
ax = fig.add_subplot(111, projection='3d', facecolor='#1f1f1f')

def compute_z(X, Y, t):
${paramInitPy}
    # Formula: ${expr}
    try:
        Z = ${pyFormula}
        return np.nan_to_num(Z, nan=0.0, posinf=20.0, neginf=-20.0)
    except Exception:
        return np.zeros_like(X)

initial_Z = compute_z(X, Y, 0)
surf = [ax.plot_surface(X, Y, initial_Z, cmap=cm.coolwarm, antialiased=True, rstride=1, cstride=1)]

ax.set_xlim(${xRange[0]}, ${xRange[1]})
ax.set_ylim(${yRange[0]}, ${yRange[1]})
ax.set_zlim(-5, 5)
ax.set_xlabel('X', color='white')
ax.set_ylabel('Y', color='white')
ax.set_zlabel('Z', color='white')
ax.tick_params(colors='white')
ax.grid(color='#444444')

def update(frame):
    t = frame * 0.05
    surf[0].remove()
    Z = compute_z(X, Y, t)
    surf[0] = ax.plot_surface(X, Y, Z, cmap=cm.coolwarm, antialiased=True, rstride=1, cstride=1)
    return surf

anim = FuncAnimation(fig, update, frames=120, interval=33, blit=False)
# To save as MP4: anim.save('math_surface.mp4', writer='ffmpeg', fps=30, dpi=150)
plt.show()
`;
    } else if (type === 'parametric_curve') {
      const pyX = this.toPyExpr(exprX);
      const pyY = this.toPyExpr(exprY);
      const pyZ = this.toPyExpr(exprZ);
      return `"""
3D Parametric Curve Animation using Python and Matplotlib.
Generated by Math Studio (Windows 11 Fluent Edition).
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

u = np.linspace(${uRange[0]}, ${uRange[1]}, 300)

fig = plt.figure(figsize=(10, 7), facecolor='#1f1f1f')
ax = fig.add_subplot(111, projection='3d', facecolor='#1f1f1f')

def compute_curve(u, t):
${paramInitPy}
    X = ${pyX}
    Y = ${pyY}
    Z = ${pyZ}
    return X, Y, Z

X, Y, Z = compute_curve(u, 0)
line, = ax.plot(X, Y, Z, color='#00c6ff', linewidth=2.5)

ax.set_xlabel('X', color='white')
ax.set_ylabel('Y', color='white')
ax.set_zlabel('Z', color='white')
ax.tick_params(colors='white')
ax.grid(color='#444444')

def update(frame):
    t = frame * 0.05
    nX, nY, nZ = compute_curve(u, t)
    line.set_data(nX, nY)
    line.set_3d_properties(nZ)
    return [line]

anim = FuncAnimation(fig, update, frames=120, interval=33, blit=False)
plt.show()
`;
    } else {
      // Parametric surface / vector field fallback
      const pyX = this.toPyExpr(exprX);
      const pyY = this.toPyExpr(exprY);
      const pyZ = this.toPyExpr(exprZ);
      return `"""
3D Parametric Surface Animation using Python and Matplotlib.
Generated by Math Studio (Windows 11 Fluent Edition).
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib import cm
from matplotlib.animation import FuncAnimation

u = np.linspace(${uRange[0]}, ${uRange[1]}, 50)
v = np.linspace(${vRange[0]}, ${vRange[1]}, 50)
U, V = np.meshgrid(u, v)

fig = plt.figure(figsize=(10, 7), facecolor='#1f1f1f')
ax = fig.add_subplot(111, projection='3d', facecolor='#1f1f1f')

def compute_surf(u, v, t):
${paramInitPy}
    X = ${pyX}
    Y = ${pyY}
    Z = ${pyZ}
    return X, Y, Z

X, Y, Z = compute_surf(U, V, 0)
surf = [ax.plot_surface(X, Y, Z, cmap=cm.viridis, antialiased=True)]

ax.set_xlabel('X', color='white')
ax.set_ylabel('Y', color='white')
ax.set_zlabel('Z', color='white')
ax.tick_params(colors='white')
ax.grid(color='#444444')

def update(frame):
    t = frame * 0.05
    surf[0].remove()
    nX, nY, nZ = compute_surf(U, V, t)
    surf[0] = ax.plot_surface(nX, nY, nZ, cmap=cm.viridis, antialiased=True)
    return surf

anim = FuncAnimation(fig, update, frames=120, interval=33, blit=False)
plt.show()
`;
    }
  }
}
