#!/usr/bin/env python3
"""
Populate Google Sheet 'ライフログ_日記DB' with parsed Apple Journal entries
and links to uploaded Google Drive images and yearly archive Google Docs.
"""
import json
import subprocess

SPREADSHEET_ID = "1_UnbcNhxtEkV7vLagxreIeyELbY3NBLU5bS8pp4YQ1A"
PARSED_JSON = "/tmp/lifelog_work/parsed_entries.json"
UPLOADED_JSON = "/tmp/lifelog_work/uploaded_images.json"
BATCH_JSON = "/tmp/lifelog_work/sheets_batch.json"

YEAR_DOCS = {
    "2023": "https://docs.google.com/document/d/1kq2hbOtbA_oMDdZ9V1Zfduw8gXG3YhQr5K_HS-NfCr8/edit",
    "2024": "https://docs.google.com/document/d/1zw5PJeGd0Ez5Z53Q9L337hwqB_zRzEHPn-ti6tsj8l8/edit",
    "2025": "https://docs.google.com/document/d/1ad_I1JPnJyvkiIdL_2tAjDA0bearBM5mld9I0bzXyg8/edit",
    "2026": "https://docs.google.com/document/d/114VekVP1Atik_cds8n_0N6rXmqRjO9l8GvETh570zKI/edit",
}


def main():
    with open(PARSED_JSON, encoding="utf-8") as fp:
        entries = json.load(fp)
    with open(UPLOADED_JSON, encoding="utf-8") as fp:
        uploaded = json.load(fp)

    # Rename Sheet 1 -> 日記DB (ignore error if already renamed)
    subprocess.run(
        ["gsheets", "mutate", "rename-sheet", SPREADSHEET_ID, "--sheet-id", "0", "--title", "日記DB"],
        check=False
    )

    headers = [
        "ID", "日付", "曜日", "時刻", "タイトル", "本文",
        "場所・位置情報", "画像枚数", "画像ファイル名一覧",
        "Googleドライブ画像リンク", "サムネイル(IMAGE)",
        "年別アーカイブDoc", "元HTMLファイル名"
    ]
    rows = [headers]

    for e in entries:
        imgs = e.get("images", [])
        jpg_names = [img["jpg_name"] for img in imgs]
        drive_urls = []
        first_photo_id = ""
        for img in imgs:
            info = uploaded.get(img["jpg_name"])
            if info:
                drive_urls.append(info["url"])
                if not first_photo_id and img.get("asset_type") in ("photo", "livePhoto"):
                    first_photo_id = info["id"]
        if not first_photo_id and imgs:
            first_info = uploaded.get(imgs[0]["jpg_name"])
            if first_info:
                first_photo_id = first_info["id"]

        image_formula = f'=IMAGE("https://drive.google.com/uc?export=view&id={first_photo_id}")' if first_photo_id else ""
        doc_url = YEAR_DOCS.get(e["year"], "")

        rows.append([
            e["id"],
            e["date"],
            e["weekday"],
            e["time"],
            e["title"],
            e["body"],
            e["location"],
            len(imgs),
            "\n".join(jpg_names),
            "\n".join(drive_urls),
            image_formula,
            doc_url,
            e["html_filename"],
        ])

    # Clear and write in chunks of 300 rows via gsheets mutate batch
    subprocess.run(["gsheets", "mutate", "clear", SPREADSHEET_ID, "日記DB!A1:M2000"], check=True)
    ops = []
    chunk_size = 300
    for start in range(0, len(rows), chunk_size):
        chunk = rows[start:start + chunk_size]
        row_num = start + 1
        ops.append({
            "op": "write",
            "range": f"日記DB!A{row_num}",
            "data": chunk,
        })

    with open(BATCH_JSON, "w", encoding="utf-8") as fp:
        json.dump(ops, fp, ensure_ascii=False)

    subprocess.run(["gsheets", "mutate", "batch", SPREADSHEET_ID, "-f", BATCH_JSON], check=True)

    # Format header row and freeze row 1
    subprocess.run([
        "gsheets", "mutate", "format", SPREADSHEET_ID,
        "--sheet-id", "0", "--start-row", "0", "--end-row", "1",
        "--start-col", "0", "--end-col", "13",
        "--bold", "--bg-color", "#1A73E8", "--fg-color", "#FFFFFF", "--align", "CENTER"
    ], check=True)
    subprocess.run([
        "gsheets", "mutate", "freeze", SPREADSHEET_ID, "--sheet-id", "0", "--rows", "1"
    ], check=True)

    print(f"Wrote {len(rows) - 1} entries to ライフログ_日記DB ({SPREADSHEET_ID}).")


if __name__ == "__main__":
    main()
