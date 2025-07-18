// Đọc thông tin bill từ Google Sheets Orders cho một mã đơn hàng, tối ưu cache + hiệu suất + Google API quota
const { google } = require('googleapis');

// Cache RAM ngắn hạn để giảm quota Google API, realtime khi vừa thanh toán sẽ bust cache
// 
// TỐI ƯU CACHE CHO HIỆU SUẤT:
// - Sử dụng Map để lưu trữ cache cho nhiều orderCode khác nhau
// - TTL 4 giây giúp giảm API calls nhưng vẫn đảm bảo dữ liệu cập nhật
// - Tự động bust cache khi có thay đổi trạng thái thanh toán
// - Đối với các call lặp lại trong thời gian ngắn, sử dụng cache để tránh gọi API
// - Khuyến khích sử dụng API listorders mới sau khi cập nhật đơn hàng để nhận cả orders và bill
//
let cache = new Map(); // key: orderCode, value: { bill, now, cacheTime }
const CACHE_TTL = 4; // giây

module.exports = async (req, res) => {
  try {
    const orderCode = req.query.order ? req.query.order.trim() : '';
    if (!orderCode) return res.status(400).json({ error: 'Missing order code' });

    // Nếu có cache còn hạn, trả luôn
    const cached = cache.get(orderCode);
    const nowTime = Date.now();
    if (cached && (nowTime - cached.cacheTime < CACHE_TTL * 1000)) {
      // Cập nhật lại thời gian thực hiện cho hợp lý (giờ in bill)
      return res.json({ bill: cached.bill, now: new Date().toLocaleString('vi-VN', { hour12: false }) });
    }

    // Load credentials from env
    const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'Orders';

    // Lấy dải cột mới (A-U = 21 cột, index 0-20)
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:U1501`,
    });

    // Xử lý header và data
    const header = rows.data.values[0];
    const dataRows = rows.data.values.slice(1);

    // Lọc các dòng có mã đơn cần tìm, xác nhận 'V', đơn giá > 0
    const filtered = dataRows.filter(r => {
      const code = (r[1] || '').toString().trim(); // cột B
      const xacnhan = (r[15] || '').toString().trim(); // cột R (sau khi thêm 2 cột mới, cũ là 15, mới là 17)
      const dongia = (r[7] || '').toString().replace(/\D/g, ''); // cột H
      return (
        code === orderCode &&
        xacnhan === 'V' &&
        Number(dongia) > 0
      );
    });

    if (!filtered.length) {
      // Bỏ cache nếu không tìm thấy (đề phòng đơn vừa bị xóa/sửa)
      cache.delete(orderCode);
      return res.json({ bill: [] });
    }

    // Compose bill data
    const bill = filtered.map(r => ({
      timestamp: r[0] || '',             // A
      orderCode: r[1] || '',             // B
      customer: {
        name: r[2] || '',                // C
        phone: r[3] || '',               // D
        email: r[4] || '',               // E
        tableNum: r[12] || '',           // M (Sau khi thêm 2 cột mới, cũ là 10, mới là 12)
      },
      maNV: r[5] || '',                  // F
      caLV: r[6] || '',                  // G
      donGia: (r[7] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''), // H
      thanhTien: (r[8] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''), // I
      tongCong: (r[9] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''), // J
      giamGia: (r[10] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''), // K
      tongThu: (r[11] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''), // L
      ghiChu: r[13] || '',               // N (cũ 11, mới 13)
      status: r[16] || '',               // Q (cũ 14, mới 16)
      orderDate: r[0] ? r[0].split(' ')[0] : '', // A
    }));

    // Thêm ngày thực hiện (giờ khi gọi API)
    const nowStr = new Date().toLocaleString('vi-VN', { hour12: false });

    // Lưu vào cache
    cache.set(orderCode, { bill, now: nowStr, cacheTime: Date.now() });

    res.json({ bill, now: nowStr });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
};

// Cho phép bust cache từ ngoài vào khi vừa ghi nhận thanh toán (import và gọi từ frintbill.js)
module.exports.bustCache = function(orderCode) {
  if (orderCode) cache.delete(orderCode);
};

async function getGoogleAuth() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  return new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}
