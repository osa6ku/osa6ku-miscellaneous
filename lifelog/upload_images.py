#!/usr/bin/env python3
"""
Upload converted JPG images to Google Drive journal_images/YYYY-MM/ folders.
Uses `gdrive` CLI with thread-pool concurrency and checkpointing for resumability.
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

ID_RE = re.compile(r"\(ID:\s*([^)]+)\)")

JOURNAL_IMAGES_FOLDER_ID = "1kPfAX4TvDpMwokoinA2ga-nCwoePkLyo"
PARSED_JSON = "/tmp/lifelog_work/parsed_entries.json"
UPLOADED_JSON = "/tmp/lifelog_work/uploaded_images.json"
FOLDERS_JSON = "/tmp/lifelog_work/ym_folders.json"


def ensure_ym_folders(year_months: list[str]) -> dict[str, str]:
    """Ensure YYYY-MM subfolders exist under journal_images and return {ym: folder_id}."""
    existing = {}
    res = subprocess.run(
        ["gdrive", "readonly", "ls", JOURNAL_IMAGES_FOLDER_ID, "--json"],
        capture_output=True, text=True, check=True
    )
    for item in json.loads(res.stdout or "[]"):
        if item.get("mimeType") == "application/vnd.google-apps.folder":
            existing[item["name"]] = item["id"]

    folders = dict(existing)
    for ym in sorted(year_months):
        if ym not in folders:
            out = subprocess.run(
                ["gdrive", "mutate", "mkdir", ym, "--parent", JOURNAL_IMAGES_FOLDER_ID],
                capture_output=True, text=True, check=True
            )
            m = ID_RE.search(out.stdout)
            if not m:
                raise RuntimeError(f"Could not parse folder ID from: {out.stdout}")
            fid = m.group(1).strip()
            folders[ym] = fid
            print(f"Created folder {ym}: {fid}")
    return folders


def upload_one(task: tuple[str, str, str]) -> tuple[str, dict | None, str]:
    """Upload a single JPG file with retries."""
    jpg_name, local_path, folder_id = task
    for attempt in range(3):
        try:
            res = subprocess.run(
                ["gdrive", "mutate", "upload", local_path, "--parent", folder_id],
                capture_output=True, text=True, check=True
            )
            m = ID_RE.search(res.stdout)
            if not m:
                raise RuntimeError(f"Could not parse file ID from: {res.stdout}")
            fid = m.group(1).strip()
            return jpg_name, {
                "id": fid,
                "name": jpg_name,
                "url": f"https://drive.google.com/file/d/{fid}/view",
            }, "ok"
        except Exception as e:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
            else:
                return jpg_name, None, str(e)
    return jpg_name, None, "unknown"


def main():
    with open(PARSED_JSON, encoding="utf-8") as fp:
        entries = json.load(fp)

    year_months = sorted({e["year_month"] for e in entries if e["images"]})
    folders = ensure_ym_folders(year_months)
    with open(FOLDERS_JSON, "w", encoding="utf-8") as fp:
        json.dump(folders, fp, ensure_ascii=False, indent=2)

    uploaded = {}
    if os.path.exists(UPLOADED_JSON):
        with open(UPLOADED_JSON, encoding="utf-8") as fp:
            uploaded = json.load(fp)

    tasks = []
    for e in entries:
        ym = e["year_month"]
        fid = folders[ym]
        for img in e["images"]:
            jname = img["jpg_name"]
            if jname not in uploaded:
                tasks.append((jname, img["local_jpg_path"], fid))

    print(f"Already uploaded: {len(uploaded)}, remaining to upload: {len(tasks)}")
    if not tasks:
        return

    ok = fail = 0
    with ThreadPoolExecutor(max_workers=12) as ex:
        futures = [ex.submit(upload_one, t) for t in tasks]
        for i, fut in enumerate(as_completed(futures), start=1):
            jname, data, msg = fut.result()
            if data:
                uploaded[jname] = data
                ok += 1
            else:
                fail += 1
                print(f"FAIL {jname}: {msg}")
            if i % 200 == 0 or i == len(tasks):
                with open(UPLOADED_JSON, "w", encoding="utf-8") as fp:
                    json.dump(uploaded, fp, ensure_ascii=False, indent=2)
                print(f"Upload progress: {i}/{len(tasks)} (ok={ok}, fail={fail})")


if __name__ == "__main__":
    main()
