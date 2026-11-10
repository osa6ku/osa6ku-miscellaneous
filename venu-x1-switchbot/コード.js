// ================= 設定エリア =================
// SwitchBotトークン／クライアントシークレットはスクリプトプロパティで管理
// （プロジェクトの設定 > スクリプト プロパティ: SWITCHBOT_TOKEN / SWITCHBOT_SECRET）
const PROPS = PropertiesService.getScriptProperties();
const TOKEN = PROPS.getProperty("SWITCHBOT_TOKEN");          // SwitchBotトークン
const SECRET = PROPS.getProperty("SWITCHBOT_SECRET"); // クライアントシークレット

const LOCK_DEVICE_ID = "B0E9FE686D90";  // ロックウルトラのデバイスID（/v1.1/devices で確認: Smart Lock Ultra「ドアロック」）
const BOT_DEVICE_ID = "D8BFC586182C";    // ボットのデバイスID（/v1.1/devices で確認: Bot「オートロック」）
// =============================================

function doGet(e) {
  const target = (e && e.parameter) ? e.parameter.target : undefined;
  let deviceId = "";
  let command = "";

  if (target === "lock") {
    // 1. ロックウルトラの解錠
    deviceId = LOCK_DEVICE_ID;
    command = "unlock";
  } else if (target === "bot") {
    // 2. ボットのプッシュ動作
    deviceId = BOT_DEVICE_ID;
    command = "press";
  } else {
    return ContentService.createTextOutput("Error: Invalid target parameter (?target=lock or ?target=bot)");
  }

  const result = callSwitchBotApi(deviceId, command);
  return ContentService.createTextOutput(result);
}

function callSwitchBotApi(deviceId, command) {
  if (!TOKEN || !SECRET) {
    return "Error: SWITCHBOT_TOKEN / SWITCHBOT_SECRET がスクリプトプロパティに未設定です";
  }
  const t = Date.now().toString();
  const nonce = Utilities.getUuid();
  const data = TOKEN + t + nonce;
  const signature = Utilities.computeHmacSha256Signature(data, SECRET);
  const sign = Utilities.base64Encode(signature);

  const headers = {
    "Authorization": TOKEN,
    "sign": sign,
    "nonce": nonce,
    "t": t
  };

  const payload = JSON.stringify({
    "command": command,
    "parameter": "default",
    "commandType": "command"
  });

  const url = `https://api.switch-bot.com/v1.1/devices/${deviceId}/commands`;

  try {
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      headers: headers,
      contentType: "application/json", // ← HTTP 415を防ぐ必須指定
      payload: payload,
      muteHttpExceptions: true
    });

    const statusCode = res.getResponseCode();
    const resBody = res.getContentText();

    if (statusCode !== 200) {
      return `FAILED: HTTP ${statusCode} - ${resBody}`;
    }

    // HTTP 200 でも SwitchBot API 内部の statusCode が 100 以外なら失敗
    // （例: 160 クラウドサービス無効, 161/171 デバイス/ハブオフライン, 190 デバイスID不一致等）
    let json;
    try {
      json = JSON.parse(resBody);
    } catch (parseErr) {
      return resBody;
    }
    if (json && json.statusCode === 100) {
      return "OK: " + command;
    }
    return resBody;
  } catch (err) {
    return `EXCEPTION: ${err.message}`;
  }
}

// 動作確認用テスト関数（エディタ上で直接実行可能）
function testUnlock() {
  Logger.log(callSwitchBotApi(LOCK_DEVICE_ID, "unlock"));
}
function testPressBot() {
  Logger.log(callSwitchBotApi(BOT_DEVICE_ID, "press"));
}
