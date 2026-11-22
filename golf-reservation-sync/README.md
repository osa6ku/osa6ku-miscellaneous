# ゴルフ練習予約 自動連携・連番管理 GAS（Gmailチェックして⛳️練習の予定を作成）

「東京趣味令処ん ごるふくらぶ 浅草橋店」（`tsgc@star7.jp`）からの予約・キャンセルメールを Gmail から自動検知し、Google カレンダーへの予定登録・削除・連番自動補正・LINE プッシュ通知およびメールアーカイブを自動実行する Google Apps Script（スタンドアロン）。

## 構成
- `Gmail→⛳️練習予定作成.js` … メイン処理（`syncAndRenumberGolfReservations`）、新規予約・キャンセル検知、連番自動補正（`⛳️練習 001`〜）、LINE Messaging API 通知、`testLineNotification`
- `appsscript.json` … GAS マニフェスト（`Asia/Tokyo`, V8）
- `.clasp.json` … clasp 管理設定

## スクリプトプロパティ（秘密情報）
トークン類はコードに含めず、GAS の **スクリプトプロパティ** で管理する。
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_USER_ID`

## トリガー設定
- 実行関数: `syncAndRenumberGolfReservations`
- イベントソース: 時間主導型（分ベース・10分おき）

## デプロイ
```bash
clasp push
```
