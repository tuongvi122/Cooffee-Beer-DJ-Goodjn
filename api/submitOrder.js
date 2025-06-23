import { google } from 'googleapis';
import nodemailer from 'nodemailer';

if (typeof fetch === 'undefined') global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Google Sheets Auth
const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth });

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Helper: Định dạng tiền tệ VN
function formatCurrency(num) {
  return Number(num).toLocaleString('vi-VN') + "₫";
}

// Helper: Lấy thời gian VN định dạng DD/MM/YYYY HH:mm:ss
function getVNTimeForSheet() {
  const now = new Date();
  // Chuyển về múi giờ Việt Nam
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  
  const day = String(vnTime.getDate()).padStart(2, '0');
  const month = String(vnTime.getMonth() + 1).padStart(2, '0');
  const year = vnTime.getFullYear();
  const hours = String(vnTime.getHours()).padStart(2, '0');
  const minutes = String(vnTime.getMinutes()).padStart(2, '0');
  const seconds = String(vnTime.getSeconds()).padStart(2, '0');
  
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

// Helper: Sinh mã đơn hàng theo quy tắc mới
// - Đọc giá trị dòng cuối cùng cột B, loại 2 ký tự cuối, lấy số, +1, ghép với số bàn
async function generateOrderCode(tableNum) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Orders!B2:B'
  });
  const codes = resp.data.values || [];
  let last = codes.length ? codes[codes.length - 1][0] : "0";
  if (typeof last !== "string") last = String(last);
  // Loại 2 ký tự cuối, lấy phần còn lại
  const prefix = last.length > 2 ? last.slice(0, -2) : "0";
  const num = parseInt(prefix) || 0;
  const next = num + 1;
  // Ghép với số bàn
  return `${next}${Number(tableNum)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
   const { name, phone, contact, tableNum, note, items } = req.body;
    await auth.authorize();

  // 1. Sinh mã, tổng, thời gian VN
const orderCode = await generateOrderCode(tableNum);
const timeVNStr = getVNTimeForSheet(); // Định dạng DD/MM/YYYY HH:mm:ss
const total = items.reduce((sum, i) => sum + Number(i.donGia), 0);

// 2. Ghi Google Sheets (lưu thời gian dạng text theo định dạng VN)
const rows = items.map((it, idx) => ([
  timeVNStr,               // Thời gian
  Number(orderCode),       // Mã đơn hàng
  name,                    // Họ tên
  String(phone),           // SĐT
  contact,                 // Email
  String(it.maNV),         // Mã NV
  Number(it.caLV),         // Ca làm việc
  Number(it.donGia),       // Đơn giá
  Number(it.donGia),       // Thành tiền
  idx === 0 ? Number(total) : '', // Tổng cộng (chỉ dòng đầu)
  Number(tableNum),        // Số bàn
  note,                 // Ghi chú
  "V"                      // Cột M: Ghi thêm chữ V
]));

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Orders!A2',
      valueInputOption: 'USER_ENTERED', // để Google Sheets tự nhận kiểu số/ngày
      requestBody: { values: rows }
    });

    // 3. Lấy Discord webhook từ sheet IDDISCORD
    const hookData = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'IDDISCORD!A2:B'
    });
    const mapHooks = Object.fromEntries((hookData.data.values||[])
      .map(([maNV, url]) => [maNV, url]));

    // 4. Format tin nhắn Discord
    const discordMsg = 
"┌────────────────────────────────┐\n" +
"│  📝 **ĐƠN ĐẶT DỊCH VỤ MỚI**\n" +
"│--------------------------------\n" +
`│ ⏰ Thời gian: ${timeVNStr}\n` +
`│ 🆔 Mã đơn: ${orderCode}\n` +
`│ 👤 Khách hàng: ${name}\n` +
`│ 📞 SĐT: ${phone}\n` +
`│ ✉️ Email: ${contact}\n` +
`│ 🪑 Bàn số: ${tableNum}\n` +
`│ 📝 Ghi chú: ${note}\n` +
"│\n" +
"│ **Danh sách dịch vụ:**\n" +
items.map(i => 
`│ - ${i.maNV}: Ca LV ${i.caLV} Giá: ${formatCurrency(i.donGia)}`
).join('\n') + "\n" +
"│ - - - - - - - - - - - - - - - -\n" +
`│ 💰 **TỔNG CỘNG: ${formatCurrency(total)}**\n` +
"└────────────────────────────────┘";

    // 5. Gửi Discord đến từng nhân viên (mỗi NV chỉ gửi một lần, gửi song song)
    const sent = new Set();
    const discordPromises = [];
    for (const it of items) {
      const url = mapHooks[it.maNV];
      if (url && !sent.has(url)) {
        discordPromises.push(
          fetch(url, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ content: discordMsg })
          })
        );
        sent.add(url);
      }
    }
    // Gửi quản lý chung nếu có
    if (process.env.MANAGER_DISCORD_WEBHOOK) {
      discordPromises.push(
        fetch(process.env.MANAGER_DISCORD_WEBHOOK, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ content: discordMsg })
        })
      );
    }
    await Promise.all(discordPromises);

    res.status(200).json({ success: true, orderCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi khi xử lý đơn hàng' });
  }
}
