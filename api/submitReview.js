require('dotenv').config();
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// Helper: Lấy thời gian VN định dạng DD/MM/YYYY HH:mm:ss
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { order, staffReviews, serviceStars, speed, comment } = req.body;
  if (!order || !Array.isArray(staffReviews)) {
    return res.status(400).json({ error: 'Missing payload' });
  }

  // 1. Auth Sheets
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  // 2. Ghi vào sheet "KHđánh giá" với thời gian VN
  const nowStr = getVNTimeForSheet();

  const rows = staffReviews.map((nv, idx) => ([
    nowStr,                // Thời gian
    order.orderId,         // Mã đơn
    order.name,            // Tên KH
    order.phone,           // SĐT
    order.email,           // Email
    order.table,           // Số bàn (nếu cần)
    nv.code,               // Mã NV
    nv.shift,              // Ca LV
    nv.stars,              // Đánh giá sao NV
    serviceStars,          // Đánh giá sao quán
    speed,                 // Tốc độ phục vụ
    comment,               // Nhận xét chung
    idx === 0 ? (order.point || 10) : '' // <-- CHỈ DÒNG ĐẦU ghi điểm thưởng
  ]));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'KHđánh giá'!A6`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows }
  });

  // 3. Cập nhật trạng thái và điểm đánh giá vào sheet "Orders"
  // Đọc toàn bộ sheet Orders để xác định vị trí cần update
  const ordersResult = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'Orders'!A1:T` // Đảm bảo đủ tới cột S
  });
  const orderRows = ordersResult.data.values || [];

  if (orderRows.length < 2) {
    return res.status(400).json({ error: 'Orders sheet empty' });
  }

  // Xác định vị trí cột: R (17) cho trạng thái đánh giá, S (18) cho điểm thưởng
  const colR = 'R'; // Trạng thái đánh giá
  const colS = 'S'; // Điểm thưởng

  let firstReviewRow = -1;
  for (let i = 1; i < orderRows.length; i++) {
    const row = orderRows[i];
    if (row[1] && row[1].toString().trim() === order.orderId.toString().trim()) {
      // Cập nhật trạng thái đánh giá ở cột R (17)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'Orders'!${colR}${i + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Đã đánh giá']] }
      });
      if (firstReviewRow === -1) {
        firstReviewRow = i;
      }
    }
  }
  // Chỉ cập nhật điểm thưởng ở dòng đầu tiên
  if (firstReviewRow !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'Orders'!${colS}${firstReviewRow + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[order.point || 10]] }
    });
  }

  return res.json({ ok: true });
};
