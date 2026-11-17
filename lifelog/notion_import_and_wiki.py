#!/usr/bin/env python3
"""
Normalize exported Notion '鑑賞記録' records & 'タグ' master,
optionally enrich via Wikipedia API (User-Agent set to avoid 403),
and populate Google Sheet 'ライフログ_鑑賞記録DB'.
"""
from __future__ import annotations
import argparse
import csv
import glob
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request

SPREADSHEET_ID = "1dvf7aVJA_B8SgkIB1qGzJztZ6hRPiA7SLb0xssY142E"
NOTION_EXPORT_FOLDER_ID = "17j1cC9QwzRks8p_D2jxJhA0K7RvujOQh"
WIKI_USER_AGENT = "LifelogNotionBot/1.0 (personal use)"
MAX_CAST = 20

PLATFORM_TARGETS = {
    "NHK": ["日本放送協会", "NHK総合", "NHK Eテレ", "NHK G", "NHK BSプレミアム", "NHK BS"],
    "日本テレビ": ["日テレ", "NTV", "日本テレビ放送網"],
    "TBS": ["TBSテレビ", "東京放送"],
    "フジテレビ": ["フジテレビジョン", "フジ", "CX"],
    "テレビ朝日": ["テレ朝", "EX"],
    "テレビ東京": ["テレ東", "TX"],
    "関西テレビ": ["カンテレ", "KTV"],
    "読売テレビ": ["ytv", "YTV"],
    "WOWOW": ["ワウワウ"],
    "Netflix": ["ネットフリックス", "ネトフリ"],
    "Amazon Prime Video": ["Amazon Prime", "アマプラ", "Amazonプライムビデオ", "Amazonプライム", "Prime Video"],
    "U-NEXT": ["ユーネクスト", "UNEXT"],
    "Hulu": ["フールー"],
    "Disney+": ["Disney", "ディズニープラス", "Disney Plus"],
    "Apple TV+": ["Apple TV", "AppleTV+"],
    "ABEMA": ["AbemaTV", "アベマ"],
    "TVer": ["ティーバー"],
    "映画館": ["劇場公開", "劇場鑑賞", "シネマ", "TOHOシネマズ", "109シネマズ", "イオンシネマ", "ユナイテッド・シネマ", "MOVIX"],
}

ALIAS_TO_CANONICAL = {}
for canon, aliases in PLATFORM_TARGETS.items():
    ALIAS_TO_CANONICAL[canon.lower()] = canon
    for a in aliases:
        ALIAS_TO_CANONICAL[a.lower()] = canon


def normalize_platforms(raw_list: list[str], context_text: str = "") -> str:
    """Normalize platform names using PLATFORM_TARGETS and '映画館' text rule."""
    result = []
    for item in raw_list:
        for tok in re.split(r"[,、/]+", item):
            tok = tok.strip()
            if not tok:
                continue
            canon = ALIAS_TO_CANONICAL.get(tok.lower(), tok)
            if canon not in result:
                result.append(canon)

    if context_text and re.search(r"(映画館|シネマズ|シネマ|劇場で|IMAX|Dolby)", context_text, re.I):
        if "映画館" not in result:
            result.append("映画館")
    return ", ".join(result)


def infer_category(title: str, genre_tags: list[str]) -> str:
    """Infer 区分 (ドラマ / 映画 / アニメ / 本 / その他) from title prefix or tags."""
    if title.startswith("ドラマ"):
        return "ドラマ"
    if title.startswith("映画"):
        return "映画"
    if title.startswith("アニメ") or "アニメ" in genre_tags:
        return "アニメ"
    if title.startswith(("小説", "漫画", "本")):
        return "本"
    for g in genre_tags:
        if g in ("ドラマ", "映画", "アニメ", "本", "小説", "漫画"):
            return "本" if g in ("小説", "漫画") else g
    return "その他"


def clean_work_title(raw_title: str) -> str:
    return re.sub(
        r"^(?:\[.*?\]|【.*?】|ドラマ|映画|アニメ|小説|漫画)[『「\s]*(.*?)[』」\s]*$",
        r"\1",
        raw_title.strip(),
    ).strip()


def fetch_wikipedia_info(title: str) -> dict | None:
    """Query Japanese Wikipedia API with User-Agent header (avoids 403)."""
    api_base = "https://ja.wikipedia.org/w/api.php"
    headers = {"User-Agent": WIKI_USER_AGENT}

    def get_json(params: dict) -> dict | None:
        url = f"{api_base}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            return None

    s_data = get_json({"action": "query", "list": "search", "srsearch": title, "format": "json"})
    results = (s_data or {}).get("query", {}).get("search", [])
    if not results:
        return None

    exact = next((r for r in results if r["title"] == title), None)
    page_title = exact["title"] if exact else results[0]["title"]
    c_data = get_json({
        "action": "query",
        "prop": "revisions|extracts",
        "rvprop": "content",
        "exintro": "1",
        "explaintext": "1",
        "titles": page_title,
        "format": "json",
    })
    pages = (c_data or {}).get("query", {}).get("pages", {})
    page = next(iter(pages.values()), None)
    if not page or "missing" in page:
        return None

    wikitext = (page.get("revisions") or [{}])[0].get("*", "")
    summary = (page.get("extract") or "").split("\n")[0][:400]

    ym = re.search(r"\|\s*(?:公開|放送期間|放送年|製作年|発表)\s*=\s*.*?((?:19|20)\d{2})年", wikitext)
    year = ym.group(1) if ym else ""

    platforms = []
    for canon, aliases in PLATFORM_TARGETS.items():
        all_names = [re.escape(x) for x in [canon] + aliases]
        if re.search(rf"\|\s*(?:放送局|製作局|配給|配信|放送枠)\s*=.*?(?:{'|'.join(all_names)})", wikitext, re.I):
            platforms.append(canon)

    cast, staff = [], []
    in_cast = False
    skip = {"日本", "テレビドラマ", "映画", "アニメ", "TBS", "フジテレビ", "NHK", "日本テレビ", "テレビ朝日", "テレビ東京"}
    for line in wikitext.splitlines():
        if re.search(r"==\s*(?:キャスト|出演者?|登場人物|声の出演)\s*==", line):
            in_cast = True
            continue
        elif re.search(r"==\s*[^=]+\s*==", line):
            in_cast = False
        is_staff = bool(re.search(r"\|\s*(?:監督|脚本|原作|演出|プロデューサー|音楽)\s*=", line))
        is_cast = in_cast or bool(re.search(r"\|\s*(?:出演者?|キャスト|主演|声の出演)\s*=", line))
        if not is_staff and not is_cast:
            continue
        for link in re.findall(r"\[\[([^\]]+)\]\]", line):
            name = re.sub(r"\s*\(.*?\)", "", link.split("|")[0].strip())
            if not name or ":" in name or "年" in name or name in skip:
                continue
            if is_staff:
                if name not in staff:
                    staff.append(name)
            else:
                if name not in cast and len(cast) < MAX_CAST:
                    cast.append(name)

    return {"year": year, "platforms": platforms, "cast": cast, "staff": staff[:10], "summary": summary}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--records-json", required=True)
    parser.add_argument("--tags-json", required=True)
    parser.add_argument("--enrich-limit", type=int, default=0, help="Max missing-cast rows to enrich via Wikipedia")
    args = parser.parse_args()

    records = json.load(open(args.records_json, encoding="utf-8"))
    tags = json.load(open(args.tags_json, encoding="utf-8"))

    # Deduplicate records by url
    by_url = {}
    for r in records:
        by_url[r["url"]] = r
    unique_records = list(by_url.values())
    unique_records.sort(key=lambda r: (r.get("date:日付:start") or "", r.get("createdTime") or ""))

    headers = [
        "ID", "自動補完", "タイトル", "区分", "鑑賞日・完了日", "ステータス",
        "評価", "プラットフォーム", "公開年・放送年", "出演者（最大20名）",
        "監督・スタッフ", "作品概要（Wikipedia）", "感想・メモ", "関連URL", "Notion元URL"
    ]
    rows = [headers]
    enriched = 0

    for idx, r in enumerate(unique_records, start=1):
        title = (r.get("名前") or "").strip()
        status = r.get("ステータス") or ""
        watch_date = r.get("date:日付:start") or r.get("date:投稿日時:start") or ""
        raw_tags = r.get("タグ ") or "[]"
        tag_urls = json.loads(raw_tags) if isinstance(raw_tags, str) else raw_tags

        plat_raw, genre_raw, people_raw, other_tags = [], [], [], []
        for turl in tag_urls:
            norm_url = turl.replace("/p/", "/")
            tinfo = tags.get(turl) or tags.get(norm_url) or tags.get(turl.replace("app.notion.com/", "app.notion.com/p/"))
            if not tinfo:
                continue
            tname = (tinfo.get("名前") or "").strip()
            ttype = tinfo.get("種別") or ""
            if not tname:
                continue
            if ttype == "プラットフォーム" or tname.lower() in ALIAS_TO_CANONICAL:
                plat_raw.append(tname)
            elif ttype == "ジャンル・媒体":
                genre_raw.append(tname)
            elif ttype == "人物・スタッフ":
                if len(people_raw) < MAX_CAST:
                    people_raw.append(tname)
            else:
                other_tags.append(tname)

        category = infer_category(title, genre_raw)
        platforms_str = normalize_platforms(plat_raw, title)
        cast_str = ", ".join(people_raw[:MAX_CAST])
        staff_str = ""
        summary_str = ""
        release_year = ""

        if args.enrich_limit > 0 and enriched < args.enrich_limit and not cast_str and category in ("ドラマ", "映画", "アニメ"):
            w = fetch_wikipedia_info(clean_work_title(title))
            enriched += 1
            if w:
                release_year = w["year"]
                if w["platforms"]:
                    platforms_str = normalize_platforms(plat_raw + w["platforms"], title)
                cast_str = ", ".join(w["cast"][:MAX_CAST])
                staff_str = ", ".join(w["staff"])
                summary_str = w["summary"]
            time.sleep(0.15)

        rows.append([
            idx,
            False,
            title,
            category,
            watch_date,
            status,
            "",
            platforms_str,
            release_year,
            cast_str,
            staff_str,
            summary_str,
            ", ".join(other_tags),
            "",
            r.get("url") or "",
        ])

    os.makedirs("/tmp/notion_work", exist_ok=True)
    csv_path = "/tmp/notion_work/notion_watching_export.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as fp:
        csv.writer(fp).writerows(rows)

    subprocess.run(
        ["gsheets", "mutate", "rename-sheet", SPREADSHEET_ID, "--sheet-id", "0", "--title", "鑑賞記録DB"],
        check=False,
    )
    subprocess.run(["gsheets", "mutate", "clear", SPREADSHEET_ID, "鑑賞記録DB!A1:O2000"], check=True)

    ops = []
    for start in range(0, len(rows), 300):
        ops.append({"op": "write", "range": f"鑑賞記録DB!A{start + 1}", "data": rows[start:start + 300]})
    batch_path = "/tmp/notion_work/sheets_batch.json"
    json.dump(ops, open(batch_path, "w", encoding="utf-8"), ensure_ascii=False)
    subprocess.run(["gsheets", "mutate", "batch", SPREADSHEET_ID, "-f", batch_path], check=True)

    subprocess.run([
        "gsheets", "mutate", "format", SPREADSHEET_ID,
        "--sheet-id", "0", "--start-row", "0", "--end-row", "1",
        "--start-col", "0", "--end-col", "15",
        "--bold", "--bg-color", "#1A73E8", "--fg-color", "#FFFFFF", "--align", "CENTER"
    ], check=True)
    subprocess.run(["gsheets", "mutate", "freeze", SPREADSHEET_ID, "--sheet-id", "0", "--rows", "1"], check=True)
    subprocess.run(["gdrive", "mutate", "upload", csv_path, "--parent", NOTION_EXPORT_FOLDER_ID], check=True)
    print(f"Exported {len(rows) - 1} records to ライフログ_鑑賞記録DB ({SPREADSHEET_ID}) and uploaded CSV to notion_export.")


if __name__ == "__main__":
    main()
