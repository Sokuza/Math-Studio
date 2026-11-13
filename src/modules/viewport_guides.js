import * as THREE from 'three';

const extent = 350;
const defaults = {
  enabled: true,
  floor: true,
  orthoGrid: true,
  axes: [true, true, false],
  cursor: true,
  cursorPosition: [0, 0, 0],
  spacing: 1,
  subdivisions: 5,
  opacity: 0.44,
  wireMode: 'off',
  wireOpacity: 0.55
};

const gridVertex = `
  varying vec2 gridPoint;
  varying vec3 worldPoint;

  void main() {
    gridPoint = position.xy;
    vec4 world = modelMatrix * vec4(position, 1.0);
    worldPoint = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const gridFragment = `
  varying vec2 gridPoint;
  varying vec3 worldPoint;
  uniform vec3 tint;
  uniform float spacing;
  uniform float subdivisions;
  uniform float opacity;

  float gridLine(float stepSize) {
    vec2 coordinate = gridPoint / stepSize;
    vec2 width = max(fwidth(coordinate), vec2(0.00001));
    vec2 nearest = abs(fract(coordinate + 0.5) - 0.5) / width;
    float coverage = 1.0 - smoothstep(0.15, 1.0, min(nearest.x, nearest.y));
    return coverage * (1.0 - smoothstep(0.13, 0.5, max(width.x, width.y)));
  }

  void main() {
    float major = gridLine(spacing);
    float minor = subdivisions > 1.0 ? gridLine(spacing / subdivisions) : 0.0;
    float fade = 1.0 - smoothstep(100.0, 300.0, distance(worldPoint, cameraPosition));
    float alpha = max(major, minor * 0.29) * fade * opacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(tint, alpha);
    #include <colorspace_fragment>
  }
`;

export class ViewportGuides {
  constructor(scene) {
    this.group = new THREE.Group();
    this.direction = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(2 * extent, 2 * extent), new THREE.ShaderMaterial({
      vertexShader: gridVertex,
      fragmentShader: gridFragment,
      uniforms: {
        tint: { value: new THREE.Color(0x787878) },
        spacing: { value: defaults.spacing },
        subdivisions: { value: defaults.subdivisions },
        opacity: { value: defaults.opacity }
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    }));
    this.grid.renderOrder = 1;
    this.group.add(this.grid);

    const axes = [
      [new THREE.Vector3(1, 0, 0), 0xb84a62],
      [new THREE.Vector3(0, 0, 1), 0x4d9e55],
      [new THREE.Vector3(0, 1, 0), 0x5086cc]
    ];
    this.axes = axes.map(([axis, color]) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        axis.clone().multiplyScalar(-extent), axis.clone().multiplyScalar(extent)
      ]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.85, depthWrite: false
      }));
      line.renderOrder = 2;
      this.group.add(line);
      return line;
    });

    this.cursor = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createCursorTexture(),
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      toneMapped: false
    }));
    this.cursor.renderOrder = 10;
    this.group.add(this.cursor);
    scene.add(this.group);
    this.configure();
  }

  configure(settings = {}) {
    const finite = (key, min, max) => Number.isFinite(settings[key])
      ? THREE.MathUtils.clamp(settings[key], min, max) : defaults[key];
    this.settings = {
      enabled: settings.enabled !== false,
      floor: settings.floor !== false,
      orthoGrid: settings.orthoGrid !== false,
      axes: defaults.axes.map((value, index) => typeof settings.axes?.[index] === 'boolean' ? settings.axes[index] : value),
      cursor: settings.cursor !== false,
      cursorPosition: Array.isArray(settings.cursorPosition) && settings.cursorPosition.length === 3 &&
        settings.cursorPosition.every(Number.isFinite) ? [...settings.cursorPosition] : [...defaults.cursorPosition],
      spacing: finite('spacing', 0.01, 100),
      subdivisions: Math.round(finite('subdivisions', 1, 10)),
      opacity: finite('opacity', 0, 1),
      wireMode: ['off', 'overlay', 'only'].includes(settings.wireMode) ? settings.wireMode : 'off',
      wireOpacity: finite('wireOpacity', 0, 1)
    };

    this.group.visible = this.settings.enabled;
    this.cursor.visible = this.settings.cursor;
    this.axes.forEach((axis, index) => { axis.visible = this.settings.axes[index]; });
    this.grid.material.uniforms.spacing.value = this.settings.spacing;
    this.grid.material.uniforms.subdivisions.value = this.settings.subdivisions;
    this.grid.material.uniforms.opacity.value = this.settings.opacity;
    this.setCursorPosition(this.settings.cursorPosition);
  }

  setCursorPosition([x, y, z]) {
    this.settings.cursorPosition = [x, y, z];
    this.cursor.position.set(x, z, y);
  }

  setLightTheme(light) {
    this.grid.material.uniforms.tint.value.setHex(light ? 0x808080 : 0x787878);
  }

  update(camera, height) {
    camera.getWorldDirection(this.direction);
    const normal = this.plane.normal.set(0, 1, 0);
    this.grid.rotation.set(-Math.PI / 2, 0, 0);
    const aligned = camera.isOrthographicCamera && (
      Math.abs(this.direction.x) > 0.99999 ||
      Math.abs(this.direction.y) > 0.99999 ||
      Math.abs(this.direction.z) > 0.99999
    );
    if (aligned && Math.abs(this.direction.z) > 0.99999) {
      this.grid.rotation.set(0, 0, 0);
      normal.set(0, 0, 1);
    } else if (aligned && Math.abs(this.direction.x) > 0.99999) {
      this.grid.rotation.set(0, Math.PI / 2, 0);
      normal.set(1, 0, 0);
    }
    this.grid.visible = aligned ? this.settings.orthoGrid : this.settings.floor;
    const size = 2 * 34 / (Math.max(1, height) * camera.projectionMatrix.elements[5]);
    this.cursor.scale.set(size, size, 1);
  }
}

function createCursorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.translate(64, 64);
  ctx.beginPath();
  ctx.moveTo(-53, 0);
  ctx.lineTo(53, 0);
  ctx.moveTo(0, -53);
  ctx.lineTo(0, 53);
  ctx.moveTo(39, 0);
  ctx.arc(0, 0, 39, 0, 2 * Math.PI);
  ctx.strokeStyle = '#181818';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineWidth = 6;
  for (let index = 0; index < 8; index++) {
    ctx.beginPath();
    ctx.arc(0, 0, 39, index * Math.PI / 4, (index + 1) * Math.PI / 4);
    ctx.strokeStyle = index % 2 ? '#fcfcfc' : '#ed4b4e';
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
