#!/usr/bin/env python3
"""
Parse Apple Journal HTML exports and convert/resize attached images to JPG.
"""
import glob
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup

BASE_DIR = "/tmp/lifelog_work/AppleJournalEntries"
ENTRIES_DIR = os.path.join(BASE_DIR, "Entries")
RESOURCES_DIR = os.path.join(BASE_DIR, "Resources")
OUT_DIR = "/tmp/lifelog_work/converted_images"
PARSED_JSON = "/tmp/lifelog_work/parsed_entries.json"

IMAGE_EXTS = {".heic", ".heif", ".jpeg", ".jpg", ".png"}
WEEKDAY_MAP = {
    "月曜日": "月", "火曜日": "火", "水曜日": "水", "木曜日": "木",
    "金曜日": "金", "土曜日": "土", "日曜日": "日",
}


def parse_index_titles(index_path: str) -> dict[str, str]:
    """Extract fallback titles from index.html keyed by entry basename."""
    titles = {}
    if not os.path.exists(index_path):
        return titles
    soup = BeautifulSoup(open(index_path, encoding="utf-8").read(), "html.parser")
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if href.startswith("Entries/"):
            fname = os.path.basename(href)
            txt = a.get_text(strip=True)
            if " — " in txt:
                titles[fname] = txt.split(" — ", 1)[1].strip()
    return titles


def parse_entry(html_path: str, index_titles: dict[str, str]) -> dict:
    """Parse a single Apple Journal HTML entry."""
    fname = os.path.basename(html_path)
    soup = BeautifulSoup(open(html_path, encoding="utf-8").read(), "html.parser")

    # Date & weekday from pageHeader (e.g. "2023年12月12日 火曜日")
    ph = soup.select_one("div.pageHeader")
    ph_text = ph.get_text(strip=True) if ph else ""
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\S+))?", ph_text)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        date_str = f"{year:04d}-{month:02d}-{day:02d}"
        weekday_raw = m.group(4) or ""
        weekday = WEEKDAY_MAP.get(weekday_raw, weekday_raw)
    else:
        # Fallback to filename prefix YYYY-MM-DD
        fm = re.match(r"(\d{4}-\d{2}-\d{2})", fname)
        date_str = fm.group(1) if fm else "1970-01-01"
        weekday = ""

    # Title: div.title or sibling span.s2 inside p.p1, or index.html fallback
    title = ""
    title_div = soup.select_one("div.title")
    if title_div and title_div.get_text(strip=True):
        title = title_div.get_text(strip=True)
    else:
        p1 = soup.select_one("p.p1")
        if p1:
            # Check direct span children after div.title (outside pageContainer)
            for sp in p1.find_all("span", class_="s2", recursive=False):
                t = sp.get_text(strip=True)
                if t:
                    title = t
                    break
    if not title:
        title = index_titles.get(fname, "")

    # Reflection prompt (if any)
    prompt_div = soup.select_one("div.reflectionPrompt")
    prompt_text = prompt_div.get_text(strip=True) if prompt_div else ""

    # Body text: div.bodyText + p.p2 (and any other p outside p1)
    body_parts = []
    if prompt_text:
        body_parts.append(f"[プロンプト] {prompt_text}")
    bt_div = soup.select_one("div.bodyText")
    if bt_div and bt_div.get_text(strip=True):
        body_parts.append(bt_div.get_text("\n", strip=True))
    for p in soup.body.find_all("p", recursive=False) if soup.body else []:
        if "p1" in (p.get("class") or []):
            continue
        txt = p.get_text("\n", strip=True)
        if txt:
            body_parts.append(txt)
    body = "\n".join(body_parts)

    # Locations from gridItemOverlayFooter
    locations = []
    for loc_div in soup.select("div.gridItemOverlayFooter"):
        loc = loc_div.get_text(strip=True)
        if loc and loc not in locations:
            locations.append(loc)

    # Images from assetGrid
    images = []
    for gi in soup.select("div.gridItem"):
        classes = gi.get("class", [])
        asset_type = next((c.replace("assetType_", "") for c in classes if c.startswith("assetType_")), "other")
        for img in gi.select("img.asset_image"):
            src = img.get("src", "")
            if src.startswith("../Resources/"):
                res_name = src.replace("../Resources/", "")
                ext = os.path.splitext(res_name)[1].lower()
                if ext in IMAGE_EXTS:
                    images.append({
                        "orig_name": res_name,
                        "asset_type": asset_type,
                    })

    return {
        "html_filename": fname,
        "date": date_str,
        "year": date_str[:4],
        "year_month": date_str[:7],
        "weekday": weekday,
        "time": "",
        "title": title,
        "body": body,
        "location": " / ".join(locations),
        "images": images,
    }


def convert_image_task(task: tuple[str, str]) -> tuple[str, bool, str]:
    """Convert and resize (max 1200px, no upscaling) an image to JPG quality 80."""
    src_path, dst_path = task
    if os.path.exists(dst_path) and os.path.getsize(dst_path) > 0:
        return dst_path, True, "cached"
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    try:
        # Query dimensions first to avoid upscaling smaller images
        info = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", src_path],
            capture_output=True, text=True, check=True
        ).stdout
        w = h = 0
        for line in info.splitlines():
            if "pixelWidth:" in line:
                w = int(line.split(":")[-1].strip())
            elif "pixelHeight:" in line:
                h = int(line.split(":")[-1].strip())
        cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "80"]
        if max(w, h) > 1200:
            cmd.extend(["-Z", "1200"])
        cmd.extend([src_path, "--out", dst_path])
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return dst_path, True, "converted"
    except Exception as e:
        return dst_path, False, str(e)


def main():
    index_titles = parse_index_titles(os.path.join(BASE_DIR, "index.html"))
    html_files = sorted(
        f for f in glob.glob(os.path.join(ENTRIES_DIR, "*.html"))
        if not os.path.basename(f).startswith("._")
    )
    entries = [parse_entry(f, index_titles) for f in html_files]
    entries.sort(key=lambda e: (e["date"], e["html_filename"]))

    # Assign normalized JPG filenames and deduplicate collisions
    seen_dst = set()
    convert_tasks = []
    for idx, entry in enumerate(entries, start=1):
        entry["id"] = idx
        date_str = entry["date"]
        ym = entry["year_month"]
        for img in entry["images"]:
            orig_stem = os.path.splitext(img["orig_name"])[0]
            cand_name = f"{date_str}_{orig_stem}.jpg"
            dst_path = os.path.join(OUT_DIR, ym, cand_name)
            suffix = 1
            while dst_path in seen_dst:
                cand_name = f"{date_str}_{orig_stem}_{suffix}.jpg"
                dst_path = os.path.join(OUT_DIR, ym, cand_name)
                suffix += 1
            seen_dst.add(dst_path)
            img["jpg_name"] = cand_name
            img["local_jpg_path"] = dst_path
            src_path = os.path.join(RESOURCES_DIR, img["orig_name"])
            convert_tasks.append((src_path, dst_path))

    print(f"Parsed {len(entries)} entries, {len(convert_tasks)} images to convert.")
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(convert_image_task, t) for t in convert_tasks]
        for i, fut in enumerate(as_completed(futures), start=1):
            dst, success, msg = fut.result()
            if success:
                ok += 1
            else:
                fail += 1
                print(f"FAIL {dst}: {msg}")
            if i % 500 == 0 or i == len(convert_tasks):
                print(f"Image conversion progress: {i}/{len(convert_tasks)} (ok={ok}, fail={fail})")

    with open(PARSED_JSON, "w", encoding="utf-8") as fp:
        json.dump(entries, fp, ensure_ascii=False, indent=2)
    print(f"Saved {PARSED_JSON}")


if __name__ == "__main__":
    main()
