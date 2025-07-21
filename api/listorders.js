const { google } = require('googleapis');

// ==== HÀM LẤY ID CỦA SHEET ====
async function getSheetId(sheets, spreadsheetId, sheetName) {
  const info = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = info.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : 0;
}

// ==== HÀM FORMAT GIỜ VIỆT NAM====
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
// ==== HÀM PHÂN TRANG DANH SÁCH ĐƠN HÀNG ====
function paginate(list, page, limit) {
  const start = (page - 1) * limit;
  return list.slice(start, start + limit);
}
// ==== HÀM LẤY CHI TIẾT 1 ĐƠN ====
async function getOrderDetail(req, res, sheets, spreadsheetId, sheetName) {
  const orderCode = (req.query.order || '').trim();
  if (!orderCode) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  // Lấy dữ liệu từ sheet Orders
  const orderRows = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:U3000`,
  });
  const header = orderRows.data.values[0];
  const dataRows = orderRows.data.values.slice(1);

  // Lọc đúng mã đơn hàng
  const detailRows = dataRows.filter(r => (r[1] || '').toString().trim() === orderCode);
  if (!detailRows.length) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

  // Lấy dữ liệu từ sheet Products
  const productRows = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Products!A1:G500`, // Tăng range để lấy đủ dữ liệu
  });
  const allProducts = productRows.data.values.slice(1).map(row => ({
    maNV: row[1] || '', // Cột B: maNV
    caLV: row[2] || '', // Cột C: caLV
    donGia: row[3] || '', // Cột D: donGia
    lockStatus: row[5] || '', // Cột F: lockStatus
    isBusy: row[6] || '' // Cột G: "Đang bận"
  }));
  const availableProducts = productRows.data.values.slice(1).filter(row => {
    const maNV = row[1] || ''; // Cột B: maNV
    const lockStatus = row[5] || ''; // Cột F: lockStatus
    const isBusy = row[6] || ''; // Cột G: "Đang bận"
    const isValid = maNV.trim() !== '' && 
                   !(lockStatus.trim().toLowerCase() === "nghỉ việc" || lockStatus.trim().toLowerCase() === "nghỉ phép") && 
                   isBusy.trim().toLowerCase() !== "đang bận";
    if (!isValid) console.log(`Filtered out: maNV=${maNV}, lockStatus=${lockStatus}, isBusy=${isBusy}`);
    return isValid;
  }).map(row => ({
    maNV: row[1] || '', // Cột B: maNV
    caLV: row[2] || '', // Cột C: caLV
    donGia: row[3] || '', // Cột D: donGia
    lockStatus: row[5] || '', // Cột F: lockStatus
    isBusy: row[6] || '' // Cột G: "Đang bận"
  }));

  // Xây dựng chi tiết đơn hàng
  const first = detailRows[0];
  const order = {
    orderCode,
    customer: {
      name: first[2] || '',
      phone: first[3] || '',
      email: first[4] || ''
    },
    tableNum: first[12] || '',
    ghiChu: first[13] || '',
    tongCong: first[9] || '',
    giamGia: first[10] || '',
    tongThu: first[11] || '',
    noteQuanLy: first[19] || '',
    inBill: first[20] || '',
    trangThai: (detailRows.find(r => (r[16] || '') === 'Đã thanh toán') ? 'Đã thanh toán' : 'Chưa thanh toán'),
    danhGia: first[17] || '',
    diemDanhGia: first[18] || '',
    nhanVien: detailRows.map(r => ({
      maNV: r[5] || '',
      caLV: r[6] || '',
      donGia: r[7] || '',
      thanhTien: r[8] || ''
    }))
  };

  // Trả về cả chi tiết đơn hàng, danh sách nhân viên đầy đủ và danh sách nhân viên khả dụng
  return res.json({ order, products: allProducts, availableProducts });
}

// ==== HÀM CẬP NHẬT ĐƠN HÀNG ====
// Thay đổi hàm này để dùng getVNTimeForSheet()
async function updateOrder(req, res, sheets, spreadsheetId, sheetName) {
  const { orderCode, customer, tableNum, ghiChu, nhanVien, tongCong, giamGia, tongThu, trangThai, noteQuanLy, inBill, danhGia, diemDanhGia } = req.body;
  if (!orderCode || !Array.isArray(nhanVien) || nhanVien.length === 0)
    return res.status(400).json({ error: "Thiếu dữ liệu" });

  // Lấy toàn bộ dữ liệu để xác định dòng cần xóa
  const rows = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:U3000`,
  });
  const dataRows = rows.data.values.slice(1);
  const linesToRemove = [];
  dataRows.forEach((r, idx) => {
    if ((r[1] || '').toString().trim() === orderCode) {
      linesToRemove.push(idx + 2); // +2 vì header 1, 1-based index
    }
  });
  // === LẤY GIÁ TRỊ CŨ CỦA 3 TRƯỜNG: ĐÁNH GIÁ, ĐIỂM ĐÁNH GIÁ, TRẠNG THÁI IN BILL ===
let oldDanhGia = '', oldDiemDanhGia = '', oldInBill = '', oldTrangThai = '';
const oldRow = dataRows.find(r => (r[1] || '').toString().trim() === orderCode);
if (oldRow) {
  oldTrangThai = oldRow[16] || '';      // Lấy trạng thái cũ từ sheet
  oldDanhGia = oldRow[17] || '';
  oldDiemDanhGia = oldRow[18] || '';
  oldInBill = oldRow[20] || '';
}
  // Xóa các dòng cũ 
if (linesToRemove.length) {
  const realSheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  const requests = [];
  const sortedLines = linesToRemove.sort((a, b) => a - b); // Sắp xếp tăng dần
  let start = sortedLines[0] - 1;
  let end = start + 1;
  for (let i = 1; i < sortedLines.length; i++) {
    if (sortedLines[i] === sortedLines[i - 1] + 1) {
      end = sortedLines[i];
    } else {
      requests.push({
        deleteDimension: {
          range: {
            sheetId: realSheetId,
            dimension: 'ROWS',
            startIndex: start,
            endIndex: end
          }
        }
      });
      start = sortedLines[i] - 1;
      end = start + 1;
    }
  }
  // Thêm range cuối cùng
  requests.push({
    deleteDimension: {
      range: {
        sheetId: realSheetId,
        dimension: 'ROWS',
        startIndex: start,
        endIndex: end
      }
    }
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}
  // Chuẩn bị data mới để ghi lại
  let nowStr = getVNTimeForSheet();
  let values = nhanVien.map((nv, idx) => {
  let row = []; 
  row[0]  = nowStr;                              // A: Thời gian (đã đồng bộ timezone VN)
  row[1]  = orderCode;                           // B: Mã đơn hàng
  row[2]  = customer.name;                       // C: Tên KH
  row[3]  = String(customer.phone);                      // D: SĐT
  row[4]  = customer.email;                      // E: Email
  row[5]  = nv.maNV;                             // F: Mã NV
  row[6]  = nv.caLV;                             // G: Ca làm việc
  row[7]  = nv.donGia;                           // H: Đơn giá
  row[8]  = nv.thanhTien || '';                       // I: Thành tiền
  row[9]  = idx === 0 ? tongCong : '';           // J: Tổng cộng (dòng đầu)
  row[10] = idx === 0 ? giamGia : '';            // K: Giảm giá (dòng đầu)
  row[11] = idx === 0 ? tongThu : '';            // L: Tổng thu (dòng đầu)
  row[12] = tableNum || '';                      // M: Số bàn
  row[13] = ghiChu || '';                        // N: Ghi chú
  row[14] = 'V';                                 // O: Cố định 'V'
  row[15] = 'V';                                 // P: Cố định 'V'
  row[16] = oldTrangThai = '';
  row[17] = oldDanhGia;     
  row[18] = idx === 0 ? oldDiemDanhGia : ''; 
  row[19] = noteQuanLy || '';
  row[20] = oldInBill;
  return row;
});

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });

// Bust cache nếu có
  try {
    module.exports.bustCache();
    require('./getbill').bustCache(orderCode);
  } catch (e) {}

  // === LẤY LẠI DỮ LIỆU SHEET, xử lý trên RAM, trả về cả orders + bill mới nhất ===
  const rowsAfter = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:U3000`,
  });
  const dataRowsAfter = rowsAfter.data.values.slice(1);

  // ---- Xây dựng lại danh sách orders như phần lấy orders ở dưới module.exports ----
  const ordersMap = new Map();
  for (const r of dataRowsAfter) {
    const code = (r[1] || '').toString().trim();
    if (!code) continue;
    const timestamp = r[0];
    if (!ordersMap.has(code)) {
      ordersMap.set(code, {
        orderCode: code,
        customerName: r[2] || '',
        tableNum: r[12] || '',
        maNVs: new Set(),
        tongThu: Number((r[11] || '').toString().replace(/[^\d]/g, '')) || 0, // <-- lấy cột L dòng đầu tiên
        statusArr: [],
        timestamp,
      });
    }
    const o = ordersMap.get(code);
    o.maNVs.add(r[5] || '');
    o.statusArr.push((r[16] || '').toString().trim());
  }
  let orders = Array.from(ordersMap.values()).map(o => ({
    orderCode: o.orderCode,
    customerName: o.customerName,
    tableNum: o.tableNum,
    maNVs: Array.from(o.maNVs).join(', '),
    total: o.tongThu, // <--- Sửa lại thành o.tongThu
    status: o.statusArr.some(s => s === 'Đã thanh toán') ? 'Đã thanh toán' : 'Chưa thanh toán',
    timestamp: o.timestamp,
  }));

  // Sắp xếp theo thời gian giảm dần
  orders.sort((a, b) => {
    function parseVNDate(str) {
      if (!str || str.trim() === '') return new Date(0);
      const [date, time] = str.trim().split(' ');
      if (!date) return new Date(0);
      const [d, m, y] = date.split('/');
      const [hh = '00', mm = '00', ss = '00'] = (time || '').split(':');
      return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss));
    }
    const dateA = parseVNDate(a.timestamp);
    const dateB = parseVNDate(b.timestamp);
    if (isNaN(dateA) || isNaN(dateB)) return 0;
    return dateB - dateA;
  });

  // ---- Build bill chi tiết cho order vừa lưu/sửa ----
  const detailRows = dataRowsAfter.filter(r => (r[1] || '').toString().trim() === orderCode);
  // Điều kiện bill như getbill.js: ít nhất 1 dòng cột O (r[14]) = 'V', dòng đầu cột J (r[9]) > 0
  const hasVInO = detailRows.some(r => (r[14] || '').toString().trim() === 'V');
  const tongCongFirst = (detailRows[0] && detailRows[0][9]) ? detailRows[0][9].toString().replace(/\./g, '').replace(/[^0-9]/g, '') : '';
  const tongCongFirstNumber = Number(tongCongFirst);
  let bill = [];
  if (hasVInO && tongCongFirstNumber > 0) {
    bill = detailRows.map(r => ({
      timestamp: r[0] || '',
      orderCode: r[1] || '',
      customer: {
        name: r[2] || '',
        phone: r[3] || '',
        email: r[4] || '',
        tableNum: r[12] || '',
      },
      maNV: r[5] || '',
      caLV: r[6] || '',
      donGia: (r[7] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''),
      thanhTien: (r[8] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''),
      tongCong: (r[9] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''),
      giamGia: (r[10] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''),
      tongThu: (r[11] || '').toString().replace(/\./g, '').replace(/[^0-9]/g, ''),
      ghiChu: r[13] || '',
      status: r[16] || '',
      orderDate: r[0] ? r[0].split(' ')[0] : '',
    }));
  }

  // ---- Trả về đồng thời cả danh sách orders và bill vừa sửa ----
  res.json({ success: true, orders, bill });
}
// ========= CACHE =========
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 4; // giây

function bustCache() {
  cache = null;
  cacheTime = 0;
}

// ==== GOOGLE AUTH ====
async function getGoogleAuth() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  return new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

// ==== MODULE EXPORT CHÍNH ====
module.exports = async (req, res) => {
  try {
    const now = Date.now();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;

    const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'Orders';

    // Nếu có query order, trả chi tiết 1 đơn
    if (req.method === 'GET' && req.query.order) {
      return await getOrderDetail(req, res, sheets, spreadsheetId, sheetName);
    }
    // Nếu là POST hoặc PUT, cập nhật đơn hàng
    if ((req.method === 'POST' || req.method === 'PUT') && req.body && req.body.orderCode) {
      return await updateOrder(req, res, sheets, spreadsheetId, sheetName);
    }

    // Nếu cache còn hạn, trả luôn từ cache
    if (cache && (now - cacheTime < CACHE_TTL * 1000)) {
      return res.json({ orders: paginate(cache, page, limit) });
    }

    // Chỉ lấy tới 2000 dòng, cột A-U
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:U3000`,
    });

    const dataRows = rows.data.values.slice(1);
    // Gom đơn hàng theo orderCode
    const ordersMap = new Map();
    for (const r of dataRows) {
      const orderCode = (r[1] || '').toString().trim();
      if (!orderCode) continue;
      const timestamp = r[0];
      if (!ordersMap.has(orderCode)) {
        ordersMap.set(orderCode, {
          orderCode,
          customerName: r[2] || '',
          tableNum: r[12] || '',
          maNVs: new Set(),
          tongThu: Number((r[11] || '').toString().replace(/[^\d]/g, '')) || 0, // <-- lấy cột L dòng đầu tiên
          statusArr: [],
          timestamp,
        });
      }
      const o = ordersMap.get(orderCode);
      o.maNVs.add(r[5] || '');
      o.statusArr.push((r[16] || '').toString().trim());
    }

    // Build danh sách đơn
    let list = Array.from(ordersMap.values()).map(o => ({
      orderCode: o.orderCode,
      customerName: o.customerName,
      tableNum: o.tableNum,
      maNVs: Array.from(o.maNVs).join(', '),
      total: o.tongThu, // <--- Sửa lại thành o.tongThu
      status: o.statusArr.some(s => s === 'Đã thanh toán') ? 'Đã thanh toán' : 'Chưa thanh toán',
      timestamp: o.timestamp,
    }));

    // Sắp xếp theo thời gian giảm dần (mới nhất lên đầu) trước khi paginate
    list.sort((a, b) => {
  function parseVNDate(str) {
    if (!str || str.trim() === '') return new Date(0);
    const [date, time] = str.trim().split(' ');
    if (!date) return new Date(0);
    const [d, m, y] = date.split('/');
    const [hh = '00', mm = '00', ss = '00'] = (time || '').split(':');
    // Trả về ngày an toàn theo giờ địa phương
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss));
  }
  const dateA = parseVNDate(a.timestamp);
  const dateB = parseVNDate(b.timestamp);

  if (isNaN(dateA) || isNaN(dateB)) {
    console.warn(`⚠️ Invalid timestamp: a=${a.timestamp}, b=${b.timestamp}`);
    return 0;
  }
  return dateB - dateA; // Mới nhất lên đầu
});
    // Lưu vào cache
    cache = list;
    cacheTime = Date.now();

    res.json({ orders: paginate(list, page, limit) });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.toString() });
  }
};

// Cho phép file khác gọi bust cache
module.exports.bustCache = bustCache;
