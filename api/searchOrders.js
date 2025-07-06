require('dotenv').config();
const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Missing phone number' });
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'Orders'!A2:T`, // Nếu cần đến cột S, nên để 'A2:S'
  });

  const rows = result.data.values || [];
  const mapOrders = {};
  const inputPhone = String(phone).replace(/\D/g, '');

  let foundAny = false;
  let foundNotCompleted = false;

  for (let row of rows) {
  const sdt = String(row[3] || '').replace(/\D/g, '');
  if (sdt !== inputPhone) continue;
  foundAny = true;
  const status = (row[16] || '').trim().toLowerCase();

  if (status !== 'đã thanh toán') {
    foundNotCompleted = true;
    continue;
  }

  const orderId = row[1] || 'undefined';

  // Nếu là dòng đầu tiên gặp orderId, lưu lại thông tin & điểm thưởng
  if (!mapOrders[orderId]) {
    const reviewed = row[17] === 'Đã đánh giá';
// Lấy point y như cách lấy 'total': chỉ lấy giá trị thực tế dòng đầu, không ép về 0 nếu rỗng
     const point = reviewed ? Number(row[18]) || 0 : 0;

    mapOrders[orderId] = {
      orderId,
      time: row[0] || '',
      name: row[2] || '',
      phone: row[3] || '',
      email: row[4] || '',
      table: row[12] || '',
      total: Number((row[11] || '').replace(/[^0-9]/g, '')) || 0,
      reviewed,
      status: reviewed ? 'Đã đánh giá' : '',
      point,
      staffCodes: [],
      staffList: [],
      reviewButton: reviewed ? 'Đã đánh giá' : 'Đánh giá',
      locked: reviewed
    };
  }

  // Dòng nào cũng có thể có staffCode/shift, nên vẫn bổ sung vào staffList
  const staffCode = row[5] || '';
  const shift = row[6] || '';
  if (staffCode) {
    mapOrders[orderId].staffCodes.push(staffCode);
    mapOrders[orderId].staffList.push({ code: staffCode, shift, stars: 5 });
  }
}
  const orders = Object.values(mapOrders);
  orders.sort((a, b) => new Date(b.time) - new Date(a.time));
  const totalPoint = orders.reduce((sum, o) => sum + (o.point || 0), 0);

  if (orders.length > 0) {
    return res.json({ orders, totalPoint });
  } else if (foundAny && foundNotCompleted) {
    return res.json({ message: 'not_completed' });
  } else if (!foundAny) {
    return res.json({ message: 'not_found' });
  } else {
    return res.json({ message: 'not_found' });
  }
};
