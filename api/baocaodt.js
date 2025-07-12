// API: Lấy dữ liệu sheet "THONGKE" cho báo cáo doanh thu (tối ưu: chỉ lấy phần dữ liệu cần thiết + caching)

import { google } from 'googleapis';

const sheetId = process.env.GOOGLE_SHEET_ID;
const emailService = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const auth = new google.auth.JWT(
  emailService, null, key,
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({version: 'v4', auth});

const THONGKE_SHEET = "THONGKE";

// Simple in-memory cache (for demo, in production use Redis or similar)
let sheetCache = {
  data: null,
  updated: 0,
  expires: 60 // seconds
};

function getCachedData() {
  if (sheetCache.data && (Date.now() - sheetCache.updated < sheetCache.expires * 1000)) {
    return sheetCache.data;
  }
  return null;
}

async function fetchSheetData() {
  // Lấy toàn bộ dữ liệu sheet (cache trong RAM)
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: THONGKE_SHEET
  });
  let rows = result.data.values || [];
  if (rows.length > 1) rows = rows.slice(1);
  sheetCache.data = rows;
  sheetCache.updated = Date.now();
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse params: loại báo cáo, ngày, năm
    const type = (req.query.type || '').toLowerCase();
    const day = req.query.day || '';      // dd/mm/yyyy
    const year = req.query.year || '';    // yyyy

    // Lấy dữ liệu từ cache hoặc Google Sheets
    let rows = getCachedData();
    if (!rows) {
      rows = await fetchSheetData();
    }

    let filtered = [];
    if (type === 'ngay' && day) {
      // Báo cáo ngày
      filtered = rows.filter(r => {
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
    } else if (type === 'thang' && year) {
      // Báo cáo tháng: trả về tất cả dòng cùng năm đã thanh toán
      filtered = rows.filter(r => {
        let d = (r[0] || '').split(' ')[0].split('/');
        let y = d[2] || '';
        return y === year && (r[16] || '').trim() === "Đã thanh toán";
      });
    } else if (type === 'nam') {
      // Báo cáo năm: trả về tất cả dòng đã thanh toán
      filtered = rows.filter(r => (r[16] || '').trim() === "Đã thanh toán");
    } else {
      // Nếu không có type hợp lệ thì trả về rỗng
      return res.status(400).json({ error: 'Invalid report type or missing parameters.' });
    }
    return res.status(200).json({ rows: filtered });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
