"""
Generate premium Windows application icon (.ico and .png)
Features a luxury Windows 11 Fluent rounded squircle with an elegant uppercase serif 'M'.
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_serif_m_icon():
    size = 256
    # Create RGBA canvas
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Base Squircle / Rounded Rect
    padding = 12
    rect = [padding, padding, size - padding, size - padding]
    radius = 54

    # Background gradient: deep sapphire to royal fluent blue
    # Create mask for gradient
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(rect, radius=radius, fill=255)

    # Render vertical linear gradient
    gradient = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for y in range(size):
        # Progress 0.0 to 1.0
        ratio = y / size
        # Top: #0078d4 (0, 120, 212) -> Bottom: #004578 (0, 69, 120)
        r = int(0 * (1 - ratio) + 0 * ratio)
        g = int(130 * (1 - ratio) + 55 * ratio)
        b = int(230 * (1 - ratio) + 140 * ratio)
        for x in range(size):
            gradient.putpixel((x, y), (r, g, b, 255))

    # Apply rounded rect mask to gradient
    img.paste(gradient, (0, 0), mask)

    # 2. Subtle Top highlight / inner border
    border_draw = ImageDraw.Draw(img)
    border_draw.rounded_rectangle(rect, radius=radius, outline=(255, 255, 255, 45), width=2)

    # 3. Load Uppercase Serif Font for 'M'
    font_paths = [
        r"C:\Windows\Fonts\georgiab.ttf",
        r"C:\Windows\Fonts\timesbd.ttf",
        r"C:\Windows\Fonts\cambriab.ttf"
    ]
    font = None
    for fp in font_paths:
        if os.path.exists(fp):
            font = ImageFont.truetype(fp, 146)
            break
    if not font:
        font = ImageFont.load_default()

    text = "M"

    # Precise text centering using bounding box
    bbox = font.getbbox(text)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    # Center coordinates with optical alignment
    x = (size - text_width) / 2 - bbox[0]
    y = (size - text_height) / 2 - bbox[1] - 4

    # 4. Drop Shadow for Letter 'M'
    shadow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_img)
    shadow_draw.text((x, y + 4), text, font=font, fill=(0, 20, 50, 140))
    shadow_blurred = shadow_img.filter(ImageFilter.GaussianBlur(radius=3))
    img.alpha_composite(shadow_blurred)

    # 5. Crisp Foreground White Serif 'M'
    text_draw = ImageDraw.Draw(img)
    text_draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))

    # Save PNG
    png_path = "app_icon.png"
    img.save(png_path, "PNG")
    print(f"Saved {png_path}")

    # Also save to web_dist/app_icon.png and src/app_icon.png
    os.makedirs("web_dist", exist_ok=True)
    img.save(os.path.join("web_dist", "app_icon.png"), "PNG")

    # Save multi-resolution .ico
    ico_path = "app_icon.ico"
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    img.save(ico_path, format="ICO", sizes=sizes)
    print(f"Saved {ico_path} with sizes {sizes}")

if __name__ == "__main__":
    create_serif_m_icon()
