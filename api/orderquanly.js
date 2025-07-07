import { google } from 'googleapis';
import nodemailer from 'nodemailer';

if (typeof fetch === 'undefined') global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper to clean number (remove . , đ ...)
function cleanNumber(val) {
  if (!val) return 0;
  return Number(String(val).replace(/[^\d]/g, "")) || 0;
}

// Helper to clean text (ensure string)
function cleanText(val) {
  return (val || '').toString().trim();
}

// Helper for current time in dd/MM/yyyy HH:mm:ss (giờ VN)
function getVNDatetimeString() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()} ${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`;
}

// Helper: parse time string "dd/MM/yyyy HH:mm:ss" to Date object
function parseVNTimeString(str) {
  if (!str) return new Date(0);
  const [datePart, timePart] = str.split(' ');
  if (!datePart || !timePart) return new Date(0);
  const [day, month, year] = datePart.split('/').map(Number);
  const [hour, min, sec] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour, min, sec);
}

// Helper: định dạng tiền VNĐ
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
const sheets = google.sheets({version: 'v4', auth});

// Sheet and columns mapping (UPDATED for new columns)
const ORDERS_SHEET = "Orders";
const PRODUCTS_SHEET = "Products";
const COLS = {
  A: 0,   // Timestamp
  B: 1,   // MÃ DH (orderId)
  C: 2,   // TÊN KHÁCH HÀNG
  D: 3,   // SĐT
  E: 4,   // EMAIL
  F: 5,   // MÃ NV
  G: 6,   // CA LV
  H: 7,   // ĐƠN GIÁ
  I: 8,   // THÀNH TIỀN
  J: 9,   // TỔNG CỘNG (dòng đầu)
  K: 10,  // GIẢM GIÁ (mới)
  L: 11,  // TỔNG THU (mới)
  M: 12,  // SỐ BÀN (đã dịch)
  N: 13,  // GHI CHÚ DH (đã dịch)
  O: 14,  // KH ĐÃ ĐẶT ĐƠN (đã dịch)
  P: 15,  // QUẢN LÝ XÁC NHẬN DH (đã dịch)
  Q: 16,  // TÌNH TRẠNG THANH TOÁN (đã dịch)
  R: 17,  // ĐÁNH GIÁ KHÁCH HÀNG
  S: 18,  // ĐIỂM ĐÁNH GIÁ
  T: 19,  // GHI CHÚ (quản lý ghi chú - cuối, đã dịch)
  U: 20   // TRẠNG THÁI IN BILL (nếu cần)
};

// Get Orders sheetId dynamically
async function getOrdersSheetId() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === ORDERS_SHEET);
  return sheet ? sheet.properties.sheetId : 0;
}

// Gửi Email cho khách hàng
async function sendEmail(to, subject, html) {
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    html
  });
}

// Gửi Discord cho nhân viên và quản lý (KHÔNG thay đổi mẫu đóng khung)
async function sendDiscordToStaffAndManager(maNVs, content) {
  // Lấy webhook từ sheet IDDISCORD (A2:B) [mã NV, URL webhook]
  const hookData = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'IDDISCORD!A2:B'
  });
  const mapHooks = Object.fromEntries((hookData.data.values||[]).map(([maNV, url]) => [maNV, url]));
  const sent = new Set();
  const discordPromises = [];
  for (const maNV of maNVs) {
    const url = mapHooks[maNV];
    if (url && !sent.has(url)) {
      discordPromises.push(
        fetch(url, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ content })
        })
      );
      sent.add(url);
    }
  }
  // Gửi cho quản lý
  if (process.env.MANAGER_DISCORD_WEBHOOK) {
    discordPromises.push(
      fetch(process.env.MANAGER_DISCORD_WEBHOOK, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ content })
      })
    );
  }
  await Promise.all(discordPromises);
}

// Tạo hộp Discord đẹp (giữ nguyên mẫu cũ)
function discordOrderBox({
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
  ghiChu // <- thêm dòng này
}) {
  return [
    "┌────────────────────────────────┐",
    `│ ${titleIcon} **${titleText.toUpperCase()}**`,
    "│--------------------------------",
    `│⏰ Thời gian: ${time}`,
    `│🧾 Mã đơn hàng: ${orderId}`,
    `│👤 Khách hàng: ${name}`,
    `│📞 SĐT: ${phone}`,
    `│📧 Email: ${email}`,
    `│🪑 Bàn số: ${table}`,
    `│💬 Ghi chú: ${note}`,
    "│",
    "│**Danh sách dịch vụ:**",
        ...staffList.map(s => `- ${s.maNV}  Ca ${s.caLV}  ${s.trangThai}`),
    "│---------------------------------",
    `│💰 **TỔNG CỘNG: ${formatCurrency(total)}**`,
        ghiChu ? `📝 **Ghi chú quản lý:** ${ghiChu}` : "", // Thêm dòng này
    "└────────────────────────────────┘"
  ].join('\n');
}

// Tạo HTML email xác nhận mới chuyên nghiệp (chỉ show NV "Đồng ý")
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
  </div>`;
}
// Gửi Email/Discord sau khi lưu đơn (Email chỉ NV "Đồng ý")
async function sendMailAndDiscord({staffList, orderId, name, phone, email, table, note, ghiChu, tongcong}) {
  let allCancel = staffList.every(s => (s.trangThai === "Hủy đơn"));
  // Chỉ lấy NV "Đồng ý" có giá trị > 0
  let staffDongY = staffList.filter(s => s.trangThai === "Đồng ý" && cleanNumber(s.donGia) > 0);
  const maNVs = staffList.map(s=>s.maNV).filter(Boolean);
  const timeVNStr = getVNDatetimeString();
  const total = staffList.reduce((sum, s) => sum + cleanNumber(s.donGia), 0);

  let discordTitle = allCancel
    ? "HỦY ĐƠN HÀNG SỐ " + orderId
    : "XÁC NHẬN ĐƠN HÀNG SỐ " + orderId;

  let discordIcon = allCancel ? "❌" : "✅";

  let discordMsg = discordOrderBox({
    titleIcon: discordIcon,
    titleText: discordTitle,
    time: timeVNStr,
    orderId,
    name,
    phone,
    email,
    table,
    note,
    staffList,
    total,
    ghiChu // Thêm dòng này
  });

  try {
    await sendDiscordToStaffAndManager(maNVs, discordMsg);
  } catch(e) {
    console.error('LỖI gửi Discord:', e.message);
  }

  // Chỉ cần có NV "Đồng ý" (có giá trị) thì gửi email xác nhận cho khách, chỉ liệt kê NV này
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
  } catch(e) {
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
    } catch(e) {
      console.error('LỖI gửi Email hủy:', e.message);
    }
  }
}
export default async function handler(req, res) {
  // --- GET products ---
  if (req.method === 'GET' && req.query && req.query.products === '1') {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: PRODUCTS_SHEET
      });
      const rows = result.data.values;
      if (!rows || rows.length < 2) return res.status(200).json({products: []});
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
      return res.status(200).json({products});
    } catch (error) {
      return res.status(500).json({products: [], error: error.message});
    }
  }
  // Endpoint: /api/orderquanly?productsAll=1 -> trả về tất cả nhân viên, không filter điều kiện nào cả
if (req.method === 'GET' && req.query && req.query.productsAll === '1') {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: PRODUCTS_SHEET
    });
    const rows = result.data.values;
    if (!rows || rows.length < 2) return res.status(200).json({products: []});
    const products = rows.slice(1)
      .map(row => ({
        maNV: row[1],
        caLV: row[2],
        donGia: cleanNumber(row[3]),
        status: row[5],
        lockStatus: row[6],
      }));
    return res.status(200).json({products});
  } catch (error) {
    return res.status(500).json({products: [], error: error.message});
  }
}

  // --- POST: Lưu/cập nhật đơn hàng, gửi mail và Discord ---
  if (req.method === 'POST') {
    try {
      const {
        orderId, staffList, ghiChu, huydon, tongcong,
        name, phone, email, table, note
      } = req.body;
      if (!orderId || !Array.isArray(staffList) || !staffList.length) {
        return res.status(400).json({error: 'Thiếu thông tin đơn hàng hoặc danh sách nhân viên'});
      }

      // Lấy dữ liệu cũ
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: ORDERS_SHEET
      });
      const rows = getRes.data.values || [];

      // Xác định các dòng liên quan đơn hàng này
      let existingRows = [];
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][COLS.B]) === String(orderId)) existingRows.push(i);
      }
      // Xác định có nhân viên mới không
      let currentMaNVs = rows.filter(r => String(r[COLS.B]) === String(orderId)).map(r => (r[COLS.F] || "") + "_" + (r[COLS.G] || ""));
      let reqMaNVs = staffList.map(s => (s.maNV || "") + "_" + (s.caLV || ""));
      let hasNewStaff = reqMaNVs.some(reqID => !currentMaNVs.includes(reqID)) || currentMaNVs.length !== reqMaNVs.length;

      // === QUY TRÌNH A: Có nhân viên mới ===
      if (hasNewStaff) {
        const ordersSheetId = await getOrdersSheetId();
        for (let i = existingRows.length - 1; i >= 0; i--) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: {
              requests: [{
                deleteDimension: {
                  range: {
                    sheetId: ordersSheetId,
                    dimension: 'ROWS',
                    startIndex: existingRows[i],
                    endIndex: existingRows[i] + 1
                  }
                }
              }]
            }
          });
        }
        let nowStr = getVNDatetimeString();
        let values = [];
        staffList.forEach((s, idx) => {
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
          row[COLS.K] = ""; // GIẢM GIÁ (bổ sung nếu có, còn lại để trống)
          row[COLS.L] = ""; // TỔNG THU (bổ sung nếu có, còn lại để trống)
          row[COLS.M] = cleanNumber(table); // SỐ BÀN (đã cập nhật lại)
          row[COLS.N] = cleanText(note);
          row[COLS.O] = colO; // KH ĐÃ ĐẶT ĐƠN
          row[COLS.P] = colP; // QL XÁC NHẬN
          row[COLS.Q] = colQ; // TÌNH TRẠNG THANH TOÁN
          // Các cột R, S, T, U nếu cần có thể bổ sung ở đây (ghi chú QL thì T)
          row[COLS.T] = cleanText(ghiChu); // GHI CHÚ QL
          values.push(row);
        });
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: ORDERS_SHEET + "!A:Z",
          valueInputOption: 'USER_ENTERED',
          requestBody: { values }
        });

        // Gửi Email + Discord khi xác nhận đơn hàng
        await sendMailAndDiscord({
          staffList, orderId, name, phone, email, table, note, ghiChu, tongcong
        });

        return res.status(200).json({success: true});
      }

      // === QUY TRÌNH B: Không có nhân viên mới ===
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][COLS.B]) === String(orderId)) {
          let staff = staffList.find(s => String(s.maNV) === String(rows[i][COLS.F]) && String(s.caLV) === String(rows[i][COLS.G]));
          if (staff) {
            let state = staff.trangThai || "Đồng ý";
            let colO = "", colP = "", colQ = "", colI = 0;
            if (state === "Đồng ý") {
              colO = colP = "V";
              colI = cleanNumber(staff.donGia);
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
            rows[i][COLS.H] = cleanNumber(staff.donGia);
            rows[i][COLS.I] = colI;
            if (i === existingRows[0]) rows[i][COLS.J] = cleanNumber(tongcong);
            // Giảm giá, tổng thu nếu có thay đổi thì cập nhật ở COLS.K, COLS.L
            rows[i][COLS.M] = cleanNumber(table); // SỐ BÀN
            rows[i][COLS.N] = cleanText(note); // GHI CHÚ ĐH
            rows[i][COLS.O] = colO; // KH ĐÃ ĐẶT ĐƠN
            rows[i][COLS.P] = colP; // QL XÁC NHẬN
            rows[i][COLS.Q] = colQ; // TÌNH TRẠNG THANH TOÁN
            rows[i][COLS.T] = cleanText(ghiChu); // GHI CHÚ QL
          }
        }
      }
for (const i of existingRows) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${ORDERS_SHEET}!A${i + 1}:T${i + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rows[i].slice(0, 20)] }
  });
}

      // Gửi Email + Discord khi xác nhận đơn hàng
      await sendMailAndDiscord({
        staffList, orderId, name, phone, email, table, note, ghiChu, tongcong
      });

      return res.status(200).json({success: true});
    } catch (error) {
      res.status(500).json({error: error.message || 'Internal server error'});
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
      if (!rows || rows.length < 2) return res.status(200).json({orders: []});
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
        // 2. BỎ QUA ĐƠN KHÔNG DÒNG NÀO Ở CỘT O ("KH ĐÃ ĐẶT ĐƠN") KHÁC RỖNG
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
      res.status(200).json({orders: ordersArr});
    } catch (error) {
      res.status(500).json({error: error.message || 'Internal server error'});
    }
    return;
  }

  res.status(405).json({error: 'Method not allowed'});
}
