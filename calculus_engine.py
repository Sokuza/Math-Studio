"""
Calculus Engine using SymPy for symbolic math operations.
Provides differentiation, partial derivatives, integration, Taylor expansion, and LaTeX formatting.
"""

import sympy as sp
from typing import Dict, Any, Optional

class CalculusEngine:
    def __init__(self):
        self.x, self.y, self.z, self.t, self.u, self.v = sp.symbols('x y z t u v', real=True)
        self.symbols_dict = {
            'x': self.x, 'y': self.y, 'z': self.z,
            't': self.t, 'u': self.u, 'v': self.v,
            'pi': sp.pi, 'e': sp.E
        }

    def _parse_expr(self, expr_str: str, custom_params: Optional[Dict[str, float]] = None):
        """Parse mathematical expression into a SymPy expression."""
        clean_expr = expr_str.strip().replace('^', '**')
        # Add custom parameters if any
        local_dict = dict(self.symbols_dict)
        if custom_params:
            for k in custom_params:
                if k not in local_dict:
                    local_dict[k] = sp.symbols(k, real=True)
        return sp.sympify(clean_expr, locals=local_dict)

    def differentiate(self, expr_str: str, var: str = 'x', order: int = 1, params: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Compute symbolic derivative."""
        try:
            expr = self._parse_expr(expr_str, params)
            target_var = sp.symbols(var, real=True)
            diff_expr = sp.diff(expr, target_var, order)
            
            return {
                "success": True,
                "expression": expr_str,
                "variable": var,
                "order": order,
                "result_str": str(diff_expr).replace('**', '^'),
                "latex": sp.latex(diff_expr),
                "original_latex": sp.latex(expr)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def partial_derivatives(self, expr_str: str, params: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Compute partial derivatives dz/dx, dz/dy and gradient vector for 3D surfaces."""
        try:
            expr = self._parse_expr(expr_str, params)
            dz_dx = sp.diff(expr, self.x)
            dz_dy = sp.diff(expr, self.y)
            dz_dx2 = sp.diff(dz_dx, self.x)
            dz_dy2 = sp.diff(dz_dy, self.y)
            dz_dxdy = sp.diff(dz_dx, self.y)
            
            return {
                "success": True,
                "dz_dx": str(dz_dx).replace('**', '^'),
                "dz_dy": str(dz_dy).replace('**', '^'),
                "dz_dx_latex": sp.latex(dz_dx),
                "dz_dy_latex": sp.latex(dz_dy),
                "hessian": {
                    "f_xx": str(dz_dx2).replace('**', '^'),
                    "f_yy": str(dz_dy2).replace('**', '^'),
                    "f_xy": str(dz_dxdy).replace('**', '^'),
                    "f_xx_latex": sp.latex(dz_dx2),
                    "f_yy_latex": sp.latex(dz_dy2),
                    "f_xy_latex": sp.latex(dz_dxdy)
                },
                "gradient_latex": f"\\nabla f = \\left( {sp.latex(dz_dx)}, \\, {sp.latex(dz_dy)} \\right)"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def integrate(self, expr_str: str, var: str = 'x', lower: Optional[float] = None, upper: Optional[float] = None, params: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Compute indefinite or definite integral."""
        try:
            expr = self._parse_expr(expr_str, params)
            target_var = sp.symbols(var, real=True)
            
            if lower is not None and upper is not None:
                # Definite integral
                integral_res = sp.integrate(expr, (target_var, lower, upper))
                numeric_val = float(integral_res.evalf()) if integral_res.is_number else None
                latex_repr = f"\\int_{{{lower}}}^{{{upper}}} {sp.latex(expr)} \\, d{var} = {sp.latex(integral_res)}"
                return {
                    "success": True,
                    "is_definite": True,
                    "lower": lower,
                    "upper": upper,
                    "result_str": str(integral_res).replace('**', '^'),
                    "numeric_val": numeric_val,
                    "latex": latex_repr
                }
            else:
                # Indefinite integral
                integral_res = sp.integrate(expr, target_var)
                latex_repr = f"\\int {sp.latex(expr)} \\, d{var} = {sp.latex(integral_res)} + C"
                return {
                    "success": True,
                    "is_definite": False,
                    "result_str": str(integral_res).replace('**', '^'),
                    "latex": latex_repr
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def taylor_series(self, expr_str: str, var: str = 'x', x0: float = 0.0, order: int = 4, params: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Compute Taylor series expansion around x0."""
        try:
            expr = self._parse_expr(expr_str, params)
            target_var = sp.symbols(var, real=True)
            series = expr.series(target_var, x0, order).removeO()
            
            return {
                "success": True,
                "result_str": str(series).replace('**', '^'),
                "latex": sp.latex(series)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

if __name__ == "__main__":
    eng = CalculusEngine()
    print("Derivative test:", eng.differentiate("sin(x*t) * exp(-x**2)", "x"))
    print("Partials test:", eng.partial_derivatives("x**2 * y + sin(y)"))
    print("Integrate test:", eng.integrate("x**2 + cos(x)", "x", 0, 3.14159))
