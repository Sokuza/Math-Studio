"""
Main Application Entry Point for "数学函数表达式工具" (Math Function Expression Tool).
Integrates PyWebView with Edge Chromium engine, SymPy calculus backend, and FFmpeg video pipeline.
"""

import os
import sys
import json
import time
import base64
import subprocess
import webview
from calculus_engine import CalculusEngine
from video_exporter import VideoExporter

def get_asset_path(relative_path: str) -> str:
    """Get absolute path to resource, works for dev and for PyInstaller."""
    if hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

class NativeMathApi:
    def __init__(self):
        self.calculus = CalculusEngine()
        self.exporter = VideoExporter()
        self.presets_file = os.path.join(os.path.expanduser("~"), ".math_function_presets.json")
        self.projects_dir = os.path.join(os.path.expanduser("~"), "MathStudio", "Projects")
        self.window = None

    def set_window(self, win):
        self.window = win

    # --- Calculus & Advanced Math Operations ---
    def compute_derivative(self, expr: str, var: str = 'x', order: int = 1, params: dict = None):
        return self.calculus.differentiate(expr, var, order, params)

    def compute_partials(self, expr: str, params: dict = None):
        return self.calculus.partial_derivatives(expr, params)

    def compute_integral(self, expr: str, var: str = 'x', lower = None, upper = None, params: dict = None):
        l_val = float(lower) if lower is not None and str(lower).strip() != '' else None
        u_val = float(upper) if upper is not None and str(upper).strip() != '' else None
        return self.calculus.integrate(expr, var, l_val, u_val, params)

    def compute_taylor(self, expr: str, var: str = 'x', x0: float = 0.0, order: int = 4, params: dict = None):
        return self.calculus.taylor_series(expr, var, x0, order, params)

    # --- Presets Persistence ---
    def load_user_presets(self):
        try:
            if os.path.exists(self.presets_file):
                with open(self.presets_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print("Error loading presets:", e)
        return []

    def save_user_presets(self, presets):
        try:
            with open(self.presets_file, "w", encoding="utf-8") as f:
                json.dump(presets, f, ensure_ascii=False, indent=2)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- Project Persistence (First Page: Project Resource Window) ---
    def _ensure_projects_dir(self) -> str:
        os.makedirs(self.projects_dir, exist_ok=True)
        return self.projects_dir

    def list_projects(self):
        """Scan the projects directory and return saved project metadata."""
        try:
            directory = self._ensure_projects_dir()
            projects = []
            for name in os.listdir(directory):
                if not name.endswith(".mathstudio.json"):
                    continue
                path = os.path.join(directory, name)
                try:
                    st = os.stat(path)
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    project_name = data.get("name") or name[: -len(".mathstudio.json")]
                except Exception:
                    project_name = name[: -len(".mathstudio.json")]
                projects.append({
                    "name": project_name,
                    "path": path,
                    "savedAt": st.st_mtime,
                    "savedAtStr": time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime))
                })
            projects.sort(key=lambda p: p.get("savedAt", 0), reverse=True)
            return projects
        except Exception as e:
            print("Error listing projects:", e)
            return []

    def open_project_dialog(self):
        """Open a native file dialog to select and load a saved project."""
        if not self.window:
            return {"success": False, "error": "No window available"}
        try:
            directory = self._ensure_projects_dir()
            result = self.window.create_file_dialog(
                webview.OPEN_DIALOG,
                directory=directory,
                file_types=("MathStudio 项目 (*.mathstudio.json)", "所有文件 (*.*)")
            )
            path = result[0] if isinstance(result, (list, tuple)) else str(result)
            if not path:
                return {"success": False, "cancelled": True}
            return self.open_project_file(path)
        except Exception as e:
            return {"success": False, "error": str(e)}

    def open_project_file(self, path: str):
        """Load a project JSON file from an explicit path."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["path"] = path
            return {"success": True, "project": data}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def save_project(self, project, path=None):
        """Persist a project to disk, using the provided path or a save dialog."""
        try:
            directory = self._ensure_projects_dir()
            target = path
            if not target:
                if not self.window:
                    return {"success": False, "error": "No window available"}
                default_name = (project.get("name") or "project") + ".mathstudio.json"
                result = self.window.create_file_dialog(
                    webview.SAVE_DIALOG,
                    directory=directory,
                    save_filename=default_name,
                    file_types=("MathStudio 项目 (*.mathstudio.json)", "所有文件 (*.*)")
                )
                target = result[0] if isinstance(result, (list, tuple)) else str(result)
                if not target:
                    return {"success": False, "cancelled": True}
            if not target.endswith(".mathstudio.json"):
                target += ".mathstudio.json"
            with open(target, "w", encoding="utf-8") as f:
                json.dump(project, f, ensure_ascii=False, indent=2)
            return {"success": True, "path": target}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_project(self, path: str):
        try:
            if path and os.path.exists(path):
                os.remove(path)
                return {"success": True}
            return {"success": False, "error": "File not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- Video & File Export ---
    def select_save_path(self, default_name: str = "math_animation.mp4", file_types: str = "MP4 Video (*.mp4)"):
        """Show native Windows save file dialog."""
        if not self.window:
            return ""
        try:
            result = self.window.create_file_dialog(
                webview.SAVE_DIALOG,
                directory=os.path.join(os.path.expanduser("~"), "Videos"),
                save_filename=default_name
            )
            if result:
                if isinstance(result, (list, tuple)):
                    return result[0]
                return str(result)
        except Exception as e:
            print("File dialog error:", e)
        # Fallback to desktop if dialog fails
        return os.path.join(os.path.expanduser("~"), "Desktop", default_name)

    def open_containing_folder(self, file_path: str):
        """Reveal file in Windows Explorer."""
        try:
            if os.path.exists(file_path):
                subprocess.run(['explorer', '/select,', os.path.normpath(file_path)])
                return {"success": True}
            return {"success": False, "error": "File does not exist"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- Frame-by-Frame High-Definition Video Pipeline ---
    def start_video_render(self, output_path: str, width: int = 1920, height: int = 1080, fps: int = 60, crf: int = 18):
        success = self.exporter.start_frame_recording(output_path, width, height, fps, crf)
        return {"success": success}

    def push_video_frame(self, b64_frame: str):
        success = self.exporter.write_frame_base64(b64_frame)
        return {"success": success}

    def finish_video_render(self):
        return self.exporter.finish_recording()

    def convert_webm_data(self, b64_webm: str, output_path: str):
        """Directly convert recorded WebM data from frontend to pristine MP4."""
        try:
            if "," in b64_webm:
                b64_webm = b64_webm.split(",", 1)[1]
            raw_bytes = base64.b64decode(b64_webm)
            return self.exporter.convert_webm_to_mp4(raw_bytes, output_path)
        except Exception as e:
            return {"success": False, "error": str(e)}

def main():
    api = NativeMathApi()
    
    # Path to frontend html
    html_path = get_asset_path(os.path.join("web_dist", "index.html"))
    if not os.path.exists(html_path):
        # Fallback to dev dist or src
        html_path = get_asset_path(os.path.join("dist", "index.html"))
        if not os.path.exists(html_path):
            html_path = get_asset_path(os.path.join("src", "index.html"))

    window = webview.create_window(
        title="Math Studio - Windows 11 Fluent Edition",
        url=f"file://{os.path.normpath(html_path)}",
        js_api=api,
        width=1380,
        height=880,
        min_size=(1020, 680),
        background_color='#1f1f1f',
        text_select=True,
        zoomable=True
    )
    api.set_window(window)
    webview.start(debug=False, gui='edgechromium')

if __name__ == "__main__":
    main()
