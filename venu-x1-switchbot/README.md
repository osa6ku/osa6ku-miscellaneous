# Venu X1 × SwitchBot 連携（GAS: SwithBotコントロール）

Garmin Venu X1 の HTTP リクエスト系ウィジェットから Google Apps Script の Web アプリを GET で呼び出し、SwitchBot デバイスをワンタップ操作する。

| パラメータ | 対象デバイス | コマンド |
| --- | --- | --- |
| `?target=lock` | SwitchBot ロックウルトラ | `unlock` |
| `?target=bot` | SwitchBot ボット | `press` |

## 構成
- `コード.js` … `doGet` / `callSwitchBotApi`（SwitchBot API v1.1、HMAC-SHA256 署名）
- `appsscript.json` … Web アプリ設定（実行: 自分 / アクセス: 全員）
- `.clasp.json` … clasp 用設定

## 秘密情報の扱い
- SwitchBot のトークン・シークレットはコードに含めず、**スクリプトプロパティ** `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET` で管理する。
- Web アプリの公開 URL は認証なしでデバイスを操作できるため、**本リポジトリには記載しない**（Google ドライブ「Venu X1」フォルダの引継書を参照）。

## レスポンス
- 成功（SwitchBot `statusCode === 100`）: `OK: <command>`
- 失敗: SwitchBot API の生 JSON（例: `190 wrong deviceId`）

## デプロイ
```bash
clasp push
clasp deploy -i <既存デプロイID> -d "説明"   # URL を変えずに新バージョンを反映
```
