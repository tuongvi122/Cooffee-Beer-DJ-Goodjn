// API: Lấy dữ liệu sheet "THONGKE" cho báo cáo doanh thu (tối ưu: chỉ lấy phần dữ liệu cần thiết + caching)
// Cập nhật: Hỗ trợ gộp dữ liệu từ các sheet phụ thuộc yêu cầu BC ngày, BC tháng, BC năm.

import { google } from 'googleapis';

const sheetId = process.env.GOOGLE_SHEET_ID;      // file chính (Orders)
const sheetId2 = process.env.GOOGLE_SHEET_ID2;    // file phụ (THONGKE, BC TONGHOP)
const emailService = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const auth = new google.auth.JWT(
  emailService, null, key,
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({version: 'v4', auth});

const ORDERS_SHEET = "Orders";
const THONGKE_SHEET = "THONGKE";      // trong file phụ
const BCTH_SHEET = "BC TONGHOP";      // trong file phụ

// Simple in-memory cache (for demo, in production use Redis or similar)
let sheetCache = {
  orders: { data: null, updated: 0, expires: 60 },         // Orders sheet (file chính)
  thongke: { data: null, updated: 0, expires: 60 },        // THONGKE sheet (file phụ)
  bctonghop: { data: null, updated: 0, expires: 60 },      // BC TONGHOP sheet (file phụ)
};

function getCached(key) {
  const c = sheetCache[key];
  if (c.data && (Date.now() - c.updated < c.expires * 1000)) {
    return c.data;
  }
  return null;
}
function setCached(key, data) {
  sheetCache[key].data = data;
  sheetCache[key].updated = Date.now();
}

async function fetchSheetData({spreadsheetId, range, cacheKey}) {
  let cached = getCached(cacheKey);
  if (cached) return cached;
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  let rows = result.data.values || [];
  setCached(cacheKey, rows);
  return rows;
}

// --- Lấy dữ liệu Orders (file chính) ---
async function getOrdersRows() {
  let rows = await fetchSheetData({spreadsheetId: sheetId, range: ORDERS_SHEET, cacheKey: 'orders'});
  if (rows.length > 1) rows = rows.slice(1);
  return rows;
}
// --- Lấy dữ liệu sheet THONGKE (file phụ) ---
async function getThongkeRows() {
  let rows = await fetchSheetData({spreadsheetId: sheetId2, range: THONGKE_SHEET, cacheKey: 'thongke'});
  if (rows.length > 1) rows = rows.slice(1);
  return rows;
}
// --- Lấy dữ liệu BC TONGHOP (sheet, file phụ) ---
async function getBcTonghopRows() {
  let rows = await fetchSheetData({spreadsheetId: sheetId2, range: BCTH_SHEET, cacheKey: 'bctonghop'});
  if (rows.length > 1) rows = rows.slice(1);
  return rows;
}

// ----------- XỬ LÝ API -----------
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse params
    const type = (req.query.type || '').toLowerCase();
    const day = req.query.day || '';      // dd/mm/yyyy
    const year = req.query.year || '';    // yyyy

    // Lấy ngày/tháng/năm hệ thống
    const sysDate = new Date();
    const sysDD = String(sysDate.getDate()).padStart(2, '0');
    const sysMM = String(sysDate.getMonth() + 1).padStart(2, '0');
    const sysYYYY = String(sysDate.getFullYear());
    const sysDayStr = `${sysDD}/${sysMM}/${sysYYYY}`;
    const sysMonthYearStr = `${sysMM}/${sysYYYY}`;

    if (type === 'ngay' && day) {
      // --- BC ngày: Gộp dữ liệu từ Orders (file chính) & THONGKE (file phụ) ---
      // Logic: Giữ nguyên như cũ, chỉ gộp 2 nguồn lại
      const [ordersRows, thongkeRows] = await Promise.all([getOrdersRows(), getThongkeRows()]);
      let allRows = [...ordersRows, ...thongkeRows];
      // Lọc đúng ngày, trạng thái "Đã thanh toán"
      let filtered = allRows.filter(r => {
        let rawDate = (r[0] || '').split(' ')[0];
        return rawDate === day && (r[16] || '').trim() === "Đã thanh toán";
      });
      // Mỗi mã ĐH chỉ lấy dòng đầu
      const seen = {};
      filtered = filtered.filter(r => {
        if (!seen[r[1]]) {
          seen[r[1]] = true;
          return true;
        }
        return false;
      });
      return res.status(200).json({ rows: filtered });
    }

    else if (type === 'thang' && year) {
  // Lấy dữ liệu BC TONGHOP
  const bcTonghopRows = await getBcTonghopRows();
  // Lấy doanh thu từng tháng
  let bcRows = bcTonghopRows.map(r => ({
    monthYear: (r[1] || '').trim(), // MM/YYYY
    total: Number((r[2] || '0').replace(/\./g, '')) || 0, // Đảm bảo tổng là số
  })).filter(obj => obj.monthYear.endsWith(`/${year}`) && obj.total > 0); // Chỉ giữ tháng có doanh thu > 0

  // Tính tổng doanh thu của từng tháng
  let monthMap = {};
  bcRows.forEach(obj => {
    let [mm, yyyy] = obj.monthYear.split('/');
    if (!monthMap[mm]) monthMap[mm] = 0;
    monthMap[mm] += Number(obj.total) || 0;
  });

  // Cộng doanh thu ngày hiện tại nếu là năm hiện tại
  let totalToday = 0;
  if (year === sysYYYY) {
    const ordersRows = await getOrdersRows();
    const todayRows = ordersRows.filter(r => {
      let rawDate = (r[0] || '').split(' ')[0];
      return rawDate === sysDayStr && (r[16] || '').trim() === "Đã thanh toán";
    });
    totalToday = todayRows.reduce((t, r) => t + (Number((r[11] || '').replace(/\./g, '')) || 0), 0);
    if (monthMap[sysMM]) {
      monthMap[sysMM] += totalToday;
    } else if (totalToday > 0) {
      monthMap[sysMM] = totalToday;
    }
  }

  // Tổng doanh thu cả năm
  let tongNam = Object.values(monthMap).reduce((a, b) => a + b, 0);
  // Tạo danh sách tháng
  let monthArr = [];
  Object.keys(monthMap).sort((a, b) => Number(a) - Number(b)).forEach(m => {
    let total = monthMap[m];
    let mmyyyy = `${m}/${year}`;
    let tyle = tongNam ? Math.round((total / tongNam) * 100) : 0; // Tính tỷ lệ chính xác
    monthArr.push({ monthYear: mmyyyy, total, tyle });
  });
  return res.status(200).json({ rows: monthArr });
}
else if (type === 'nam') {
  // Lấy dữ liệu BC TONGHOP
  const bcTonghopRows = await getBcTonghopRows();
  // Nhóm doanh thu theo năm
  let yearMap = {};
  bcTonghopRows.forEach(r => {
    const monthYear = (r[1] || '').trim(); // MM/YYYY
    const total = Number((r[2] || '0').replace(/\./g, '')) || 0; // Đảm bảo tổng là số
    const [mm, yyyy] = monthYear.split('/');
    if (yyyy && total > 0) { // Chỉ xử lý năm có doanh thu > 0
      if (!yearMap[yyyy]) yearMap[yyyy] = 0;
      yearMap[yyyy] += Number(total) || 0;
    }
  });

  // Cộng doanh thu ngày hiện tại nếu là năm hiện tại
  let totalToday = 0;
  if (yearMap[sysYYYY] !== undefined) {
    const ordersRows = await getOrdersRows();
    const todayRows = ordersRows.filter(r => {
      let rawDate = (r[0] || '').split(' ')[0];
      return rawDate === sysDayStr && (r[16] || '').trim() === "Đã thanh toán";
    });
    totalToday = todayRows.reduce((t, r) => t + (Number((r[11] || '').replace(/\./g, '')) || 0), 0);
    yearMap[sysYYYY] += totalToday;
  }

  // Tổng doanh thu tất cả các năm
  let tongAll = Object.values(yearMap).reduce((a, b) => a + b, 0);
  // Tạo danh sách năm
  let yearArr = [];
  Object.keys(yearMap).sort().forEach(y => {
    let total = yearMap[y];
    let tyle = tongAll ? Math.round((total / tongAll) * 100) : 0; // Tính tỷ lệ chính xác
    yearArr.push({ year: y, total, tyle });
  });
  return res.status(200).json({ rows: yearArr });
}
   
    // Nếu type không hợp lệ
    return res.status(400).json({ error: 'Invalid report type or missing parameters.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
