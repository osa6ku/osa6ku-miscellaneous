// ================= 設定エリア =================
// SwitchBotトークン／クライアントシークレットはスクリプトプロパティで管理
// （プロジェクトの設定 > スクリプト プロパティ: SWITCHBOT_TOKEN / SWITCHBOT_SECRET）
const PROPS = PropertiesService.getScriptProperties();
const TOKEN = PROPS.getProperty("SWITCHBOT_TOKEN");          // SwitchBotトークン
const SECRET = PROPS.getProperty("SWITCHBOT_SECRET"); // クライアントシークレット

const LOCK_DEVICE_ID = "B0E9FE686D90";  // ロックウルトラのデバイスID（/v1.1/devices で確認: Smart Lock Ultra「ドアロック」）
const BOT_DEVICE_ID = "D8BFC586182C";    // ボットのデバイスID（/v1.1/devices で確認: Bot「オートロック」）

// 温湿度取得デバイス（メインの Hub 3 を先頭に優先表示）
const TEMP_DEVICES = [
  { id: "B0E9FEE51418", name: "hub318" },         // Hub 3
  { id: "B0E9FE90904E", name: "温湿度計Pro 4E" }  // MeterPro
];
// =============================================

function doGet(e) {
  const target = (e && e.parameter && e.parameter.target) ? e.parameter.target : "status";

  if (target === "status") {
    return ContentService.createTextOutput(getHomeStatus());
  }

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
    return ContentService.createTextOutput("Error: Invalid target parameter (?target=status, ?target=lock, or ?target=bot)");
  }

  const result = callSwitchBotApi(deviceId, command);
  return ContentService.createTextOutput(result);
}

function buildSwitchBotHeaders() {
  const t = Date.now().toString();
  const nonce = Utilities.getUuid();
  const data = TOKEN + t + nonce;
  const signature = Utilities.computeHmacSha256Signature(data, SECRET);
  const sign = Utilities.base64Encode(signature);

  return {
    "Authorization": TOKEN,
    "sign": sign,
    "nonce": nonce,
    "t": t
  };
}

function parseSwitchBotResponse(res) {
  const httpCode = res.getResponseCode();
  const resBody = res.getContentText();
  if (httpCode !== 200) {
    return { ok: false, error: `HTTP ${httpCode} - ${resBody}`, raw: resBody };
  }
  try {
    const json = JSON.parse(resBody);
    if (json && json.statusCode === 100) {
      return { ok: true, json: json, raw: resBody };
    }
    return { ok: false, error: resBody, raw: resBody };
  } catch (parseErr) {
    return { ok: false, error: resBody, raw: resBody };
  }
}

function getHomeStatus() {
  if (!TOKEN || !SECRET) {
    return "Error: SWITCHBOT_TOKEN / SWITCHBOT_SECRET がスクリプトプロパティに未設定です";
  }

  const targets = TEMP_DEVICES.concat([{ id: LOCK_DEVICE_ID, name: "ドアロック" }]);
  const requests = targets.map(function (dev) {
    return {
      url: `https://api.switch-bot.com/v1.1/devices/${dev.id}/status`,
      method: "get",
      headers: buildSwitchBotHeaders(),
      muteHttpExceptions: true
    };
  });

  try {
    const responses = UrlFetchApp.fetchAll(requests);
    const lines = [];
    const lightParts = [];

    for (let i = 0; i < TEMP_DEVICES.length; i++) {
      const dev = TEMP_DEVICES[i];
      const parsed = parseSwitchBotResponse(responses[i]);
      if (parsed.ok && parsed.json.body) {
        const b = parsed.json.body;
        lines.push(`🌡 ${b.temperature}℃ / ${b.humidity}% (${dev.name})`);
        if (b.lightLevel !== undefined && b.lightLevel !== null) {
          lightParts.push(`${b.lightLevel} (${dev.name})`);
        }
      } else {
        lines.push(`🌡 ERROR (${dev.name}): ${parsed.error}`);
      }
    }

    if (lightParts.length > 0) {
      lines.push(`💡 照度: ${lightParts.join(" / ")}`);
    }

    const lockParsed = parseSwitchBotResponse(responses[TEMP_DEVICES.length]);
    if (lockParsed.ok && lockParsed.json.body) {
      const lb = lockParsed.json.body;
      const lockState = (lb.lockState || "UNKNOWN").toUpperCase();
      const doorState = (lb.doorState || "UNKNOWN").toUpperCase();
      const lockIcon = lockState === "UNLOCKED" ? "🔓" : "🔒";
      const battery = (lb.battery !== undefined && lb.battery !== null) ? lb.battery : "?";
      lines.push(`${lockIcon} ${lockState} (${doorState})`);
      lines.push(`🔋 Lock: ${battery}%`);
    } else {
      lines.push(`🔒 ERROR (Lock): ${lockParsed.error}`);
    }

    return lines.join("\n");
  } catch (err) {
    return `EXCEPTION: ${err.message}`;
  }
}

function callSwitchBotApi(deviceId, command) {
  if (!TOKEN || !SECRET) {
    return "Error: SWITCHBOT_TOKEN / SWITCHBOT_SECRET がスクリプトプロパティに未設定です";
  }

  const payload = JSON.stringify({
    "command": command,
    "parameter": "default",
    "commandType": "command"
  });

  const url = `https://api.switch-bot.com/v1.1/devices/${deviceId}/commands`;

  try {
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      headers: buildSwitchBotHeaders(),
      contentType: "application/json", // ← HTTP 415を防ぐ必須指定
      payload: payload,
      muteHttpExceptions: true
    });

    const parsed = parseSwitchBotResponse(res);
    return parsed.ok ? ("OK: " + command) : parsed.error;
  } catch (err) {
    return `EXCEPTION: ${err.message}`;
  }
}

// 動作確認用テスト関数（エディタ上で直接実行可能）
function testStatus() {
  Logger.log(getHomeStatus());
}
function testUnlock() {
  Logger.log(callSwitchBotApi(LOCK_DEVICE_ID, "unlock"));
}
function testPressBot() {
  Logger.log(callSwitchBotApi(BOT_DEVICE_ID, "press"));
}
