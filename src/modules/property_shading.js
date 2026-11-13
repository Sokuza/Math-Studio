import { Color, Vector3 } from 'three';

const palettes = {
  coolwarm: [0x3b4cc0, 0x8db0fe, 0xdddddd, 0xf49a7b, 0xb40426],
  viridis: [0x440154, 0x3b528b, 0x21918c, 0x5ec962, 0xfde725],
  plasma: [0x0d0887, 0x7e03a8, 0xcc4778, 0xf89540, 0xf0f921],
  rainbow: [0x4826be, 0x187adc, 0x22bd9b, 0xc8d83d, 0xf68324, 0xb91f2e],
  neon: [0x06232c, 0x006c83, 0x43e7e8, 0xcf6eee, 0xff6cbe],
  gray: [0x252525, 0xf2f2f2]
};

export const propertyMetrics = {
  explicit: ['height', 'gaussian', 'mean', 'solid'],
  parametric_surface: ['height', 'gaussian', 'mean', 'solid'],
  parametric_curve: ['height', 'curve', 'solid'],
  vector_field: ['magnitude', 'height', 'solid']
};

export class PropertyShading {
  constructor() {
    this.lookup = Array.from({ length: 256 }, () => new Color());
    this.missingColor = new Color(0x777777);
    this.solidColor = new Color(0xbfc6d0);
    this.configure();
  }

  configure(settings = {}) {
    const range = settings.range;
    this.manualRange = Array.isArray(range) && range.length === 2 &&
      range.every(Number.isFinite) && range[0] < range[1] ? [...range] : null;
    this.setPalette(settings.palette);
  }

  setPalette(palette) {
    const name = Object.hasOwn(palettes, palette) ? palette : 'coolwarm';
    if (this.palette === name) return;
    this.palette = name;
    const colors = palettes[name].map(hex => new Color(hex));
    for (let i = 0; i < this.lookup.length; i++) {
      const position = i * (colors.length - 1) / (this.lookup.length - 1);
      const segment = Math.min(Math.floor(position), colors.length - 2);
      this.lookup[i].copy(colors[segment]).lerp(colors[segment + 1], position - segment);
    }
    const stops = this.lookup.filter((_, index) => index % 17 === 0);
    this.gradient = `linear-gradient(to right, ${stops.map(color => color.getStyle()).join(', ')})`;
  }

  measure(values) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    this.dataRange = min <= max ? [min, max] : null;
    this.displayRange = this.manualRange || this.dataRange;
  }

  colorFor(value) {
    if (!Number.isFinite(value) || !this.displayRange) return this.missingColor;
    const [min, max] = this.displayRange;
    const span = max - min;
    const constant = span <= Math.max(Math.abs(min), Math.abs(max), 1e-12) * 1e-9;
    if (constant && !this.manualRange) return this.lookup[this.lookup.length >> 1];
    if (value <= min) return this.lookup[0];
    if (value >= max) return this.lookup[this.lookup.length - 1];
    const t = Number.isFinite(span) ? (value - min) / span
      : (value / 2 - min / 2) / (max / 2 - min / 2);
    return this.lookup[Math.round(t * (this.lookup.length - 1))];
  }

  paint(values, attribute, repeat = 1) {
    this.measure(values);
    let vertex = 0;
    for (const value of values) {
      const color = this.colorFor(value);
      for (let i = 0; i < repeat; i++) {
        attribute.setXYZ(vertex++, color.r, color.g, color.b);
      }
    }
    attribute.needsUpdate = true;
  }
}

export function derivativeStencils(segments) {
  return Array.from({ length: segments + 1 }, (_, index) => {
    if (index === 0) return { start: 0, first: [-1.5, 2, -0.5] };
    if (index === segments) return { start: segments - 2, first: [0.5, -2, 1.5] };
    return { start: index - 1, first: [-0.5, 0, 0.5] };
  });
}

export function sampleSurfaceProperty(cache, metric) {
  const { values, samples, valid, columns, rows, uStencils, vStencils } = cache;
  if (metric === 'height') {
    for (let index = 0; index < values.length; index++) {
      values[index] = valid[index] ? samples[index * 3 + 1] : NaN;
    }
    return;
  }

  // Finite differences in grid-index coordinates. The first and second
  // fundamental forms cancel the parameter step sizes in H and K.
  const width = columns + 1;
  const ru = new Vector3(), rv = new Vector3(), ruu = new Vector3();
  const ruv = new Vector3(), rvv = new Vector3(), normal = new Vector3();
  const offset = new Vector3(), origin = new Vector3();
  const second = [1, -2, 1];
  for (let j = 0; j <= rows; j++) {
    const v = vStencils[j];
    for (let i = 0; i <= columns; i++) {
      const u = uStencils[i];
      const index = j * width + i;
      origin.fromArray(samples, index * 3);
      ru.set(0, 0, 0);
      rv.set(0, 0, 0);
      ruu.set(0, 0, 0);
      rvv.set(0, 0, 0);
      ruv.set(0, 0, 0);
      let defined = true;

      for (let b = 0; b < 3; b++) {
        const row = v.start + b;
        for (let a = 0; a < 3; a++) {
          const column = u.start + a;
          const neighbor = row * width + column;
          defined = defined && valid[neighbor] === 1;
          offset.fromArray(samples, neighbor * 3).sub(origin);
          if (row === j) {
            ru.addScaledVector(offset, u.first[a]);
            ruu.addScaledVector(offset, second[a]);
          }
          if (column === i) {
            rv.addScaledVector(offset, v.first[b]);
            rvv.addScaledVector(offset, second[b]);
          }
          ruv.addScaledVector(offset, u.first[a] * v.first[b]);
        }
      }

      const E = ru.lengthSq();
      const F = ru.dot(rv);
      const G = rv.lengthSq();
      normal.crossVectors(ru, rv);
      const determinant = normal.lengthSq();
      if (!defined || !Number.isFinite(determinant) ||
          Math.min(E, G) <= Math.max(E, G) * 1e-24 || determinant <= E * G * 1e-12) {
        values[index] = NaN;
        continue;
      }
      normal.multiplyScalar(1 / Math.sqrt(determinant));
      const e = normal.dot(ruu);
      const f = normal.dot(ruv);
      const g = normal.dot(rvv);
      values[index] = metric === 'gaussian'
        ? (e * g - f * f) / determinant
        : Math.abs((E * g - 2 * F * f + G * e) / (2 * determinant));
    }
  }
}

export function sampleCurveProperty(curve, segments, metric) {
  const points = Array.from({ length: segments + 1 }, (_, i) => curve.getPointAt(i / segments));
  if (metric === 'height') return points.map(point => point.y);

  const velocity = new Vector3(), acceleration = new Vector3(), cross = new Vector3();
  return derivativeStencils(segments).map(({ start, first }) => {
    const a = points[start], b = points[start + 1], c = points[start + 2];
    velocity.copy(a).multiplyScalar(first[0]).addScaledVector(b, first[1]).addScaledVector(c, first[2]);
    acceleration.copy(a).addScaledVector(b, -2).add(c);
    const speed = velocity.length();
    return speed > 0 ? cross.crossVectors(velocity, acceleration).length() / speed ** 3 : NaN;
  });
}
