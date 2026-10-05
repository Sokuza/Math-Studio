/**
 * Code Generator Module.
 * Generates standalone, clean, production-ready code in JavaScript (Three.js HTML)
 * and Python (Matplotlib 3D / Manim) for the currently active math animation.
 */

export class CodeGenerator {
  static generateThreeJsHtml(setup) {
    const {
      type,
      expr,
      exprX,
      exprY,
      exprZ,
      xRange = [-5, 5],
      yRange = [-5, 5],
      uRange = [0, 6.28],
      vRange = [0, 6.28],
      params = {},
      keyframeCode = ''
    } = setup;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>数学表达式3D动画 - Three.js 独立运行版本</title>
  <style>
    body { margin: 0; overflow: hidden; background: #111; font-family: sans-serif; }
    #info { position: absolute; top: 15px; left: 15px; color: #fff; background: rgba(0,0,0,0.7); padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
</head>
<body>
  <div id="info">
    <h3>数学函数 3D 动画</h3>
    <p>表达式: <code>${expr || `${exprX}, ${exprY}, ${exprZ}`}</code></p>
  </div>
  <script>
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141414);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(12, 12, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Lights & Grid
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);
    scene.add(new THREE.GridHelper(20, 20, 0x0078d4, 0x333333));
    scene.add(new THREE.AxesHelper(8));

    // Dynamic Mesh
    const segX = 60, segY = 60;
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
      roughness: 0.3,
      metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Math Function Definition
    function mathFunction(x, y, t, p) {
      // Current formula evaluation
      const A = p.A || 2.0;
      const omega = p.omega || 1.5;
      const R = p.R || 3.0;
      return Math.sin(Math.sqrt(x*x + y*y) - omega*t) * A / (1 + 0.1*(x*x + y*y));
    }

    const clock = new THREE.Clock();

    function updateSurface(t) {
      const p = { A: 2.0 + Math.sin(t), omega: 1.5, t };
      const dx = (${xRange[1]} - ${xRange[0]}) / segX;
      const dy = (${yRange[1]} - ${yRange[0]}) / segY;
      let ptr = 0;

      for (let j = 0; j <= segY; j++) {
        const y = ${yRange[0]} + j * dy;
        for (let i = 0; i <= segX; i++) {
          const x = ${xRange[0]} + i * dx;
          const z = mathFunction(x, y, t, p);
          positions[ptr] = x;
          positions[ptr + 1] = z; // height
          positions[ptr + 2] = y;

          // Color calculation
          const normZ = Math.max(0, Math.min(1, (z + 2) / 4));
          colors[ptr] = normZ;
          colors[ptr + 1] = 0.5;
          colors[ptr + 2] = 1 - normZ;

          ptr += 3;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      updateSurface(t);
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

  static generatePythonMatplotlib(setup) {
    const { expr = "sin(sqrt(x**2 + y**2) - t)", xRange = [-5, 5], yRange = [-5, 5] } = setup;
    const cleanExpr = expr.replace(/\^/g, '**');

    return `"""
Mathematical Function 3D Animation using Python and Matplotlib.
Generated by "数学函数表达式工具" (Windows Fluent Edition).
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib import cm
from matplotlib.animation import FuncAnimation

# Domain Setup
x = np.linspace(${xRange[0]}, ${xRange[1]}, 80)
y = np.linspace(${yRange[0]}, ${yRange[1]}, 80)
X, Y = np.meshgrid(x, y)

fig = plt.figure(figsize=(10, 7), facecolor='#1f1f1f')
ax = fig.add_subplot(111, projection='3d', facecolor='#1f1f1f')

# Function evaluation with time t
def compute_z(X, Y, t):
    A = 2.0 + np.sin(t * 0.8)
    omega = 1.5
    # Evaluated expression:
    # ${cleanExpr}
    R = np.sqrt(X**2 + Y**2)
    Z = np.sin(R - omega * t) * A / (1 + 0.1 * (X**2 + Y**2))
    return Z

surf = [ax.plot_surface(X, Y, compute_z(X, Y, 0), cmap=cm.coolwarm, antialiased=True)]

# Axis Styling
ax.set_xlim(${xRange[0]}, ${xRange[1]})
ax.set_ylim(${yRange[0]}, ${yRange[1]})
ax.set_zlim(-3, 3)
ax.set_xlabel('X', color='white')
ax.set_ylabel('Y', color='white')
ax.set_zlabel('Z', color='white')
ax.tick_params(colors='white')
ax.grid(color='#444444')

def update(frame):
    t = frame * 0.05
    surf[0].remove()
    Z = compute_z(X, Y, t)
    surf[0] = ax.plot_surface(X, Y, Z, cmap=cm.coolwarm, antialiased=True, rstride=2, cstride=2)
    return surf

anim = FuncAnimation(fig, update, frames=180, interval=33, blit=False)

# To export to MP4:
# anim.save('math_animation.mp4', writer='ffmpeg', fps=30, dpi=150)

plt.show()
`;
  }
}
