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

  // 2. Đọc sheet Orders để xác định staff đã thanh toán và lấy tổng tiền dòng đầu
  const ordersResult = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'Orders'!A1:T`
  });
  const orderRows = ordersResult.data.values || [];

  // Lọc staff đã thanh toán
  const paidStaffs = [];
  let orderFirstRow = null;
  for (let i = 1; i < orderRows.length; i++) {
    const row = orderRows[i];
    if (row[1] && row[1].toString().trim() === order.orderId.toString().trim()) {
      if (!orderFirstRow) orderFirstRow = row;
      if ((row[16] || '').trim().toLowerCase() === 'đã thanh toán') {
        // Lấy staff review truyền lên khớp mã code
        const found = staffReviews.find(s => s.code === row[5]);
        if (found) {
          paidStaffs.push({
            ...found,
            shift: row[6]   // Ca làm việc từ sheet
          });
        }
      }
    }
  }
  if (paidStaffs.length === 0) {
    return res.status(400).json({ error: 'Không có nhân viên đã thanh toán để đánh giá' });
  }
  const totalValue = orderFirstRow ? Number((orderFirstRow[11] || '').replace(/[^0-9]/g, '')) || 0 : (order.total || 0);

  // Thời gian và số điện thoại kiểu chuỗi (nhưng không thêm dấu nháy đơn)
  const nowStr = getVNTimeForSheet();
  const phoneStr = String(order.phone);

  // 3. Ghi vào sheet "KHđánh giá"
  // Nếu cần bổ sung cột tổng tiền, hãy đảm bảo Google Sheet có cột đó
  const rows = paidStaffs.map((nv, idx) => ([
    nowStr,                           // Thời gian (chuỗi, không dấu ')
    order.orderId,                    // Mã đơn
    order.name,                       // Tên KH
    phoneStr,                         // SĐT (chuỗi, không dấu ')
    order.email,                      // Email
    order.table,                      // Số bàn
    nv.code,                          // Mã NV
    nv.shift,                         // Ca LV
    nv.stars,                         // Đánh giá sao NV
    serviceStars,                     // Đánh giá sao quán
    speed,                            // Tốc độ phục vụ
    comment,                          // Nhận xét chung
    idx === 0 ? (order.point || 10) : '',      // Chỉ dòng đầu ghi điểm thưởng
  ]));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'KHđánh giá'!A6`,
    valueInputOption: 'RAW',
    requestBody: { values: rows }
  });

  // 4. Cập nhật trạng thái và điểm đánh giá vào sheet "Orders"
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
        valueInputOption: 'RAW',
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
      valueInputOption: 'RAW',
      requestBody: { values: [[order.point || 10]] }
    });
  }

  return res.json({ ok: true });
};
