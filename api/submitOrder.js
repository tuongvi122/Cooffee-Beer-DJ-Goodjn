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
    const { name, phone, contact, tableNum, address, items } = req.body;
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
  phone,                   // SĐT
  contact,                 // Email
  String(it.maNV),         // Mã NV
  Number(it.caLV),         // Ca làm việc
  Number(it.donGia),       // Đơn giá
  Number(it.donGia),       // Thành tiền
  idx === 0 ? Number(total) : '', // Tổng cộng (chỉ dòng đầu)
  Number(tableNum),        // Số bàn
  address,                 // Ghi chú
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
`│ 📝 Ghi chú: ${address}\n` +
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

    // 6. Gửi email xác nhận đơn (theo mẫu đẹp)
    const html = `
  <div class="receipt-container" style="
    font-family: Arial, sans-serif;
    background: #fff;
    max-width:420px;
    margin:0 auto;
    border-radius:10px;
    border:1px solid #d9e2e7;
    box-shadow:0 2px 8px rgba(0,0,0,0.09);
    padding: 22px 18px 18px 18px;
  ">
    <div class="logo" style="text-align:left;margin-bottom:10px;">
      <img src="https://upload.wikimedia.org/wikipedia/commons/8/88/Logo_Vietcombank.png" alt="Logo" style="height:34px;" />
    </div>
    <div class="receipt-title" style="text-align:center;font-size:20px;font-weight:bold;margin-bottom:5px;color:#168d49;">Biên nhận đặt dịch vụ</div>
    <div class="order-code" style="text-align:center;font-size:16px;font-weight:bold;color:#d63384;margin-bottom:14px;padding:7px 0;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;">Mã đơn hàng: ${orderCode}</div>
    <table class="details-table" style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr>
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Thời gian đặt</th>
        <td style="background:#fff;color:#222;border:1px solid #dbe5ec;padding:7px 8px;text-align:left;font-size:14px;vertical-align:top;">${timeVNStr}</td>
      </tr>
      <tr>
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Khách hàng</th>
        <td style="background:#fff;color:#222;border:1px solid #dbe5ec;padding:7px 8px;text-align:left;font-size:14px;vertical-align:top;">${name}</td>
      </tr>
      <tr>
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Số điện thoại</th>
        <td style="background:#fff;color:#222;border:1px solid #dbe5ec;padding:7px 8px;text-align:left;font-size:14px;vertical-align:top;">${phone}</td>
      </tr>
      <tr>
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Email</th>
        <td style="background:#fff;color:#222;border:1px solid #dbe5ec;padding:7px 8px;text-align:left;font-size:14px;vertical-align:top;">${contact}</td>
      </tr>
      <tr>
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Bàn số</th>
        <td style="background:#fff;color:#222;border:1px solid #dbe5ec;padding:7px 8px;text-align:left;font-size:14px;vertical-align:top;">${tableNum}</td>
      </tr>
      <tr>
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Ghi chú</th>
        <td style="background:#fff;color:#222;border:1px solid #dbe5ec;padding:7px 8px;text-align:left;font-size:14px;vertical-align:top;">${address}</td>
      </tr>
    </table>
    <table class="product-table" style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:13.5px;">
      <tr>
        <th style="background:#f2f7fa;font-weight:600;border:1px solid #e6ecf2;padding:6px 4px;text-align:center;">Mã NV</th>
        <th style="background:#f2f7fa;font-weight:600;border:1px solid #e6ecf2;padding:6px 4px;text-align:center;">Ca LV</th>
        <th style="background:#f2f7fa;font-weight:600;border:1px solid #e6ecf2;padding:6px 4px;text-align:center;">Đơn giá</th>
      </tr>
      ${items.map(i => `
      <tr>
        <td style="border:1px solid #e6ecf2;padding:6px 4px;text-align:center;">${i.maNV}</td>
        <td style="border:1px solid #e6ecf2;padding:6px 4px;text-align:center;">${i.caLV}</td>
        <td style="border:1px solid #e6ecf2;padding:6px 4px;text-align:center;">${formatCurrency(i.donGia)}</td>
      </tr>
      `).join('')}
      <tr class="total-row">
        <td colspan="2" style="font-weight:bold;background:#fff;text-align:center;color:#111;font-size:16px;border:1px solid #e6ecf2;">Tổng cộng</td>
        <td style="font-weight:bold;background:#fff;text-align:center;color:#111;font-size:16px;border:1px solid #e6ecf2;">${formatCurrency(total)}</td>
      </tr>
    </table>
    <div class="thankyou" style="text-align:center;color:#168d49;font-size:16px;margin-top:12px;font-weight:600;">
      Cảm ơn Quý khách đã đặt dịch vụ tại GooDjn DJ Coffee & Beer!
    </div>
  </div>`;

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: contact,
      subject: `Đơn đặt dịch vụ từ GooDjn DJ Coffee & Beer`,
      html
    });

    res.status(200).json({ success: true, orderCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi khi xử lý đơn hàng' });
  }
}
