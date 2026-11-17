# ライフログ（日記・鑑賞記録）移行スクリプト

Apple iOS「ジャーナル」アプリのエクスポートデータ（`AppleJournalEntries.zip` / HTML + Resources）を解析し、Google ドライブ / Google スプレッドシート / Google ドキュメントへ統合・アーカイブ化するためのスクリプト群です。

## スクリプト一覧

1. **`parse_and_convert.py`**
   - `Entries/*.html`（`._*` 除外）をパースし、日付・曜日・タイトル・本文・場所・添付画像リストを抽出。
   - `Resources/*` の対象画像（`.heic`, `.heif`, `.jpeg`, `.jpg`, `.png`）を `.jpg`（長辺上限 1200px・品質 80%）へ変換し、`YYYY-MM/YYYY-MM-DD_<元ファイル名>.jpg` 形式で保存（`.json`・`.mov`・`.mp4`・`._*` は除外）。

2. **`upload_images.py`**
   - Google ドライブ `50_ライフログ/journal_images/` 配下に月別フォルダ（`YYYY-MM`）を作成し、変換済み JPG 画像をアップロード（チェックポイントによるレジューム対応）。

3. **`create_sheets_db.py`**
   - Google スプレッドシート `ライフログ_日記DB` に全エントリー（日付昇順）を書き込み、画像リンク・`=IMAGE()` サムネイル・年別アーカイブ Doc リンクを設定。

4. **`create_journal_docs.py`**
   - Google ドライブ `50_ライフログ/journal_docs/` 配下に年別アーカイブドキュメント（`日記アーカイブ_YYYY`）を生成。

5. **`notion_import_and_wiki.py`**（フェーズ2）
   - Notion「鑑賞記録」DB（914件）および「タグ」DB（2,243件）のエクスポートデータを正規化（`PLATFORM_TARGETS` による表記揺れ統一・映画館判定・主要キャスト最大20名制限）。
   - 未取得作品について Wikipedia API（`User-Agent` ヘッダー付き）から公開年・放送局/配信・キャスト・スタッフ・概要を補完し、Google スプレッドシート `ライフログ_鑑賞記録DB` へ格納。

6. **`gas/Code.gs`**（フェーズ2・Google Apps Script）
   - `ライフログ_鑑賞記録DB` 用のカスタムメニューおよびスマホ対応チェックボックストリガーによる Wikipedia 自動補完・プラットフォーム正規化スクリプト。
