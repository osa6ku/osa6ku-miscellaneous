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
const WATCH_SS_ID = '1dvf7aVJA_B8SgkIB1qGzJztZ6hRPiA7SLb0xssY142E';
const DIARY_SS_ID = '1_UnbcNhxtEkV7vLagxreIeyELbY3NBLU5bS8pp4YQ1A';
const DIARY_SHEET_NAME = '日記DB';
const JOURNAL_IMAGES_FOLDER_ID = '1kPfAX4TvDpMwokoinA2ga-nCwoePkLyo';
const JOURNAL_DOCS_FOLDER_ID = '1GqzKeXduc0UF-3Mb8nihfs3SVMSbOPSI';
const YEAR_DOC_IDS = {
  '2023': '1kq2hbOtbA_oMDdZ9V1Zfduw8gXG3YhQr5K_HS-NfCr8',
  '2024': '1zw5PJeGd0Ez5Z53Q9L337hwqB_zRzEHPn-ti6tsj8l8',
  '2025': '1ad_I1JPnJyvkiIdL_2tAjDA0bearBM5mld9I0bzXyg8',
  '2026': '114VekVP1Atik_cds8n_0N6rXmqRjO9l8GvETh570zKI',
};
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

// ============================================================================
// Web アプリ (HTMLService) エンドポイント & API
// ============================================================================

function doGet(e) {
  const api = e && e.parameter && e.parameter.api;
  if (api === 'watch') {
    const entries = getWatchEntries();
    return jsonResponse_({ ok: true, count: entries.length, entries });
  }
  if (api === 'diary') {
    const limit = Number((e.parameter && e.parameter.limit) || 120);
    const entries = getDiaryEntries(limit);
    return jsonResponse_({ ok: true, count: entries.length, entries });
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ライフログ・ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    if (action === 'addWatch') return jsonResponse_(addWatchEntry(body.payload || {}));
    if (action === 'updateWatch') return jsonResponse_(updateWatchCard(body.payload || {}));
    if (action === 'addDiary') return jsonResponse_(addDiaryEntry(body.payload || {}));
    return jsonResponse_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getWatchEntries() {
  const ss = SpreadsheetApp.openById(WATCH_SS_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const entries = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[COL.TITLE - 1]) continue;
    entries.push({
      row: i + 1,
      id: r[COL.ID - 1],
      title: String(r[COL.TITLE - 1] || ''),
      category: String(r[COL.CATEGORY - 1] || 'その他'),
      watchDate: formatDateVal_(r[COL.WATCH_DATE - 1]),
      status: String(r[COL.STATUS - 1] || ''),
      rating: String(r[COL.RATING - 1] || ''),
      platform: String(r[COL.PLATFORM - 1] || ''),
      releaseYear: String(r[COL.RELEASE_YEAR - 1] || ''),
      cast: String(r[COL.CAST - 1] || ''),
      staff: String(r[COL.STAFF - 1] || ''),
      summary: String(r[COL.SUMMARY - 1] || ''),
      memo: String(r[COL.MEMO - 1] || ''),
      relatedUrl: String(r[COL.RELATED_URL - 1] || ''),
      notionUrl: String(r[COL.NOTION_URL - 1] || ''),
    });
  }
  return entries.reverse();
}

function addWatchEntry(payload) {
  const ss = SpreadsheetApp.openById(WATCH_SS_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const nextId = lastRow >= 2 ? Number(sheet.getRange(lastRow, COL.ID).getValue() || lastRow - 1) + 1 : 1;

  const title = String(payload.title || '').trim();
  const memo = String(payload.memo || '').trim();
  const normPlat = normalizePlatforms_(String(payload.platform || ''), `${title} ${memo}`);
  const watchDate = payload.watchDate || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  const newRow = [
    nextId,
    false,
    title,
    payload.category || 'ドラマ',
    watchDate,
    payload.status || '進行中',
    payload.rating || '',
    normPlat,
    '',
    '',
    '',
    '',
    memo,
    payload.relatedUrl || '',
    '',
  ];
  sheet.appendRow(newRow);
  const insertedRow = sheet.getLastRow();

  if (payload.autoWiki) {
    enrichRow_(sheet, insertedRow);
  }
  return { ok: true, row: insertedRow };
}

function updateWatchCard(payload) {
  const ss = SpreadsheetApp.openById(WATCH_SS_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const row = Number(payload.row);
  if (row < 2) throw new Error('Invalid row');

  if (payload.status !== undefined) {
    sheet.getRange(row, COL.STATUS).setValue(payload.status);
    if (payload.status === '完了' && !sheet.getRange(row, COL.WATCH_DATE).getValue()) {
      sheet.getRange(row, COL.WATCH_DATE).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    }
  }
  if (payload.rating !== undefined) {
    sheet.getRange(row, COL.RATING).setValue(payload.rating);
  }
  if (payload.runWiki) {
    enrichRow_(sheet, row);
  }
  const r = sheet.getRange(row, 1, 1, 15).getValues()[0];
  return {
    row,
    id: r[COL.ID - 1],
    title: String(r[COL.TITLE - 1] || ''),
    category: String(r[COL.CATEGORY - 1] || ''),
    watchDate: formatDateVal_(r[COL.WATCH_DATE - 1]),
    status: String(r[COL.STATUS - 1] || ''),
    rating: String(r[COL.RATING - 1] || ''),
    platform: String(r[COL.PLATFORM - 1] || ''),
    releaseYear: String(r[COL.RELEASE_YEAR - 1] || ''),
    cast: String(r[COL.CAST - 1] || ''),
    staff: String(r[COL.STAFF - 1] || ''),
    summary: String(r[COL.SUMMARY - 1] || ''),
    memo: String(r[COL.MEMO - 1] || ''),
  };
}

function getDiaryEntries(limit) {
  const ss = SpreadsheetApp.openById(DIARY_SS_ID);
  const sheet = ss.getSheetByName(DIARY_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const maxCount = limit || 120;
  const startRow = Math.max(2, lastRow - maxCount + 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();
  const out = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const r = values[i];
    out.push({
      id: r[0],
      date: formatDateVal_(r[1]),
      weekday: String(r[2] || ''),
      title: String(r[4] || ''),
      body: String(r[5] || ''),
      location: String(r[6] || ''),
      imageCount: Number(r[7] || 0),
      imageUrls: String(r[9] || '').split('\n').filter(Boolean),
    });
  }
  return out;
}

function addDiaryEntry(payload) {
  const dateStr = payload.date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const year = dateStr.slice(0, 4);
  const ym = dateStr.slice(0, 7);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dt = new Date(dateStr + 'T00:00:00+09:00');
  const weekday = weekdays[dt.getDay()] || '';
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  const location = String(payload.location || '').trim();

  // 写真アップロード処理（リサイズ済みBase64を受信して journal_images/YYYY-MM/ へ保存）
  const jpgNames = [];
  const driveUrls = [];
  let firstFileId = '';
  const photos = payload.photos || [];
  if (photos.length > 0) {
    const ymFolder = getOrCreateSubfolder_(JOURNAL_IMAGES_FOLDER_ID, ym);
    photos.forEach((p, idx) => {
      const safeName = String(p.name || `photo_${idx + 1}.jpg`).replace(/\.[^.]+$/, '') + '.jpg';
      const fileName = `${dateStr}_${safeName}`;
      const bytes = Utilities.base64Decode(p.base64);
      const blob = Utilities.newBlob(bytes, 'image/jpeg', fileName);
      const file = ymFolder.createFile(blob);
      jpgNames.push(fileName);
      driveUrls.push(`https://drive.google.com/file/d/${file.getId()}/view`);
      if (!firstFileId) firstFileId = file.getId();
    });
  }

  const ss = SpreadsheetApp.openById(DIARY_SS_ID);
  const sheet = ss.getSheetByName(DIARY_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const nextId = lastRow >= 2 ? Number(sheet.getRange(lastRow, 1).getValue() || lastRow - 1) + 1 : 1;
  const imageFormula = firstFileId ? `=IMAGE("https://drive.google.com/uc?export=view&id=${firstFileId}")` : '';
  const docId = YEAR_DOC_IDS[year] || '';
  const docUrl = docId ? `https://docs.google.com/document/d/${docId}/edit` : '';

  sheet.appendRow([
    nextId,
    dateStr,
    weekday,
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm'),
    title,
    body,
    location,
    jpgNames.length,
    jpgNames.join('\n'),
    driveUrls.join('\n'),
    imageFormula,
    docUrl,
    'webapp_entry',
  ]);

  // 年別ドキュメントへ追記
  if (docId) {
    const doc = DocumentApp.openById(docId);
    const docBody = doc.getBody();
    const hText = `${dateStr} (${weekday}) — ${title || '(無題)'}`;
    docBody.appendParagraph(hText).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (location) docBody.appendParagraph(`📍 場所: ${location}`);
    if (body) docBody.appendParagraph(body);
    driveUrls.forEach((u, idx) => {
      const p = docBody.appendParagraph(`📷 写真: ${jpgNames[idx]}`);
      p.setLinkUrl(u);
    });
    docBody.appendHorizontalRule();
    doc.saveAndClose();
  }

  return { ok: true, id: nextId, date: dateStr };
}

function getOrCreateSubfolder_(parentId, name) {
  const parent = DriveApp.getFolderById(parentId);
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function formatDateVal_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val).slice(0, 10);
}
