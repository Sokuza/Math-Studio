/**
 * Mathematical Presets & Multi-Preset Mixing Engine.
 * Supports standard presets (Circle, Sphere, Torus, Waves, Lissajous, Fourier series)
 * and custom user presets with morphing / harmonic superposition / modulation.
 */

export class PresetsManager {
  constructor() {
    this.builtinPresets = [
      {
        id: 'circle_sphere',
        name: '圆与球体 (Circle & 3D Sphere)',
        category: '几何曲面',
        type: 'parametric_surface',
        exprX: 'R * sin(u) * cos(v)',
        exprY: 'R * sin(u) * sin(v)',
        exprZ: 'R * cos(u)',
        uRange: [0, 3.14159],
        vRange: [0, 6.28318],
        defaultParams: { R: 3.5 },
        description: '三维标准球面方程 x^2 + y^2 + z^2 = R^2 的参数化表示'
      },
      {
        id: 'torus_donut',
        name: '三维环面 (Torus / Donut)',
        category: '几何曲面',
        type: 'parametric_surface',
        exprX: '(R + 1.2 * cos(v)) * cos(u)',
        exprY: '(R + 1.2 * cos(v)) * sin(u)',
        exprZ: '1.2 * sin(v)',
        uRange: [0, 6.28318],
        vRange: [0, 6.28318],
        defaultParams: { R: 3.0 },
        description: '三维环面 (R - sqrt(x^2+y^2))^2 + z^2 = r^2'
      },
      {
        id: 'wave_ripple',
        name: '水波干涉曲面 (Wave Ripple)',
        category: '物理波动',
        type: 'explicit',
        expr: 'A * cos(omega * sqrt(x^2 + y^2) - t) / (1 + 0.15 * (x^2 + y^2))',
        xRange: [-6, 6],
        yRange: [-6, 6],
        defaultParams: { A: 2.5, omega: 2.0 },
        description: '二维向外发散并衰减的圆形波纹干涉'
      },
      {
        id: 'fourier_square_wave',
        name: '傅里叶方波合成 (Fourier Square Wave)',
        category: '谐波分析',
        type: 'explicit',
        expr: 'A * (4/pi * (sin(x - omega*t) + 1/3*sin(3*(x - omega*t)) + 1/5*sin(5*(x - omega*t)) + 1/7*sin(7*(x - omega*t)))) * cos(0.3 * y)',
        xRange: [-6, 6],
        yRange: [-6, 6],
        defaultParams: { A: 2.0, omega: 1.5 },
        harmonics: [
          { freq: 1, amp: 4 / Math.PI, phase: 0 },
          { freq: 3, amp: 4 / (3 * Math.PI), phase: 0 },
          { freq: 5, amp: 4 / (5 * Math.PI), phase: 0 },
          { freq: 7, amp: 4 / (7 * Math.PI), phase: 0 }
        ],
        description: '奇次谐波叠加重构方波（带3D旋转向量链）'
      },
      {
        id: 'fourier_sawtooth',
        name: '傅里叶锯齿波 (Fourier Sawtooth Wave)',
        category: '谐波分析',
        type: 'explicit',
        expr: 'A * (2/pi * (sin(x - omega*t) - 1/2*sin(2*(x - omega*t)) + 1/3*sin(3*(x - omega*t)) - 1/4*sin(4*(x - omega*t)))) * cos(0.2 * y)',
        xRange: [-6, 6],
        yRange: [-6, 6],
        defaultParams: { A: 2.0, omega: 1.5 },
        harmonics: [
          { freq: 1, amp: 2 / Math.PI, phase: 0 },
          { freq: 2, amp: 1 / Math.PI, phase: Math.PI },
          { freq: 3, amp: 2 / (3 * Math.PI), phase: 0 },
          { freq: 4, amp: 1 / (2 * Math.PI), phase: Math.PI }
        ],
        description: '全次谐波叠加构成的线性锯齿波'
      },
      {
        id: 'lissajous_3d',
        name: '3D李萨如空间曲线 (3D Lissajous)',
        category: '空间曲线',
        type: 'parametric_curve',
        exprX: 'A * sin(3 * u + phi)',
        exprY: 'A * sin(4 * u)',
        exprZ: 'A * cos(5 * u)',
        uRange: [0, 6.28318],
        defaultParams: { A: 3.5, phi: 0 },
        description: '三维正交简谐振动合成的李萨如空间轨迹'
      },
      {
        id: 'mobius_strip',
        name: '莫比乌斯带 (Möbius Strip)',
        category: '几何曲面',
        type: 'parametric_surface',
        exprX: '(2 + (v/2) * cos(u/2)) * cos(u)',
        exprY: '(2 + (v/2) * cos(u/2)) * sin(u)',
        exprZ: '(v/2) * sin(u/2)',
        uRange: [0, 6.28318],
        vRange: [-1, 1],
        defaultParams: {},
        description: '拓扑单侧非可定向曲面'
      },
      {
        id: 'saddle_surface',
        name: '马鞍面 / 双曲抛物面 (Saddle Surface)',
        category: '微积分曲面',
        type: 'explicit',
        expr: '0.4 * (x^2 - y^2) * cos(0.5 * t)',
        xRange: [-4, 4],
        yRange: [-4, 4],
        defaultParams: {},
        description: '经典双曲鞍点与主曲率分析曲面'
      }
    ];

    this.userPresets = [];
  }

  getAllPresets() {
    return [...this.builtinPresets, ...this.userPresets];
  }

  getPresetById(id) {
    return this.getAllPresets().find(p => p.id === id);
  }

  addUserPreset(preset) {
    preset.id = 'user_' + Date.now();
    preset.category = '用户自定义';
    this.userPresets.push(preset);
    return preset;
  }

  // --- Multi-Preset Mixing Engine ---
  /**
   * Mix two presets using a blend mode.
   * mode:
   *   'morph': (1 - alpha)*P1 + alpha*P2 (Linear Morphing)
   *   'superposition': P1 + P2 (Wave Interference)
   *   'modulation': P1 * P2 (Amplitude Modulation)
   *   'envelope': P1 * exp(-P2^2 / 4)
   */
  mixPresets(presetA, presetB, mode = 'morph', blendParamName = 'alpha') {
    if (presetA.type === 'explicit' && presetB.type === 'explicit') {
      let mixedExpr = '';
      if (mode === 'morph') {
        mixedExpr = `(1 - ${blendParamName}) * (${presetA.expr}) + ${blendParamName} * (${presetB.expr})`;
      } else if (mode === 'superposition') {
        mixedExpr = `(${presetA.expr}) + (${presetB.expr})`;
      } else if (mode === 'modulation') {
        mixedExpr = `(${presetA.expr}) * (${presetB.expr})`;
      } else {
        mixedExpr = `(${presetA.expr}) * exp(-(${presetB.expr})^2 / 5)`;
      }

      return {
        id: `mix_${presetA.id}_${presetB.id}`,
        name: `混合: ${presetA.name} ⊗ ${presetB.name}`,
        category: '复合混合',
        type: 'explicit',
        expr: mixedExpr,
        xRange: presetA.xRange || [-5, 5],
        yRange: presetA.yRange || [-5, 5],
        defaultParams: Object.assign({}, presetA.defaultParams, presetB.defaultParams, { [blendParamName]: 0.5 }),
        description: `基于模式 [${mode}] 对两个预设进行动态融合`
      };
    } else if (presetA.type === 'parametric_surface' && presetB.type === 'parametric_surface') {
      // Morph parametric surfaces
      const blend = (e1, e2) => `(1 - ${blendParamName}) * (${e1}) + ${blendParamName} * (${e2})`;
      return {
        id: `mix_${presetA.id}_${presetB.id}`,
        name: `形变混合: ${presetA.name} ➔ ${presetB.name}`,
        category: '复合混合',
        type: 'parametric_surface',
        exprX: blend(presetA.exprX, presetB.exprX),
        exprY: blend(presetA.exprY, presetB.exprY),
        exprZ: blend(presetA.exprZ, presetB.exprZ),
        uRange: presetA.uRange || [0, 6.28],
        vRange: presetA.vRange || [0, 6.28],
        defaultParams: Object.assign({}, presetA.defaultParams, presetB.defaultParams, { [blendParamName]: 0.5 }),
        description: `三维参数曲面拓扑连续形态变换`
      };
    }

    return null;
  }
}
