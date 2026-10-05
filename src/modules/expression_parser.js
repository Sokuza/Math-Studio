/**
 * Expression Parser & Fast Math Evaluator using Math.js.
 * Compiles user strings into high-speed callable JavaScript functions with parameter scope injection.
 */

import * as math from 'mathjs';

export class ExpressionParser {
  constructor() {
    // Custom math scope with extended functions
    this.baseScope = {
      pi: Math.PI,
      e: Math.E,
      sinc: (x) => (x === 0 ? 1 : Math.sin(x) / x),
      sigmoid: (x) => 1 / (1 + Math.exp(-x)),
      clamp: (val, min, max) => Math.max(min, Math.min(max, val))
    };
  }

  cleanExpression(expr) {
    if (!expr) return "0";
    return expr
      .replace(/\*\*/g, '^') // standardize power
      .trim();
  }

  // Compile z = f(x, y, t, ...)
  compileExplicit(exprStr) {
    try {
      const cleaned = this.cleanExpression(exprStr);
      const compiled = math.compile(cleaned);
      
      return (x, y, customScope = {}) => {
        const scope = Object.assign({}, this.baseScope, customScope, { x, y });
        const res = compiled.evaluate(scope);
        return typeof res === 'number' && isFinite(res) ? res : 0;
      };
    } catch (e) {
      console.warn("Parse error for explicit expr:", exprStr, e);
      return (x, y) => 0;
    }
  }

  // Compile 3D Curve (x(u), y(u), z(u))
  compileParametricCurve(xStr, yStr, zStr) {
    try {
      const codeX = math.compile(this.cleanExpression(xStr));
      const codeY = math.compile(this.cleanExpression(yStr));
      const codeZ = math.compile(this.cleanExpression(zStr));

      return (u, customScope = {}) => {
        const scope = Object.assign({}, this.baseScope, customScope, { u, t: customScope.t || 0 });
        const rx = codeX.evaluate(scope);
        const ry = codeY.evaluate(scope);
        const rz = codeZ.evaluate(scope);
        return {
          x: typeof rx === 'number' && isFinite(rx) ? rx : 0,
          y: typeof ry === 'number' && isFinite(ry) ? ry : 0,
          z: typeof rz === 'number' && isFinite(rz) ? rz : 0
        };
      };
    } catch (e) {
      console.warn("Parse error for parametric curve:", e);
      return (u) => ({ x: 0, y: 0, z: 0 });
    }
  }

  // Compile 3D Surface (x(u,v), y(u,v), z(u,v))
  compileParametricSurface(xStr, yStr, zStr) {
    try {
      const codeX = math.compile(this.cleanExpression(xStr));
      const codeY = math.compile(this.cleanExpression(yStr));
      const codeZ = math.compile(this.cleanExpression(zStr));

      return (u, v, customScope = {}) => {
        const scope = Object.assign({}, this.baseScope, customScope, { u, v, t: customScope.t || 0 });
        const rx = codeX.evaluate(scope);
        const ry = codeY.evaluate(scope);
        const rz = codeZ.evaluate(scope);
        return {
          x: typeof rx === 'number' && isFinite(rx) ? rx : 0,
          y: typeof ry === 'number' && isFinite(ry) ? ry : 0,
          z: typeof rz === 'number' && isFinite(rz) ? rz : 0
        };
      };
    } catch (e) {
      console.warn("Parse error for parametric surface:", e);
      return (u, v) => ({ x: 0, y: 0, z: 0 });
    }
  }

  // Compile 3D Vector Field F(x,y,z) = (u, v, w)
  compileVectorField(uStr, vStr, wStr) {
    try {
      const codeU = math.compile(this.cleanExpression(uStr));
      const codeV = math.compile(this.cleanExpression(vStr));
      const codeW = math.compile(this.cleanExpression(wStr));

      return (x, y, z, customScope = {}) => {
        const scope = Object.assign({}, this.baseScope, customScope, { x, y, z, t: customScope.t || 0 });
        const ru = codeU.evaluate(scope);
        const rv = codeV.evaluate(scope);
        const rw = codeW.evaluate(scope);
        return {
          u: typeof ru === 'number' && isFinite(ru) ? ru : 0,
          v: typeof rv === 'number' && isFinite(rv) ? rv : 0,
          w: typeof rw === 'number' && isFinite(rw) ? rw : 0
        };
      };
    } catch (e) {
      console.warn("Parse error for vector field:", e);
      return (x, y, z) => ({ u: 0, v: 0, w: 0 });
    }
  }

  // Numerical partial derivatives for client-side calculus visualization
  numericalPartials(fn, h = 0.001) {
    const fx = (x, y, scope) => (fn(x + h, y, scope) - fn(x - h, y, scope)) / (2 * h);
    const fy = (x, y, scope) => (fn(x, y + h, scope) - fn(x, y - h, scope)) / (2 * h);
    return { fx, fy };
  }
}
