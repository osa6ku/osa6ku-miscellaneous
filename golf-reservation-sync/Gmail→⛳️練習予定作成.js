/**
 * 東京趣味令処ん ごるふくらぶ 予約・キャンセル自動連携 ＆ 連番自動補正 ＆ LINE通知 ＆ 自動アーカイブ
 */
function syncAndRenumberGolfReservations() {
  const PROCESSED_LABEL_NAME = "ゴルフ予約処理済";
  const CALENDAR_LOCATION = "東京趣味令処ん ごるふくらぶ";
  const calendar = CalendarApp.getDefaultCalendar();
  let label = GmailApp.getUserLabelByName(PROCESSED_LABEL_NAME);
  if (!label) {
    label = GmailApp.createLabel(PROCESSED_LABEL_NAME);
  }
  // 1. キャンセルメール処理
  const cancelledEvents = handleCancelEmails(calendar, label, PROCESSED_LABEL_NAME);
  // 2. 新規予約メール処理
  const newlyCreatedEvents = handleNewBookings(calendar, label, PROCESSED_LABEL_NAME, CALENDAR_LOCATION);
  // 3. 連番の自動補正
  resequenceAllGolfEvents(calendar);
  // 4. キャンセルがあった場合、LINEで速報通知
  if (cancelledEvents.length > 0) {
    sendCancelNotifications(cancelledEvents);
  }
  // 5. 新規登録があった場合、LINEで速報通知
  if (newlyCreatedEvents.length > 0) {
    sendBookingNotifications(calendar, newlyCreatedEvents);
  }
}

/**
 * 新規予約メールを検知してカレンダーに予定を登録し、アーカイブ
 */
function handleNewBookings(calendar, label, labelName, location) {
  const query = `label:inbox -label:${labelName} from:tsgc@star7.jp subject:("ご予約を受け付けました" OR "予約完了")`;
  const threads = GmailApp.search(query, 0, 10);
  if (threads.length === 0) return [];
  let newlyCreated = [];
  for (const thread of threads) {
    const messages = thread.getMessages();
    let isProcessed = false;
    for (const msg of messages) {
      if (msg.isDraft()) continue;
      const subject = msg.getSubject();
      if (subject.includes("キャンセル") || subject.includes("取消")) continue;
      const body = msg.getPlainBody();
      const parsed = parseReservationBody(body);
      if (parsed) {
        const existingEvents = calendar.getEvents(parsed.startTime, parsed.endTime);
        const isAlreadyRegistered = existingEvents.some(e => e.getTitle().includes("⛳️練習") || e.getTitle().includes("練習"));
        if (!isAlreadyRegistered) {
          const ev = calendar.createEvent("⛳️練習 登録中", parsed.startTime, parsed.endTime, {
            location: location,
            description: "GASにより自動登録された予約です。"
          });
          // 予定自体のリマインダー通知（開始30分前・15分前）
          ev.removeAllReminders();
          ev.addPopupReminder(30);
          ev.addPopupReminder(15);
          newlyCreated.push({
            event: ev,
            startTime: parsed.startTime,
            endTime: parsed.endTime
          });
          Logger.log(`新規予定作成: ${parsed.startTime.toLocaleString("ja-JP")}`);
        }
        isProcessed = true;
      }
    }
    if (isProcessed) {
      thread.addLabel(label);
      thread.moveToArchive();
      Logger.log("新規予約メールをアーカイブしました。");
    }
  }
  return newlyCreated;
}

/**
 * キャンセルメールを検知して該当イベントを削除し、アーカイブ
 */
function handleCancelEmails(calendar, label, labelName) {
  const cancelQuery = `label:inbox -label:${labelName} from:tsgc@star7.jp subject:("キャンセルを受け付けました" OR "キャンセル" OR "お取消" OR "取消")`;
  const cancelThreads = GmailApp.search(cancelQuery, 0, 10);
  if (cancelThreads.length === 0) return [];
  let cancelledList = [];
  for (const thread of cancelThreads) {
    const messages = thread.getMessages();
    let isProcessed = false;
    for (const msg of messages) {
      if (msg.isDraft()) continue;
      const body = msg.getPlainBody();
      const parsed = parseReservationBody(body);
      if (parsed) {
        const searchStart = new Date(parsed.startTime.getTime() - 30 * 60 * 1000);
        const searchEnd = new Date(parsed.endTime.getTime() + 30 * 60 * 1000);
        const events = calendar.getEvents(searchStart, searchEnd, { search: "練習" });
        for (const ev of events) {
          const title = ev.getTitle();
          Logger.log(`キャンセル対象の予定を削除: ${title} (${ev.getStartTime().toLocaleString("ja-JP")})`);
          cancelledList.push({
            title: title,
            startTime: parsed.startTime,
            endTime: parsed.endTime
          });
          ev.deleteEvent();
        }
        isProcessed = true;
      }
    }
    if (isProcessed) {
      thread.addLabel(label);
      thread.moveToArchive();
      Logger.log("キャンセルメールをアーカイブしました。");
    }
  }
  return cancelledList;
}

/**
 * 登録完了通知（LINE）
 */
function sendBookingNotifications(calendar, createdList) {
  for (const item of createdList) {
    const refreshedEvents = calendar.getEvents(item.startTime, item.endTime);
    const targetEvent = refreshedEvents.find(e => e.getTitle().includes("⛳️練習")) || item.event;
    const eventTitle = targetEvent.getTitle();
    const startStr = Utilities.formatDate(item.startTime, "Asia/Tokyo", "yyyy/MM/dd(E) HH:mm");
    const endStr = Utilities.formatDate(item.endTime, "Asia/Tokyo", "HH:mm");
    const lineMsg = [
      `【ゴルフ予約登録 完了】`,
      `━━━━━━━━━━━━━━━`,
      `⛳️ 予定名: ${eventTitle}`,
      `📅 日時: ${startStr} ～ ${endStr}`,
      `📍 場所: 東京趣味令処ん ごるふくらぶ`,
      `━━━━━━━━━━━━━━━`,
      `カレンダーへ自動登録しました。`
    ].join("\n");
    sendLineMessage(lineMsg);
  }
}

/**
 * キャンセル完了通知（LINE）
 */
function sendCancelNotifications(cancelledList) {
  for (const item of cancelledList) {
    const startStr = Utilities.formatDate(item.startTime, "Asia/Tokyo", "yyyy/MM/dd(E) HH:mm");
    const endStr = Utilities.formatDate(item.endTime, "Asia/Tokyo", "HH:mm");
    const lineMsg = [
      `【ゴルフ予約キャンセル 完了】`,
      `━━━━━━━━━━━━━━━`,
      `🗑 削除予定: ${item.title}`,
      `📅 日時: ${startStr} ～ ${endStr}`,
      `━━━━━━━━━━━━━━━`,
      `カレンダーから削除し、以降の連番を自動補正しました。`
    ].join("\n");
    sendLineMessage(lineMsg);
  }
}

/**
 * LINE Messaging API を使ってプッシュ通知を送信
 */
function sendLineMessage(messageText) {
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty("LINE_CHANNEL_ACCESS_TOKEN") || "").trim();
  const userId = (props.getProperty("LINE_USER_ID") || "").trim();
  if (!token) {
    Logger.log("LINE_CHANNEL_ACCESS_TOKEN が未設定のためLINE通知をスキップしました。");
    return;
  }
  const url = userId
    ? "https://api.line.me/v2/bot/message/push"
    : "https://api.line.me/v2/bot/message/broadcast";
  const payload = userId
    ? { to: userId, messages: [{ type: "text", text: messageText }] }
    : { messages: [{ type: "text", text: messageText }] };
  const options = {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code === 200) {
      Logger.log("LINE通知の送信に成功しました。");
    } else {
      Logger.log(`LINE通知の送信失敗 (Status: ${code}): ${res.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`LINE通知の通信エラー: ${e}`);
  }
}

/**
 * 【テスト用】LINE通知が正しく届くか単体テストする関数
 */
function testLineNotification() {
  sendLineMessage("⛳️ ゴルフ予約GASからのLINE通知テストです！");
}

/**
 * 全期間の「練習」イベントを取得し、日時の昇順で連番を1から正しく振り直す
 */
function resequenceAllGolfEvents(calendar) {
  const startDate = new Date(2026, 0, 1);
  const endDate = new Date(new Date().getFullYear() + 1, 11, 31);
  const events = calendar.getEvents(startDate, endDate).filter(ev => {
    return ev.getTitle().includes("練習");
  });
  if (events.length === 0) return;
  events.sort((a, b) => a.getStartTime() - b.getStartTime());
  for (let i = 0; i < events.length; i++) {
    const expectedNumber = i + 1;
    const expectedTitle = `⛳️練習 ${String(expectedNumber).padStart(3, '0')}`;
    const currentTitle = events[i].getTitle();
    if (currentTitle !== expectedTitle) {
      Logger.log(`連番補正: "${currentTitle}" -> "${expectedTitle}" (${events[i].getStartTime().toLocaleString("ja-JP")})`);
      events[i].setTitle(expectedTitle);
    }
  }
}

/**
 * メール本文から日時を抽出（改行・新旧フォーマット対応）
 */
function parseReservationBody(body) {
  // パターン1: 新システム (star7.jp)
  const match1 = body.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*\([日月火水木金土]\)[\s\r\n]*(\d{1,2}):(\d{2})[～~](\d{1,2}):(\d{2})/);
  if (match1) {
    const [_, y, m, d, sh, sm, eh, em] = match1;
    return {
      startTime: new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(sh, 10), parseInt(sm, 10), 0),
      endTime: new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(eh, 10), parseInt(em, 10), 0)
    };
  }
  // パターン2: 旧システム (onemorehand.jp)
  const match2 = body.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[（\(][日月火水木金土][）\)][\s\r\n]*(\d{1,2}):(\d{2})[～~]/);
  if (match2) {
    const [_, y, m, d, sh, sm] = match2;
    const startTime = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(sh, 10), parseInt(sm, 10), 0);
    const endTime = new Date(startTime.getTime() + 50 * 60 * 1000);
    return { startTime, endTime };
  }
  return null;
}
