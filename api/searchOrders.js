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
    range: `'Orders'!A2:R`,
  });

  const rows = result.data.values || [];
  const mapOrders = {};
  const inputPhone = String(phone).replace(/\D/g, '');

  for (let row of rows) {
    const sdt = String(row[3] || '').replace(/\D/g, '');
    const status = (row[14] || '').trim().toLowerCase();

    if (sdt !== inputPhone) continue;
    if (status !== 'đã thanh toán') continue;

    const orderId = row[1] || 'undefined';

  if (!mapOrders[orderId]) {
  const reviewed = row[15] === 'Đã đánh giá';
  const point = reviewed ? Number(row[16]) || 0 : 0;

  mapOrders[orderId] = {
    orderId,
    time: row[0] || '',
    name: row[2] || '',
    phone: row[3] || '',
    email: row[4] || '',
    table: row[10] || '',
    total: Number((row[9] || '').replace(/[^0-9]/g, '')) || 0,
    reviewed,
    status: reviewed ? 'Đã đánh giá' : '',
    point,
    staffCodes: [],
    staffList: [],
    reviewButton: reviewed ? 'Đã đánh giá' : 'Đánh giá',
    locked: reviewed
  };
}
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

  return res.json({ orders, totalPoint });
};
