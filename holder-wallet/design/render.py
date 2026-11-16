"""Render the wallet's artwork from the SVG sources in svg/ (README.md).

Every PNG the app ships - launcher icons, the native and in-app
splash, the onboarding illustrations, the in-app mark - is drawn here, so
changing the brand is an edit to svg/ or src/shared/constants/brand.ts and one run:

    python3 design/render.py

Chrome (headless) does the drawing: it renders SVG and the Inter wordmark
exactly, and it is on every developer's machine already.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DESIGN = Path(__file__).resolve().parent
WALLET = DESIGN.parent
IMAGES = WALLET / "src" / "assets" / "images"
FONTS = WALLET / "src" / "assets" / "fonts"
RES = WALLET / "android" / "app" / "src" / "main" / "res"
# Keep the checked-in iOS icon and launch artwork on the same SVG sources as Android.
IOS_ASSETS = WALLET / "ios" / "atestwallet" / "Images.xcassets"

CHROME_CANDIDATES = [
    os.environ.get("CHROME", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
    "chromium-browser",
]

# Android densities: (qualifier, scale over mdpi).
DENSITIES = [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]

def brand() -> dict:
    """NAME and TAGLINE from src/shared/constants/brand.ts - the app's single source."""
    text = (WALLET / "src" / "shared" / "constants" / "brand.ts").read_text(encoding="utf-8")
    found = dict(re.findall(r"(NAME|TAGLINE):\s*'([^']*)'", text))
    if set(found) != {"NAME", "TAGLINE"}:
        sys.exit("brand.ts must define NAME and TAGLINE as single-quoted strings")
    return found

def chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if candidate and (Path(candidate).exists() or shutil.which(candidate)):
            return candidate
    sys.exit("Chrome or Chromium is needed; set CHROME to its binary")

def font_faces() -> str:
    faces = []
    for weight, name in ((400, "Inter-Regular.ttf"), (600, "Inter-SemiBold.ttf"), (700, "Inter-Bold.ttf")):
        data = base64.b64encode((FONTS / name).read_bytes()).decode()
        faces.append(
            f"@font-face{{font-family:Inter;font-weight:{weight};"
            f"src:url(data:font/ttf;base64,{data}) format('truetype')}}"
        )
    return "".join(faces)

def svg(name: str, names: dict) -> str:
    source = (DESIGN / "svg" / f"{name}.svg").read_text(encoding="utf-8")
    defs = (DESIGN / "svg" / "_defs.svgfrag").read_text(encoding="utf-8")
    return (
        source.replace("<!--DEFS-->", defs)
        .replace("<!--BRAND-->", names["NAME"])
        .replace("<!--TAGLINE-->", names["TAGLINE"])
    )

def render(binary: str, workdir: Path, markup: str, width: int, height: int, out: Path) -> None:
    page = workdir / "page.html"
    page.write_text(
        "<!doctype html><meta charset=utf-8><style>"
        + font_faces()
        + "html,body{margin:0;padding:0;background:transparent;overflow:hidden}"
        + f"svg{{display:block;width:{width}px;height:{height}px}}"
        + "</style>"
        + markup,
        encoding="utf-8",
    )
    shot = workdir / "shot.png"
    shot.unlink(missing_ok=True)
    # Chrome writes the screenshot and then, on some machines, never exits:
    # wait for the file to be complete and stop it ourselves.
    process = subprocess.Popen(
        [
            binary,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={width},{height}",
            "--virtual-time-budget=2000",
            f"--user-data-dir={workdir / 'profile'}",
            f"--screenshot={shot}",
            page.as_uri(),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        deadline, last = time.monotonic() + 60, -1
        while time.monotonic() < deadline:
            size = shot.stat().st_size if shot.exists() else -1
            if size > 0 and size == last:
                break
            if process.poll() is not None and size <= 0:
                sys.exit(f"Chrome exited without rendering {out.name}")
            last = size
            time.sleep(0.4)
        else:
            sys.exit(f"Chrome did not render {out.name} within a minute")
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=10)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(shot, out)
    shown = out.relative_to(WALLET) if out.is_relative_to(WALLET) else out
    print(f"  {shown}  {width}x{height}")

def scaled(base: str, suffix: str = "") -> list[tuple[int, str]]:
    """React Native's @1x/@2x/@3x names for one image."""
    return [(1, f"{base}{suffix}.png"), (2, f"{base}{suffix}@2x.png"), (3, f"{base}{suffix}@3x.png")]

def main() -> None:
    names = brand()
    binary = chrome()
    jobs: list[tuple[str, int, int, Path]] = []

    # In the app (src/shared/constants/urlImages.ts).
    for factor, file in scaled("brand-mark"):
        jobs.append(("mark", 96 * factor, 96 * factor, IMAGES / file))
    for factor, file in scaled("splash-logo"):
        jobs.append(("logo-lockup", 240 * factor, round(240 * factor * 560 / 720), IMAGES / file))
    for n in (1, 2, 3, 4):
        for factor, file in scaled(f"onboarding-{n}"):
            jobs.append((f"onboarding-{n}", 300 * factor, 260 * factor, IMAGES / file))
    # One size: it covers the screen, which is larger than any @3x of a small one.
    jobs.append(("background", 1080, 2340, IMAGES / "brand-background.png"))
    # Expo's app.json (a prebuild regenerates the native icons from these).
    jobs.append(("icon", 1024, 1024, IMAGES / "icon.png"))
    jobs.append(("adaptive-foreground", 1024, 1024, IMAGES / "adaptive-icon.png"))
    jobs.append(("icon", 48, 48, IMAGES / "favicon.png"))

    # Android: launcher icons (48 dp legacy, 108 dp adaptive foreground) and the
    # pre-Android-12 splash image (drawable/splashscreen.xml, 240 dp wide).
    for qualifier, scale in DENSITIES:
        legacy, adaptive, splash = round(48 * scale), round(108 * scale), round(240 * scale)
        jobs.append(("icon", legacy, legacy, RES / f"mipmap-{qualifier}" / "ic_launcher.png"))
        jobs.append(("icon-round", legacy, legacy, RES / f"mipmap-{qualifier}" / "ic_launcher_round.png"))
        jobs.append(("adaptive-foreground", adaptive, adaptive, RES / f"mipmap-{qualifier}" / "ic_launcher_foreground.png"))
        jobs.append(("adaptive-background", adaptive, adaptive, RES / f"mipmap-{qualifier}" / "ic_launcher_background.png"))
        jobs.append(("logo-lockup", splash, round(splash * 560 / 720), RES / f"drawable-{qualifier}" / "splashscreen_image.png"))
    # iOS: the opaque App Store icon and a 240-point launch-screen lockup at
    # every asset-catalog scale. SplashScreen.storyboard supplies the navy background.
    jobs.append(("icon", 1024, 1024, IOS_ASSETS / "AppIcon.appiconset" / "App-Icon-1024x1024@1x.png"))
    for factor, file in scaled("image"):
        jobs.append((
            "logo-lockup",
            240 * factor,
            round(240 * factor * 560 / 720),
            IOS_ASSETS / "SplashScreen.imageset" / file,
        ))

    print(f"Rendering {len(jobs)} images for \"{names['NAME']}\"")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for source, width, height, out in jobs:
            render(binary, work, svg(source, names), width, height, out)

if __name__ == "__main__":
    main()
