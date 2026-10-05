"""
High Performance Video Exporter using FFmpeg.
Converts canvas frames or video streams into crisp .mp4 (H.264 / AAC) files.
"""

import os
import sys
import subprocess
import shutil
import base64
from typing import Optional, Callable

class VideoExporter:
    def __init__(self):
        self.ffmpeg_path = self._find_ffmpeg()
        self.current_process: Optional[subprocess.Popen] = None
        self.output_file: Optional[str] = None

    def _find_ffmpeg(self) -> str:
        """Find ffmpeg in PATH or common Windows install paths."""
        # 1. Check PATH
        path_in_env = shutil.which("ffmpeg")
        if path_in_env:
            return path_in_env

        # 2. Known local path on user machine
        known_paths = [
            r"D:\Download Program\ffmpeg-8.1.2-essentials_build\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe",
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"
        ]
        for p in known_paths:
            if os.path.exists(p):
                return p
        return "ffmpeg"

    def start_frame_recording(self, output_path: str, width: int = 1920, height: int = 1080, fps: int = 60, crf: int = 18) -> bool:
        """Start an ffmpeg pipe process to receive raw PNG frames."""
        try:
            self.output_file = output_path
            # Ensure width and height are even for h264 yuv420p
            width = width if width % 2 == 0 else width - 1
            height = height if height % 2 == 0 else height - 1

            cmd = [
                self.ffmpeg_path,
                "-y",                          # overwrite output
                "-f", "image2pipe",            # input format
                "-vcodec", "png",              # incoming frame format
                "-r", str(fps),                # input frame rate
                "-i", "-",                     # read from stdin pipe
                "-c:v", "libx264",             # h264 encoder
                "-pix_fmt", "yuv420p",         # standard pixel format compatible everywhere
                "-preset", "fast",             # encoding speed preset
                "-crf", str(crf),              # constant rate factor (18 is visually lossless)
                "-movflags", "+faststart",     # web-optimized mp4
                output_path
            ]
            
            self.current_process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            return True
        except Exception as e:
            print(f"Error starting ffmpeg: {e}", file=sys.stderr)
            return False

    def write_frame_base64(self, b64_data: str) -> bool:
        """Write a base64 encoded PNG frame into the ffmpeg stdin pipe."""
        if not self.current_process or not self.current_process.stdin:
            return False
        try:
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            frame_bytes = base64.b64decode(b64_data)
            self.current_process.stdin.write(frame_bytes)
            return True
        except Exception as e:
            print(f"Error writing frame: {e}", file=sys.stderr)
            return False

    def finish_recording(self) -> dict:
        """Close ffmpeg stdin pipe and wait for video generation to complete."""
        if not self.current_process:
            return {"success": False, "error": "No active recording process"}
        try:
            self.current_process.stdin.close()
            _, stderr_data = self.current_process.communicate(timeout=60)
            ret_code = self.current_process.returncode
            self.current_process = None

            if ret_code == 0 and self.output_file and os.path.exists(self.output_file):
                file_size = os.path.getsize(self.output_file)
                return {
                    "success": True,
                    "output_path": self.output_file,
                    "file_size_mb": round(file_size / (1024 * 1024), 2)
                }
            else:
                return {
                    "success": False,
                    "error": f"FFmpeg error (code {ret_code}): {stderr_data.decode('utf-8', errors='ignore')[-500:]}"
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def convert_webm_to_mp4(self, webm_bytes: bytes, output_path: str) -> dict:
        """Convert a WebM container video directly to standard MP4."""
        temp_webm = output_path + ".temp.webm"
        try:
            with open(temp_webm, "wb") as f:
                f.write(webm_bytes)
            
            cmd = [
                self.ffmpeg_path,
                "-y",
                "-i", temp_webm,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-preset", "fast",
                "-crf", "18",
                "-movflags", "+faststart",
                output_path
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            if res.returncode == 0 and os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                return {
                    "success": True,
                    "output_path": output_path,
                    "file_size_mb": round(file_size / (1024 * 1024), 2)
                }
            else:
                return {
                    "success": False,
                    "error": res.stderr.decode('utf-8', errors='ignore')[-500:]
                }
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            if os.path.exists(temp_webm):
                try:
                    os.remove(temp_webm)
                except Exception:
                    pass

if __name__ == "__main__":
    exp = VideoExporter()
    print("Found FFmpeg:", exp.ffmpeg_path)
