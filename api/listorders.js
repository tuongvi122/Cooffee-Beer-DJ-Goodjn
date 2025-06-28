const { google } = require('googleapis');

// Bộ nhớ đệm RAM backend, tối ưu quota Google Sheets API và vẫn đảm bảo realtime với cache TTL ngắn và bust khi ghi nhận thanh toán
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 4; // giây, chỉ cache trong thời gian rất ngắn để hạn chế quota mà vẫn đảm bảo realtime

// Hàm cho phép bust cache từ ngoài vào (ví dụ khi vừa ghi nhận thanh toán)
function bustCache() {
  cache = null;
  cacheTime = 0;
}

module.exports = async (req, res) => {
  try {
    const now = Date.now();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;

    // Nếu cache còn hạn, trả luôn từ cache
    if (cache && (now - cacheTime < CACHE_TTL * 1000)) {
      return res.json({ orders: paginate(cache, page, limit) });
    }

    const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'Orders';

    // Chỉ lấy tới 2000 dòng, cột A-O (tối ưu network và tốc độ)
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:O2001`,
    });

    const dataRows = rows.data.values.slice(1);

    const getVal = (arr, idx) => (arr[idx] !== undefined ? arr[idx] : '');
    const parseMoney = val => Number((val || '').toString().replace(/[^\d]/g, '')) || 0;
    function parseVNDate(str) {
      if (!str) return new Date(0);
      const [date, time] = str.split(' ');
      const [d, m, y] = date.split('/');
      return new Date(`${y}-${m}-${d}T${time || '00:00:00'}`);
    }

    // Gom đơn hàng theo orderCode, gom nhóm bằng Map cho tốc độ cao kể cả với 2000+ dòng
    const ordersMap = new Map();
    for (const r of dataRows) {
      const xacnhan = getVal(r, 13).toString().trim();
      const dongia = parseMoney(getVal(r, 7));
      if (xacnhan !== 'V' || dongia <= 0) continue;

      const orderCode = getVal(r, 1).toString().trim();
      if (!orderCode) continue;
      const timestamp = getVal(r, 0);

      if (!ordersMap.has(orderCode)) {
        ordersMap.set(orderCode, {
          orderCode,
          customerName: getVal(r, 2),
          tableNum: getVal(r, 10),
          maNVs: new Set(),
          total: 0,
          statusArr: [],
          timestamp,
        });
      }
      const o = ordersMap.get(orderCode);
      o.maNVs.add(getVal(r, 5));
      o.total += parseMoney(getVal(r, 8));
      o.statusArr.push(getVal(r, 14).toString().trim());
    }

    // Build danh sách đơn
    let list = Array.from(ordersMap.values()).map(o => ({
      orderCode: o.orderCode,
      customerName: o.customerName,
      tableNum: o.tableNum,
      maNVs: Array.from(o.maNVs).join(', '),
      total: o.total,
      status: o.statusArr.every(s => s === 'Đã thanh toán') ? 'Đã thanh toán' : 'Chưa thanh toán',
      timestamp: o.timestamp,
    }));
    // Sắp xếp theo thời gian mới nhất lên đầu
    list.sort((a, b) => parseVNDate(b.timestamp) - parseVNDate(a.timestamp));

    // Lưu vào cache
    cache = list;
    cacheTime = Date.now();

    res.json({ orders: paginate(list, page, limit) });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.toString() });
  }
};

// Hàm phân trang backend
function paginate(list, page, limit) {
  const start = (page - 1) * limit;
  return list.slice(start, start + limit);
}

// Cho phép file khác gọi bust cache (ví dụ khi frintbill.js cập nhật trạng thái)
module.exports.bustCache = bustCache;

async function getGoogleAuth() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  return new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}