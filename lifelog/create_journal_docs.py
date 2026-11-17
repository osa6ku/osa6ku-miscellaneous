#!/usr/bin/env python3
"""
Populate yearly archive Google Docs (2023-2026) in journal_docs folder.
Uses `gdocs mutate batch` for fast, styled single-API-call document generation,
and optionally embeds inline photos via `gdocs mutate insert-image-from-file`.
"""
import argparse
import json
import os
import subprocess

PARSED_JSON = "/tmp/lifelog_work/parsed_entries.json"
UPLOADED_JSON = "/tmp/lifelog_work/uploaded_images.json"

YEAR_DOC_IDS = {
    "2023": "1kq2hbOtbA_oMDdZ9V1Zfduw8gXG3YhQr5K_HS-NfCr8",
    "2024": "1zw5PJeGd0Ez5Z53Q9L337hwqB_zRzEHPn-ti6tsj8l8",
    "2025": "1ad_I1JPnJyvkiIdL_2tAjDA0bearBM5mld9I0bzXyg8",
    "2026": "114VekVP1Atik_cds8n_0N6rXmqRjO9l8GvETh570zKI",
}


def build_batch_ops(year: str, year_entries: list[dict], uploaded: dict) -> list[dict]:
    """Build gdocs mutate batch operations for a single year."""
    first_date = year_entries[0]["date"]
    last_date = year_entries[-1]["date"]
    ops = [
        {"op": "heading", "level": "TITLE", "text": f"日記アーカイブ {year}年"},
        {
            "op": "heading",
            "level": "SUBTITLE",
            "text": f"収録件数: {len(year_entries)}件（{first_date} 〜 {last_date}）",
        },
        {"op": "horizontal-rule"},
    ]

    for e in year_entries:
        title_part = e["title"] if e["title"] else "(無題)"
        weekday_part = f"({e['weekday']})" if e["weekday"] else ""
        heading_text = f"{e['date']} {weekday_part} — {title_part}".strip()
        ops.append({"op": "heading", "level": "2", "text": heading_text, "space_above": 12, "space_below": 4})

        if e["location"]:
            ops.append({
                "op": "append",
                "text": f"📍 場所: {e['location']}",
                "italic": True,
                "font_size": 9,
                "text_color": "#5F6368",
                "space_below": 4,
            })

        if e["body"]:
            for line in e["body"].splitlines():
                if line.strip():
                    ops.append({
                        "op": "append",
                        "text": line,
                        "font_size": 10.5,
                        "space_below": 4,
                    })

        for img in e.get("images", []):
            jname = img["jpg_name"]
            info = uploaded.get(jname)
            label = "📷 写真" if img.get("asset_type") in ("photo", "livePhoto") else f"🖼️ {img.get('asset_type', '画像')}"
            if info:
                ops.append({
                    "op": "link",
                    "text": f"{label}: {jname}",
                    "url": info["url"],
                    "font_size": 9.5,
                })
            else:
                ops.append({
                    "op": "append",
                    "text": f"{label}: {jname}",
                    "font_size": 9.5,
                    "text_color": "#5F6368",
                })

        ops.append({"op": "horizontal-rule"})

    return ops


def embed_photos_for_year(year: str, doc_id: str, year_entries: list[dict]) -> None:
    """Embed inline photos after each photo link marker for smaller years."""
    total = sum(
        1 for e in year_entries for img in e.get("images", [])
        if img.get("asset_type") in ("photo", "livePhoto")
    )
    print(f"[{year}] Embedding {total} inline photos into {doc_id}...")
    done = 0
    for e in year_entries:
        for img in e.get("images", []):
            if img.get("asset_type") not in ("photo", "livePhoto"):
                continue
            jname = img["jpg_name"]
            local_path = img["local_jpg_path"]
            if not os.path.exists(local_path):
                continue
            marker = f"📷 写真: {jname}"
            res = subprocess.run(
                ["gdocs", "mutate", "insert-image-from-file", doc_id, local_path, "--after", marker],
                capture_output=True, text=True
            )
            done += 1
            if res.returncode != 0:
                print(f"  WARN photo {jname}: {res.stderr.strip()}")
            elif done % 10 == 0 or done == total:
                print(f"  [{year}] Embedded {done}/{total}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--embed-years", nargs="*", default=["2023"], help="Years to embed inline images for")
    args = parser.parse_args()

    with open(PARSED_JSON, encoding="utf-8") as fp:
        entries = json.load(fp)
    with open(UPLOADED_JSON, encoding="utf-8") as fp:
        uploaded = json.load(fp)

    for year, doc_id in YEAR_DOC_IDS.items():
        year_entries = [e for e in entries if e["year"] == year]
        if not year_entries:
            continue
        ops = build_batch_ops(year, year_entries, uploaded)
        ops_path = f"/tmp/lifelog_work/doc_batch_{year}.json"
        with open(ops_path, "w", encoding="utf-8") as fp:
            json.dump(ops, fp, ensure_ascii=False)

        print(f"[{year}] Writing {len(year_entries)} entries ({len(ops)} ops) to {doc_id}...")
        subprocess.run(
            ["gdocs", "mutate", "batch", doc_id, "-f", ops_path, "--replace-all"],
            check=True
        )
        if year in args.embed_years:
            embed_photos_for_year(year, doc_id, year_entries)


if __name__ == "__main__":
    main()
