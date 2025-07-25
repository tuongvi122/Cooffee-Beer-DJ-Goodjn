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
  const inputPhone = String(phone).replace(/\D/g, '');

  // Nhóm các dòng theo orderId, chỉ lấy các dòng có phone khớp
  const orderGroups = {};
  for (const row of rows) {
    const sdt = String(row[3] || '').replace(/\D/g, '');
    if (sdt !== inputPhone) continue;
    const orderId = row[1] || 'undefined';
    if (!orderGroups[orderId]) orderGroups[orderId] = [];
    orderGroups[orderId].push(row);
  }

  const mapOrders = {};
  let foundAny = false;
  let foundNotCompleted = false;

  for (const orderId in orderGroups) {
    const group = orderGroups[orderId];
    foundAny = true;
    // Nếu có ít nhất 1 dòng đã thanh toán, lấy dòng đầu tiên
    if (group.some(r => (r[16] || '').trim().toLowerCase() === 'đã thanh toán')) {
      // Tìm dòng đầu tiên của đơn hàng (dù có phải đã thanh toán hay không)
      const row = group[0];

      // Xác định đã đánh giá: nếu bất kỳ dòng nào trong nhóm có cột R (index 17) KHÁC rỗng => đã đánh giá
      const reviewed = group.some(r => (r[17] || '').trim() !== '');
      const point = reviewed ? Number(row[18]) || 0 : 0;

      // StaffList chỉ gồm các staff của các dòng có Q = "Đã thanh toán"
      const staffList = [];
      const staffCodes = [];
      for (const r of group) {
        if ((r[16] || '').trim().toLowerCase() !== 'đã thanh toán') continue;
        const staffCode = r[5] || '';
        const shift = r[6] || '';
        if (staffCode) {
          staffCodes.push(staffCode);
          staffList.push({ code: staffCode, shift, stars: 5 });
        }
      }

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
        staffCodes,
        staffList,
        reviewButton: reviewed ? 'Đã đánh giá' : 'Đánh giá',
        locked: reviewed
      };
    } else {
      // Nếu không có dòng nào đã thanh toán nhưng có dòng khớp sdt, đánh dấu để trả về message not_completed nếu không có đơn nào đủ điều kiện
      foundNotCompleted = true;
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
