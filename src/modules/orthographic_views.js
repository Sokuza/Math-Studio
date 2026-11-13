import * as THREE from 'three';

export class OrthographicViews {
  constructor(root, viewport) {
    this.root = root;
    this.viewport = viewport;
    this.views = [
      ['left', [-1, 0, 0], [0, 1, 0]],
      ['front', [0, 0, 1], [0, 1, 0]],
      ['top', [0, 1, 0], [0, 0, -1]]
    ].map(([name, direction, up]) => {
      const canvas = root.querySelector(`[data-ortho="${name}"]`);
      return { canvas, context: canvas.getContext('2d'), direction, up };
    });
    this.camera = new THREE.OrthographicCamera();
    this.box = new THREE.Box3();
    this.sphere = new THREE.Sphere();
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(root);
  }

  refresh() {
    if (this.root.hidden || !this.root.clientWidth || this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      if (this.root.hidden || !this.root.clientWidth) return;
      this.draw();
    });
  }

  draw() {
    const { scene, plotGroup, guides, calculusGroup, epicycleGroup } = this.viewport;
    this.renderer ??= new THREE.WebGLRenderer({ antialias: true });
    const { camera, renderer } = this;
    this.box.setFromObject(plotGroup, true);
    const sphere = this.box.getBoundingSphere(this.sphere);
    const radius = Math.max(sphere.radius, 0.5);
    const overlays = [guides.group, calculusGroup, epicycleGroup];
    const previous = overlays.map(group => group.visible);
    overlays.forEach(group => { group.visible = false; });
    try {
      for (const view of this.views) {
        const { canvas, context, direction, up } = view;
        const scale = Math.min(devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(canvas.clientWidth * scale));
        const height = Math.max(1, Math.round(canvas.clientHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const aspect = width / height;
        const halfHeight = radius * 1.13 / Math.min(1, aspect);
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.right = halfHeight * aspect;
        camera.left = -camera.right;
        camera.near = 0.01;
        camera.far = radius * 6 + 1;
        camera.up.set(...up);
        camera.position.set(...direction).multiplyScalar(radius * 3 + 0.5).add(sphere.center);
        camera.lookAt(sphere.center);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
        context.drawImage(renderer.domElement, 0, 0);
      }
    } finally {
      overlays.forEach((group, index) => { group.visible = previous[index]; });
    }
  }
}
