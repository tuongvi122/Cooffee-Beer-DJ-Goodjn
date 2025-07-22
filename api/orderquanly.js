import { google } from 'googleapis';
import nodemailer from 'nodemailer';

if (typeof fetch === 'undefined') global.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ==================
// === KHAI BÁO BIẾN TELEGRAM ===
// ==================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_MANAGER_ID = process.env.TELEGRAM_MANAGER_ID;

// ==================
// === HELPER FUNCTIONS ===
// ==================
function cleanNumber(val) {
  if (!val) return 0;
  return Number(String(val).replace(/[^\d]/g, "")) || 0;
}
function cleanText(val) {
  return (val || '').toString().trim();
}
function getVNDatetimeString() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${pad(vnTime.getFullYear())} ${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`;
}
function parseVNTimeString(str) {
  if (!str) return new Date(0);
  const [datePart, timePart] = str.split(' ');
  if (!datePart || !timePart) return new Date(0);
  const [day, month, year] = datePart.split('/').map(Number);
  const [hour, min, sec] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour, min, sec);
}
function formatCurrency(num) {
  return Number(num).toLocaleString('vi-VN') + "₫";
}

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

// Google Sheets Auth
const sheetId = process.env.GOOGLE_SHEET_ID;
const emailService = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const auth = new google.auth.JWT(
  emailService, null, key,
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth });

// Sheet and columns mapping
const ORDERS_SHEET = "Orders";
const PRODUCTS_SHEET = "Products";
const COLS = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11,
  M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20
};
async function getOrdersSheetId() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === ORDERS_SHEET);
  return sheet ? sheet.properties.sheetId : 0;
}
async function sendEmail(to, subject, html) {
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    html
  });
}

// ==================
// === GỬI TELEGRAM (giống submitOrder.js) ===
// ==================

// Gửi telegram cho 1 chatId
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

// Lấy map Telegram từ sheet IDDISCORD!A2:B
async function getTelegramMap() {
  const teleData = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'IDDISCORD!A2:B'
  });
  return Object.fromEntries((teleData.data.values || []).map(([maNV, teleId]) => [maNV, teleId]));
}

// Gửi telegram đến nhân viên (không trùng) và quản lý
async function sendTelegramToStaffAndManager(maNVs, content) {
  const mapTele = await getTelegramMap();
  const sent = new Set();
  // Gửi từng nhân viên (loại trùng)
  for (const maNV of maNVs) {
    const teleId = mapTele[maNV];
    if (teleId && !sent.has(teleId)) {
      await sendTelegram(teleId, content);
      sent.add(teleId);
    }
  }
  // Gửi quản lý (luôn luôn)
  if (TELEGRAM_MANAGER_ID) {
    await sendTelegram(TELEGRAM_MANAGER_ID, content);
  }
}

// Tạo nội dung thông báo cho Telegram
function telegramOrderText({
  titleIcon,
  titleText,
  time,
  orderId,
  name,
  phone,
  email,
  table,
  note,
  staffList,
  total,
  ghiChu
}) {
  return (
`${titleIcon} *${titleText.toUpperCase()}*

⏰ Thời gian: ${time}
🆔 Mã đơn: ${orderId}
👤 Khách hàng: ${name}
📞 SĐT: ${phone}
✉️ Email: ${email}
🪑 Thẻ bàn số: ${table}
📝 Ghi chú: ${note || "_Không có_"}

*Danh sách dịch vụ:*
${staffList.map(i => 
  `- *${i.maNV}*: Ca LV ${i.caLV}` +
  (i.donGia > 0 ? ` Giá: ${formatCurrency(i.donGia)}` : '') +
  ` - ${i.trangThai}`
).join('\n')}

💰 *TỔNG CỘNG:* ${formatCurrency(total)}
${ghiChu ? `\n📝 *Ghi chú quản lý:* ${ghiChu}` : ''}
`
  );
}

// Email HTML xác nhận (giữ nguyên logic cũ)
function htmlOrderConfirmEmailV2({ orderId, timeVNStr, name, phone, email, table, note, staffList, total }) {
  const contact = email;
  const orderCode = orderId;
  const tableNum = table;
  const address = note;
  const items = staffList;
  return `
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
        <th style="background:#f2f7fa;width:38%;font-weight:600;border:1px solid #dbe5ec;padding:7px 8px 7px 12px;text-align:left;font-size:14px;vertical-align:top;">Thẻ bàn số</th>
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
  </div>`;
}

// Gửi Email/Telegram sau khi lưu đơn (gửi từng người, giống submitOrder.js)
async function sendMailAndTelegram({ staffList, orderId, name, phone, email, table, note, ghiChu, tongcong }) {
  let allCancel = staffList.every(s => (s.trangThai === "Hủy đơn"));
  let staffDongY = staffList.filter(s => s.trangThai === "Đồng ý" && cleanNumber(s.donGia) > 0);
  const maNVs = staffList.map(s => s.maNV).filter(Boolean);
  const timeVNStr = getVNDatetimeString();
  const total = staffList.reduce((sum, s) => sum + cleanNumber(s.donGia), 0);

  let teleTitle = allCancel
    ? "HỦY ĐƠN HÀNG SỐ " + orderId
    : "XÁC NHẬN ĐƠN HÀNG SỐ " + orderId;

  let teleIcon = allCancel ? "❌" : "✅";

  let teleMsg = telegramOrderText({
    titleIcon: teleIcon,
    titleText: teleTitle,
    time: timeVNStr,
    orderId,
    name,
    phone,
    email,
    table,
    note,
    staffList,
    total,
    ghiChu
  });

  try {
    await sendTelegramToStaffAndManager(maNVs, teleMsg);
  } catch (e) {
    console.error('LỖI gửi Telegram:', e.message);
  }

  // Email xác nhận (giữ nguyên)
  if (staffDongY.length > 0) {
    try {
      await sendEmail(
        email,
        `Đơn đặt dịch vụ - Mã đơn ${orderId}`,
        htmlOrderConfirmEmailV2({
          orderId,
          timeVNStr,
          name,
          phone,
          email,
          table,
          note,
          staffList: staffDongY,
          total: staffDongY.reduce((sum, s) => sum + cleanNumber(s.donGia), 0)
        })
      );
    } catch (e) {
      console.error('LỖI gửi Email xác nhận:', e.message);
    }
  }
  // Email hủy đơn vẫn giữ như cũ (gửi cho khách)
  if (allCancel) {
    try {
      await sendEmail(email, "Hủy đơn hàng", `
        <div style="background:#e3f2fd;border:1px solid #2196f3;padding:22px 16px 14px 16px;border-radius:7px;text-align:center;">
          <div style="font-size:18px;font-weight:bold;color:#1565c0;padding-bottom:8px;">Hủy đơn hàng</div>
          <div style="font-size:16px;color:#c62828;padding-bottom:4px;">Đơn hàng số ${orderId} của quý khách được chấp nhận <b>Hủy</b> thành công.</div>
          <div style="color:#1976d2;font-size:15px;">Hẹn quý khách đặt dịch vụ lần sau, xin cảm ơn!</div>
        </div>
      `);
    } catch (e) {
      console.error('LỖI gửi Email hủy:', e.message);
    }
  }
}

// ==========================
// ==== API ROUTE HANDLER ====
// ==========================
export default async function handler(req, res) {
  // --- GET products ---
  if (req.method === 'GET' && req.query && req.query.products === '1') {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: PRODUCTS_SHEET
      });
      const rows = result.data.values;
      if (!rows || rows.length < 2) return res.status(200).json({ products: [] });
      const products = rows.slice(1)
        .filter(row => {
          const status = (row[5] || '').toString().trim();
          const lockStatus = (row[6] || '').toString().trim();
          return status === 'Làm việc' && lockStatus === '';
        })
        .map(row => ({
          maNV: row[1],
          caLV: row[2],
          donGia: cleanNumber(row[3]),
          status: row[5],
          lockStatus: row[6],
        }));
      return res.status(200).json({ products });
    } catch (error) {
      return res.status(500).json({ products: [], error: error.message });
    }
  }
  // Endpoint: /api/orderquanly?productsAll=1 -> trả về tất cả nhân viên
  if (req.method === 'GET' && req.query && req.query.productsAll === '1') {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: PRODUCTS_SHEET
      });
      const rows = result.data.values;
      if (!rows || rows.length < 2) return res.status(200).json({ products: [] });
      const products = rows.slice(1)
        .map(row => ({
          maNV: row[1],
          caLV: row[2],
          donGia: cleanNumber(row[3]),
          status: row[5],
          lockStatus: row[6],
        }));
      return res.status(200).json({ products });
    } catch (error) {
      return res.status(500).json({ products: [], error: error.message });
    }
  }

  // --- POST: Lưu/cập nhật đơn hàng, gửi mail và Telegram ---
  if (req.method === 'POST') {
    try {
      const {
        orderId, staffList, ghiChu, huydon, tongcong,
        name, phone, email, table, note
      } = req.body;
      if (!orderId || !Array.isArray(staffList) || !staffList.length) {
        return res.status(400).json({ error: 'Thiếu thông tin đơn hàng hoặc danh sách nhân viên' });
      }

      // 1. Đọc toàn bộ sheet vào rows (để xác định dòng cần xóa)
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: ORDERS_SHEET + '!A1:U2500'
      });
      const header = getRes.data.values[0];
      const rows = getRes.data.values.slice(1);

      // 2. Xác định index dòng cần xóa của đơn hàng cũ
      const oldRowsIdx = [];
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][COLS.B]) === String(orderId)) oldRowsIdx.push(i);
      }

      // 3. Lấy giá trị giảm giá cũ từ cột K, nếu có
      let oldDiscount = 0;
      if (oldRowsIdx.length > 0) oldDiscount = cleanNumber(rows[oldRowsIdx[0]][COLS.K]);

      // 4. Xóa vật lý các dòng cũ bằng batchUpdate/deleteDimension (nếu có)
      if (oldRowsIdx.length > 0) {
        const ordersSheetId = await getOrdersSheetId();
        // Chuyển về index của sheet (bao gồm header), rows[0] là dòng 2 trên sheet
        // oldRowsIdx là index trong mảng rows, sheet là dòng oldRowsIdx+1 (do header là dòng 1)
        // Chuẩn bị các range liên tiếp
        const sortedIdx = oldRowsIdx.map(i => i + 1).sort((a, b) => a - b); // sheet index (header dòng 0)
        let requests = [];
        let start = sortedIdx[0];
        let end = start + 1;
        for (let i = 1; i < sortedIdx.length; i++) {
          if (sortedIdx[i] === sortedIdx[i - 1] + 1) {
            end = sortedIdx[i] + 1;
          } else {
            requests.push({
              deleteDimension: {
                range: {
                  sheetId: ordersSheetId,
                  dimension: 'ROWS',
                  startIndex: start,
                  endIndex: end
                }
              }
            });
            start = sortedIdx[i];
            end = start + 1;
          }
        }
        requests.push({
          deleteDimension: {
            range: {
              sheetId: ordersSheetId,
              dimension: 'ROWS',
              startIndex: start,
              endIndex: end
            }
          }
        });
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { requests }
        });
      }

      // 5. Tạo dòng mới cho đơn hàng
      let nowStr = getVNDatetimeString();
      let newOrderRows = staffList.map((s, idx) => {
        let state = s.trangThai || "Đồng ý";
        let colO = "", colP = "", colQ = "", colI = 0;
        if (state === "Đồng ý") {
          colO = colP = "V";
          colI = cleanNumber(s.donGia);
          colQ = "";
        } else if (state === "Không tham gia") {
          colO = colP = "Không tham gia";
          colI = 0;
          colQ = "Hủy đơn hàng";
        } else if (state === "Hủy đơn") {
          colO = colP = "X";
          colI = 0;
          colQ = "Hủy đơn hàng";
        }
        let row = [];
        row[COLS.A] = nowStr;
        row[COLS.B] = cleanNumber(orderId);
        row[COLS.C] = cleanText(name);
        row[COLS.D] = cleanText(phone);
        row[COLS.E] = cleanText(email);
        row[COLS.F] = cleanText(s.maNV);
        row[COLS.G] = cleanNumber(s.caLV);
        row[COLS.H] = cleanNumber(s.donGia);
        row[COLS.I] = colI;
        row[COLS.J] = (idx === 0) ? cleanNumber(tongcong) : "";
        row[COLS.K] = (idx === 0) ? oldDiscount : "";
        row[COLS.L] = (idx === 0) ? (cleanNumber(tongcong) - oldDiscount) : "";
        row[COLS.M] = cleanNumber(table);
        row[COLS.N] = cleanText(note);
        row[COLS.O] = colO;
        row[COLS.P] = colP;
        row[COLS.Q] = colQ;
        row[COLS.T] = cleanText(ghiChu);
        return row;
      });

      // 6. Append dòng mới vào sheet Orders
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: ORDERS_SHEET + "!A1",
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newOrderRows }
      });

      // ... Gửi Email + Telegram giữ nguyên như cũ ...
      await sendMailAndTelegram({
        staffList, orderId, name, phone, email, table, note, ghiChu, tongcong
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
    return;
  }

  // --- GET: Trả về dữ liệu Orders đã lọc và SẮP XẾP, xác định trạng thái nút xác nhận ---
  if (req.method === 'GET') {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: ORDERS_SHEET + '!A2:T'
      });
      const rows = result.data.values;
      if (!rows || rows.length < 2) return res.status(200).json({ orders: [] });
      let ordersMap = {};

      for (let i = 1; i < rows.length; i++) {
        let row = rows[i];
        let orderId = row[COLS.B];
        if (!orderId) continue;
        if (!ordersMap[orderId]) ordersMap[orderId] = [];
        ordersMap[orderId].push(row);
      }

      let ordersArr = [];
      for (let orderId in ordersMap) {
        let orderRows = ordersMap[orderId];
        if (orderRows.some(r => (r[COLS.Q] || "").trim() === "Đã thanh toán")) continue;
        if (!orderRows.some(r => (r[COLS.O] || "").toString().trim() !== "")) continue;

        let allO_V = orderRows.every(r => (r[COLS.O] || "").trim() === "V");
        let allP_empty = orderRows.every(r => !r[COLS.P] || (r[COLS.P] || "").trim() === "");
        let allQ_empty = orderRows.every(r => !r[COLS.Q] || (r[COLS.Q] || "").trim() === "");

        let allO_X = orderRows.every(r => (r[COLS.O] || "").trim() === "X");
        let allP_X = orderRows.every(r => (r[COLS.P] || "").trim() === "X");
        let allQ_Huy = orderRows.every(r => (r[COLS.Q] || "").trim() === "Hủy đơn hàng");

        let has_OPQ_V_X_KhongThamGia = orderRows.some(r => {
          let o = (r[COLS.O] || "").trim();
          let p = (r[COLS.P] || "").trim();
          return ["V", "X", "Không tham gia"].includes(o) || ["V", "X", "Không tham gia"].includes(p);
        });

        let confirmStatus = "chuaxacnhan";
        if (allO_V && allP_empty && allQ_empty) confirmStatus = "chuaxacnhan";
        else if (allO_X && allP_X && allQ_Huy) confirmStatus = "huydon";
        else if (has_OPQ_V_X_KhongThamGia) confirmStatus = "daxacnhan";

        let row = orderRows[0];
        let staffList = orderRows.map(r => ({
          maNV: r[COLS.F],
          caLV: r[COLS.G],
          donGia: cleanNumber(r[COLS.H]),
          trangThai:
            (r[COLS.P] === "V") ? "Đồng ý" :
              (r[COLS.P] === "Không tham gia") ? "Không tham gia" :
                (r[COLS.P] === "X") ? "Hủy đơn" : ""
        }));

        ordersArr.push({
          time: row[COLS.A],
          orderId: row[COLS.B],
          name: row[COLS.C],
          phone: row[COLS.D],
          email: row[COLS.E],
          note: row[COLS.N],
          table: row[COLS.M],
          staffList,
          total: cleanNumber(row[COLS.J]).toLocaleString('vi-VN'),
          confirmStatus,
          payStatus: (row[COLS.Q] || "").trim(),
          qlNote: row[COLS.T] || ""
        });
      }
      ordersArr.sort((a, b) => {
        let dateA = parseVNTimeString(a.time);
        let dateB = parseVNTimeString(b.time);
        return dateB - dateA;
      });
      res.status(200).json({ orders: ordersArr });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
