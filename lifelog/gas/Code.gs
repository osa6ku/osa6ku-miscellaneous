/**
 * ライフログ_鑑賞記録DB — Wikipedia API 自動補完 & プラットフォーム正規化 GAS
 *
 * 【機能】
 * 1. カスタムメニュー「🎬 ライフログ管理」から選択行または未取得行のWikipedia情報を自動補完
 * 2. スマホ対応：B列「自動補完」チェックボックスを ON にすると自動実行し、完了後に OFF へ戻す
 * 3. User-Agent ヘッダーを設定して Wikipedia API の 403 エラーを回避
 * 4. プラットフォーム表記揺れを PLATFORM_TARGETS 辞書で正規化（「映画館」判定ルール含む）
 * 5. 主要キャストは最大 20 名までに制限して格納
 */

const SHEET_NAME = '鑑賞記録DB';
const WIKI_USER_AGENT = 'LifelogNotionBot/1.0 (personal use)';
const MAX_CAST = 20;

// 列番号（1-indexed）
const COL = {
  ID: 1,
  AUTO_FETCH: 2,     // チェックボックス（スマホ対応トリガー）
  TITLE: 3,          // タイトル
  CATEGORY: 4,       // 区分（ドラマ / 映画 / アニメ / 本 / その他）
  WATCH_DATE: 5,     // 鑑賞日・完了日
  STATUS: 6,         // ステータス
  RATING: 7,         // 評価（スコア）
  PLATFORM: 8,       // プラットフォーム（正規化済み）
  RELEASE_YEAR: 9,   // 公開年・放送年
  CAST: 10,          // 出演者（主要キャスト最大20名）
  STAFF: 11,         // 監督・脚本・原作等
  SUMMARY: 12,       // 作品概要（Wikipedia）
  MEMO: 13,          // 感想・メモ
  RELATED_URL: 14,   // 関連URL
  NOTION_URL: 15,    // Notion元URL
};

// プラットフォーム表記揺れ正規化辞書
const PLATFORM_TARGETS = {
  'NHK': ['日本放送協会', 'NHK総合', 'NHK Eテレ', 'NHK G', 'NHK BSプレミアム', 'NHK BS'],
  '日本テレビ': ['日テレ', 'NTV', '日本テレビ放送網'],
  'TBS': ['TBSテレビ', '東京放送'],
  'フジテレビ': ['フジテレビジョン', 'フジ', 'CX'],
  'テレビ朝日': ['テレ朝', 'EX'],
  'テレビ東京': ['テレ東', 'TX'],
  '関西テレビ': ['カンテレ', 'KTV'],
  '読売テレビ': ['ytv', 'YTV'],
  'WOWOW': ['ワウワウ'],
  'Netflix': ['ネットフリックス', 'ネトフリ'],
  'Amazon Prime Video': ['Amazon Prime', 'アマプラ', 'Amazonプライムビデオ', 'Amazonプライム', 'Prime Video'],
  'U-NEXT': ['ユーネクスト', 'UNEXT'],
  'Hulu': ['フールー'],
  'Disney+': ['Disney', 'ディズニープラス', 'Disney Plus'],
  'Apple TV+': ['Apple TV', 'AppleTV+'],
  'ABEMA': ['AbemaTV', 'アベマ'],
  'TVer': ['ティーバー'],
  '映画館': ['劇場公開', '劇場鑑賞', 'シネマ', 'TOHOシネマズ', '109シネマズ', 'イオンシネマ', 'ユナイテッド・シネマ', 'MOVIX'],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎬 ライフログ管理')
    .addItem('選択行をWikipediaから自動補完', 'enrichSelectedRows')
    .addItem('「自動補完」チェック済みの行を実行', 'enrichCheckedRows')
    .addSeparator()
    .addItem('プラットフォーム表記揺れを正規化（全行）', 'normalizeAllPlatforms')
    .addToUi();
}

/**
 * スマホ対応チェックボックストリガー（シンプルトリガー onEdit で動作、UrlFetchApp を使う場合は
 * インストーラブルトリガーとして登録するかメニューから実行してください）
 */
function onEditTrigger(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  if (e.range.getColumn() === COL.AUTO_FETCH && e.range.getRow() > 1 && e.value === 'TRUE') {
    const row = e.range.getRow();
    enrichRow_(sheet, row);
    sheet.getRange(row, COL.AUTO_FETCH).setValue(false);
  }
}

function enrichSelectedRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;
  const range = sheet.getActiveRange();
  if (!range) return;
  const startRow = Math.max(2, range.getRow());
  const endRow = startRow + range.getNumRows() - 1;
  for (let r = startRow; r <= endRow; r++) {
    enrichRow_(sheet, r);
  }
}

function enrichCheckedRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const checks = sheet.getRange(2, COL.AUTO_FETCH, lastRow - 1, 1).getValues();
  for (let i = 0; i < checks.length; i++) {
    if (checks[i][0] === true) {
      const row = i + 2;
      enrichRow_(sheet, row);
      sheet.getRange(row, COL.AUTO_FETCH).setValue(false);
    }
  }
}

function normalizeAllPlatforms() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const vals = sheet.getRange(2, COL.PLATFORM, lastRow - 1, 1).getValues();
  const memos = sheet.getRange(2, COL.MEMO, lastRow - 1, 1).getValues();
  const titles = sheet.getRange(2, COL.TITLE, lastRow - 1, 1).getValues();
  const updated = vals.map((row, idx) => {
    const combinedText = `${titles[idx][0]} ${memos[idx][0]}`;
    return [normalizePlatforms_(String(row[0] || ''), combinedText)];
  });
  sheet.getRange(2, COL.PLATFORM, updated.length, 1).setValues(updated);
}

function enrichRow_(sheet, row) {
  const rawTitle = String(sheet.getRange(row, COL.TITLE).getValue() || '').trim();
  if (!rawTitle) return;

  const cleanTitle = rawTitle
    .replace(/^(?:\[.*?\]|【.*?】|ドラマ|映画|アニメ|小説|漫画)[『「\s]*(.*?)[』」\s]*$/, '$1')
    .trim();

  const wiki = fetchWikipediaInfo_(cleanTitle || rawTitle);
  if (!wiki) {
    sheet.getRange(row, COL.SUMMARY).setValue('⚠️ Wikipedia記事が見つかりませんでした');
    return;
  }

  if (wiki.year && !sheet.getRange(row, COL.RELEASE_YEAR).getValue()) {
    sheet.getRange(row, COL.RELEASE_YEAR).setValue(wiki.year);
  }
  if (wiki.platforms.length > 0) {
    const curPlat = String(sheet.getRange(row, COL.PLATFORM).getValue() || '');
    const memo = String(sheet.getRange(row, COL.MEMO).getValue() || '');
    const merged = [curPlat, ...wiki.platforms].filter(Boolean).join(', ');
    sheet.getRange(row, COL.PLATFORM).setValue(normalizePlatforms_(merged, `${rawTitle} ${memo}`));
  }
  if (wiki.cast.length > 0) {
    sheet.getRange(row, COL.CAST).setValue(wiki.cast.slice(0, MAX_CAST).join(', '));
  }
  if (wiki.staff.length > 0) {
    sheet.getRange(row, COL.STAFF).setValue(wiki.staff.join(', '));
  }
  if (wiki.summary) {
    sheet.getRange(row, COL.SUMMARY).setValue(wiki.summary);
  }
}

function normalizePlatforms_(rawStr, contextText) {
  const tokens = rawStr.split(/[,、\/]+/).map(s => s.trim()).filter(Boolean);
  const result = [];
  const addUnique = (val) => {
    if (val && !result.includes(val)) result.push(val);
  };

  for (const tok of tokens) {
    let matched = false;
    for (const [canonical, aliases] of Object.entries(PLATFORM_TARGETS)) {
      if (tok === canonical || aliases.some(a => tok.toLowerCase() === a.toLowerCase())) {
        addUnique(canonical);
        matched = true;
        break;
      }
    }
    if (!matched) addUnique(tok);
  }

  // 「映画館」判定ルール（テキスト中に映画館・シネマ等が含まれる場合）
  if (contextText && /(映画館|シネマズ|シネマ|劇場で|IMAX|Dolby)/i.test(contextText)) {
    addUnique('映画館');
  }
  return result.join(', ');
}

function fetchWikipediaInfo_(title) {
  const apiBase = 'https://ja.wikipedia.org/w/api.php';
  const headers = { 'User-Agent': WIKI_USER_AGENT };

  const searchUrl = `${apiBase}?action=query&list=search&srsearch=${encodeURIComponent(title)}&format=json`;
  const sRes = UrlFetchApp.fetch(searchUrl, { headers, muteHttpExceptions: true });
  if (sRes.getResponseCode() !== 200) return null;

  const sJson = JSON.parse(sRes.getContentText());
  const results = (sJson.query && sJson.query.search) || [];
  if (results.length === 0) return null;

  const exact = results.find(r => r.title === title);
  const pageTitle = exact ? exact.title : results[0].title;
  const contentUrl = `${apiBase}?action=query&prop=revisions|extracts&rvprop=content&exintro=1&explaintext=1&titles=${encodeURIComponent(pageTitle)}&format=json`;
  const cRes = UrlFetchApp.fetch(contentUrl, { headers, muteHttpExceptions: true });
  if (cRes.getResponseCode() !== 200) return null;

  const pages = (JSON.parse(cRes.getContentText()).query || {}).pages || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;

  const wikitext = (page.revisions && page.revisions[0] && page.revisions[0]['*']) || '';
  const summary = (page.extract || '').split('\n')[0].slice(0, 400);

  // 公開年・放送年抽出
  const yearMatch = wikitext.match(/\|\s*(?:公開|放送期間|放送年|製作年|発表)\s*=\s*.*?((?:19|20)\d{2})年/);
  const year = yearMatch ? Number(yearMatch[1]) : '';

  // プラットフォーム・放送局抽出
  const platforms = [];
  for (const [canonical, aliases] of Object.entries(PLATFORM_TARGETS)) {
    const allNames = [canonical, ...aliases];
    const platRegex = new RegExp(`\\|\\s*(?:放送局|製作局|配給|配信|放送枠)\\s*=.*?(?:${allNames.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
    if (platRegex.test(wikitext)) {
      platforms.push(canonical);
    }
  }

  // キャスト・スタッフ抽出
  const cast = [];
  const staff = [];
  let inCast = false;
  const skipWords = new Set(['日本', 'テレビドラマ', '映画', 'アニメ', 'TBS', 'フジテレビ', 'NHK', '日本テレビ', 'テレビ朝日', 'テレビ東京']);

  for (const line of wikitext.split('\n')) {
    if (/==\s*(?:キャスト|出演者?|登場人物|声の出演)\s*==/.test(line)) {
      inCast = true;
      continue;
    } else if (/==\s*[^=]+\s*==/.test(line)) {
      inCast = false;
    }

    const isStaffLine = /\|\s*(?:監督|脚本|原作|演出|プロデューサー|音楽)\s*=/.test(line);
    const isCastLine = inCast || /\|\s*(?:出演者?|キャスト|主演|声の出演)\s*=/.test(line);
    if (!isStaffLine && !isCastLine) continue;

    const links = [...line.matchAll(/\[\[([^\]]+)\]\]/g)];
    for (const m of links) {
      let name = m[1].split('|')[0].trim().replace(/\s*\(.*?\)/g, '');
      if (!name || name.includes(':') || name.includes('年') || skipWords.has(name)) continue;
      if (isStaffLine) {
        if (!staff.includes(name)) staff.push(name);
      } else {
        if (!cast.includes(name) && cast.length < MAX_CAST) cast.push(name);
      }
    }
  }

  return { pageTitle, year, platforms, cast, staff: staff.slice(0, 10), summary };
}
