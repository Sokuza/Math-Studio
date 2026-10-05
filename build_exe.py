"""
Packaging script for 'Math Studio.exe' using PyInstaller.
Builds a standalone executable containing the full Windows 11 Fluent UI, SymPy engine, and FFmpeg pipeline,
equipped with the serif uppercase 'M' application icon.
"""

import os
import sys
import shutil
import subprocess

def build():
    # 0. Clean previous binaries
    for old_exe in ["数学函数表达式工具.exe", "Math Studio.exe"]:
        if os.path.exists(old_exe):
            try:
                os.remove(old_exe)
                print(f"Removed old binary: {old_exe}")
            except Exception as e:
                print(f"Notice: {e}")

    # 1. Regenerate icon if needed
    if not os.path.exists("app_icon.ico"):
        print("Generating serif M icon...")
        subprocess.run([sys.executable, "generate_icon.py"])

    print("=== Step 1: Rebuilding frontend assets ===")
    res = subprocess.run(["node", "build_frontend.js"], capture_output=True, text=True)
    print(res.stdout)
    if res.returncode != 0:
        print("Frontend build failed:", res.stderr)
        return False

    print("=== Step 2: Compiling Math Studio with PyInstaller ===")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name=Math Studio",
        "--icon=app_icon.ico",
        "--onefile",
        "--windowed",
        "--noconfirm",
        "--clean",
        "--add-data=web_dist;web_dist",
        "--add-data=app_icon.ico;.",
        "--add-data=app_icon.png;.",
        "--collect-all=webview",
        "--collect-all=clr_loader",
        "--collect-all=pythonnet",
        "--collect-all=sympy",
        "--collect-all=mpmath",
        "--hidden-import=calculus_engine",
        "--hidden-import=video_exporter",
        "--distpath=.",
        "app.py"
    ]

    print("Executing:", " ".join(cmd))
    res = subprocess.run(cmd)
    if res.returncode != 0:
        print("PyInstaller error:", res.returncode)
        return False

    target_exe = os.path.join(".", "Math Studio.exe")
    if os.path.exists(target_exe):
        size_mb = round(os.path.getsize(target_exe) / (1024 * 1024), 2)
        print(f"\n==================================================")
        print(f" SUCCESS! Generated: {target_exe} ({size_mb} MB)")
        print(f" Icon: Uppercase serif 'M' embedded")
        print(f"==================================================")
        return True
    else:
        print("Target executable not found.")
        return False

if __name__ == "__main__":
    build()
