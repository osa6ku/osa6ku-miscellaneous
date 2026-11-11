# Venu X1 × SwitchBot 連携（GAS: SwithBotコントロール）

Garmin Venu X1 の HTTP リクエスト系ウィジェットから Google Apps Script の Web アプリを GET で呼び出し、自宅の温湿度・施錠状態の一覧取得および SwitchBot デバイスの操作を行う。

| パラメータ | 対象デバイス / 処理 | 動作 |
| --- | --- | --- |
| `?target=status`（またはパラメータ無し） | 温湿度・照度デバイス（Hub 3 / 温湿度計Pro 4E / Hub 2）＋ロックウルトラ | 温度・湿度・照度・施錠・ドア・バッテリー状態をプレーンテキスト返却 |
| `?target=lock`（後方互換） | SwitchBot ロックウルトラ | `unlock`（解錠） |
| `?target=bot`（後方互換） | SwitchBot ボット | `press`（プッシュ動作） |

## 構成
- `コード.js` … `doGet` / `getHomeStatus` / `callSwitchBotApi`（SwitchBot API v1.1、HMAC-SHA256 署名）
- `appsscript.json` … Web アプリ設定（実行: 自分 / アクセス: 全員）
- `.clasp.json` … clasp 用設定

## 秘密情報の扱い
- SwitchBot のトークン・シークレットはコードに含めず、**スクリプトプロパティ** `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET` で管理する。
- Web アプリの公開 URL は認証なしでデバイスを操作できるため、**本リポジトリには記載しない**（Google ドライブ「Venu X1」フォルダの引継書を参照）。

## レスポンス
- ステータス一覧（`?target=status` / デフォルト）:
  ```text
  🌡 21.4℃ / 64% (hub318)
  🌡 22.1℃ / 59% (温湿度計Pro 4E)
  🌡 22.1℃ / 41% (ハブ２ C9)
  💡 照度: 1 (hub318) / 12 (ハブ２ C9)
  🔒 LOCKED (CLOSED)
  🔋 Lock: 48%
  ```
- 操作成功（SwitchBot `statusCode === 100`）: `OK: <command>`
- 失敗: SwitchBot API の生 JSON（例: `190 wrong deviceId`）

## デプロイ
```bash
clasp push
clasp deploy -i <既存デプロイID> -d "説明"   # URL を変えずに新バージョンを反映
```
