"""Generate the rounded Math Studio PNG and multi-resolution Windows icon."""

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


def generate_icon(source: Path, output: Path) -> None:
    size = 1024
    with Image.open(source) as original:
        artwork = ImageOps.fit(original.convert("RGBA"), (size, size), Image.Resampling.LANCZOS)

    mask = Image.new("L", artwork.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=225, fill=255)
    artwork.putalpha(ImageChops.multiply(artwork.getchannel("A"), mask))

    icon = artwork.resize((256, 256), Image.Resampling.LANCZOS)
    icon.save(output / "app_icon.png")
    icon.save(
        output / "app_icon.ico",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        type=Path,
        nargs="?",
        default=Path(r"C:\Picture and Screenshot\App icon\Math Studio Icon Adjusted.png"),
    )
    generate_icon(parser.parse_args().source, Path(__file__).resolve().parent)
