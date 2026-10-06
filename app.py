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
import threading
import ctypes
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

def get_primary_screen_size():
    """Return (width, height) of the primary screen in logical pixels."""
    try:
        user32 = ctypes.windll.user32
        return int(user32.GetSystemMetrics(0)), int(user32.GetSystemMetrics(1))
    except Exception:
        return 2560, 1600

class NativeMathApi:
    def __init__(self):
        self.calculus = CalculusEngine()
        self.exporter = VideoExporter()
        self.presets_file = os.path.join(os.path.expanduser("~"), ".math_function_presets.json")
        self.projects_dir = os.path.join(os.path.expanduser("~"), "MathStudio", "Projects")
        self.layout_file = os.path.join(os.path.expanduser("~"), ".math_studio_layout.json")
        self._window = None
        self._loading_window = None
        self._loading_finished = False
        self._loading_lock = threading.Lock()

    def set_window(self, win):
        self._window = win

    def set_loading_window(self, win):
        self._loading_window = win

    def finish_loading(self):
        """Reveal the main window and close the splash (idempotent).

        Called both from the splash page's JS bridge and from a Python watchdog
        thread, so the splash always terminates even if the JS bridge fails.
        """
        with self._loading_lock:
            if self._loading_finished:
                return
            self._loading_finished = True

        print("[loading] finish_loading called", flush=True)
        try:
            if self._window:
                print("[loading] showing main window", flush=True)
                self._window.show()
                print("[loading] main window shown", flush=True)
        except Exception as e:
            print("[loading] show error:", e, flush=True)
        try:
            if self._loading_window:
                print("[loading] destroying splash", flush=True)
                self._loading_window.destroy()
                print("[loading] splash destroyed", flush=True)
        except Exception as e:
            print("[loading] destroy error:", e, flush=True)

    # --- Workspace Layout Persistence ---
    def load_layout(self):
        """Load the persisted workspace layout, if present."""
        try:
            if os.path.exists(self.layout_file):
                with open(self.layout_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print("Error loading layout:", e)
        return {}

    def save_layout(self, layout):
        """Persist the workspace layout to a JSON file in the user profile."""
        try:
            with open(self.layout_file, "w", encoding="utf-8") as f:
                json.dump(layout, f, ensure_ascii=False, indent=2)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

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
        if not self._window:
            return {"success": False, "error": "No window available"}
        try:
            directory = self._ensure_projects_dir()
            result = self._window.create_file_dialog(
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
                if not self._window:
                    return {"success": False, "error": "No window available"}
                default_name = (project.get("name") or "project") + ".mathstudio.json"
                result = self._window.create_file_dialog(
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
        if not self._window:
            return ""
        try:
            result = self._window.create_file_dialog(
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

class LoadingBridge:
    """Minimal JS bridge exposed only to the splash window.

    Keeps NO references to Window objects as public attributes, so pywebview's
    JS-API introspection never recurses into native WinForms/WebView2 controls
    (which previously produced a flood of "recursion depth / UI thread" errors
    and left the splash unable to signal completion).
    """

    def __init__(self, finish_callback):
        self._finish_callback = finish_callback

    def finish_loading(self):
        self._finish_callback()


def main():
    api = NativeMathApi()

    # Path to frontend html
    html_path = get_asset_path(os.path.join("web_dist", "index.html"))
    if not os.path.exists(html_path):
        # Fallback to dev dist or src
        html_path = get_asset_path(os.path.join("dist", "index.html"))
        if not os.path.exists(html_path):
            html_path = get_asset_path(os.path.join("src", "index.html"))

    # Path to the splash / loading screen (video + progress bar).
    loading_html_path = get_asset_path("loading.html")
    if not os.path.exists(loading_html_path):
        loading_html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "loading.html")

    # Main application window is created FIRST so it is pywebview's "master"
    # window (the app exits when it closes). It is created hidden and fully
    # loads in the background while the splash screen plays, so the user never
    # sees the not-yet-ready main window.
    main_window = webview.create_window(
        title="Math Studio - Windows 11 Fluent Edition",
        url=f"file://{os.path.normpath(html_path)}",
        js_api=api,
        width=1380,
        height=880,
        min_size=(1020, 680),
        background_color='#1f1f1f',
        text_select=True,
        zoomable=True,
        hidden=True
    )
    api.set_window(main_window)

    # Splash / loading window (child) — shown immediately, frameless and centered.
    # It is sized to 1/8 of the screen AREA while keeping the 4:3 layout
    # (16:9 video on top + black progress strip below).
    screen_w, screen_h = get_primary_screen_size()
    area = (screen_w * screen_h) / 8.0
    loading_h = max(240, int((area * 3.0 / 4.0) ** 0.5))
    loading_w = max(320, int(loading_h * 4.0 / 3.0))
    loading_x = (screen_w - loading_w) // 2
    loading_y = (screen_h - loading_h) // 2
    print(
        f"[loading] screen={screen_w}x{screen_h} splash={loading_w}x{loading_h} "
        f"pos=({loading_x},{loading_y})",
        flush=True,
    )

    loading_window = webview.create_window(
        title="Math Studio",
        url=f"file://{os.path.normpath(loading_html_path)}",
        js_api=LoadingBridge(api.finish_loading),
        width=loading_w,
        height=loading_h,
        x=loading_x,
        y=loading_y,
        resizable=False,
        frameless=True,
        on_top=True,
        background_color='#000000'
    )
    api.set_loading_window(loading_window)

    # Python watchdog: if the splash page's JS bridge never fires (for any
    # reason), force-complete the hand-off after a short grace period so the
    # app can never be left stuck on the loading animation.
    def watchdog():
        time.sleep(6.5)
        api.finish_loading()

    webview.start(func=watchdog, debug=False, gui='edgechromium')


if __name__ == "__main__":
    main()
