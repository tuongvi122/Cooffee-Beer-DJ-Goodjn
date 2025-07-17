import { google } from 'googleapis';
if (typeof fetch === 'undefined') global.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Google Sheets Auth
const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_MANAGER_ID = process.env.TELEGRAM_MANAGER_ID;

// Cache Telegram ID (5 phút)
let telegramCache = { value: null, expires: 0 };
const TELEGRAM_CACHE_TTL = 5 * 60 * 1000;

function formatCurrency(num) {
  return Number(num).toLocaleString('vi-VN') + "₫";
}
function getVNTimeForSheet() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const day = String(vnTime.getDate()).padStart(2, '0');
  const month = String(vnTime.getMonth() + 1).padStart(2, '0');
  const year = vnTime.getFullYear();
  const hours = String(vnTime.getHours()).padStart(2, '0');
  const minutes = String(vnTime.getMinutes()).padStart(2, '0');
  const seconds = String(vnTime.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}
async function generateOrderCodeByCounterSheet(tableNum) {
  const counterRange = 'COUNTER!A1:B1';
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: counterRange,
    majorDimension: 'ROWS'
  });
  let lastDay = (resp.data.values && resp.data.values[0] && resp.data.values[0][0]) || "";
  let lastNum = (resp.data.values && resp.data.values[0] && resp.data.values[0][1]) || "0";
  const now = new Date();
  const vnNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vnNow.getFullYear();
  const m = String(vnNow.getMonth() + 1).padStart(2, '0');
  const d = String(vnNow.getDate()).padStart(2, '0');
  const today = `${y}${m}${d}`;

  let orderNumber = 1;
  if (today === lastDay) {
    orderNumber = parseInt(lastNum) + 1;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: counterRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[today, orderNumber]]
    }
  });
  return `${orderNumber}${Number(tableNum)}`;
}
async function getTelegramMap() {
  const now = Date.now();
  if (telegramCache.value && telegramCache.expires > now) {
    return telegramCache.value;
  }
  const hookData = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'IDDISCORD!A2:B'
  });
  const mapHooks = Object.fromEntries((hookData.data.values || [])
    .map(([maNV, telegramId]) => [maNV, telegramId]));
  telegramCache.value = mapHooks;
  telegramCache.expires = now + TELEGRAM_CACHE_TTL;
  return mapHooks;
}
async function sendTelegram(chatId, message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('Gửi telegram thất bại:', data);
    }
  } catch (err) {
    console.error('Lỗi gửi telegram:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { name, phone, contact, tableNum, note, items } = req.body;
    await auth.authorize();

    // Lấy orderCode và Telegram ID đồng thời
    const [orderCode, mapHooks] = await Promise.all([
      generateOrderCodeByCounterSheet(tableNum),
      getTelegramMap()
    ]);
    const timeVNStr = getVNTimeForSheet();
    const total = items.reduce((sum, i) => sum + Number(i.donGia), 0);

    // Ghi đơn vào Google Sheets
    const rows = items.map((it, idx) => ([
      timeVNStr,
      Number(orderCode),
      name,
      String(phone),
      contact,
      String(it.maNV),
      Number(it.caLV),
      Number(it.donGia),
      Number(it.donGia),
      idx === 0 ? Number(total) : '',
      '',
      idx === 0 ? Number(total) : '', // L <--- SỬA ở đây cho cột L
      Number(tableNum),
      note,
      "V"
    ]));
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Orders!A2',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows }
    });

    // Gửi Telegram cho từng nhân viên và quản lý (chờ hoàn thành để đảm bảo gửi)
    const telegramMsg =
      `📝 *ĐƠN ĐẶT DỊCH VỤ MỚI*

⏰ Thời gian: ${timeVNStr}
🆔 Mã đơn: ${orderCode}
👤 Khách hàng: ${name}
📞 SĐT: ${phone}
✉️ Email: ${contact}
🪑 Bàn số: ${tableNum}
📝 Ghi chú: ${note}

*Danh sách dịch vụ:*
${items.map(i => `- *${i.maNV}*: Ca LV ${i.caLV} Giá: ${formatCurrency(i.donGia)}`).join('\n')}

💰 *TỔNG CỘNG:* ${formatCurrency(total)}
`;

    const sent = new Set();
    const telegramPromises = [];
    for (const it of items) {
      const telegramId = mapHooks[it.maNV];
      if (telegramId && !sent.has(telegramId)) {
        telegramPromises.push(sendTelegram(telegramId, telegramMsg));
        sent.add(telegramId);
      }
    }
    if (TELEGRAM_MANAGER_ID) {
      telegramPromises.push(sendTelegram(TELEGRAM_MANAGER_ID, telegramMsg));
    }
    await Promise.all(telegramPromises);

    // Trả về kết quả thành công cho FE
    res.status(200).json({ success: true, orderCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi khi xử lý đơn hàng' });
  }
}
