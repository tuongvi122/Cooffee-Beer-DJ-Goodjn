// API: Lấy dữ liệu sheet "THONGKE" cho báo cáo doanh thu

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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Lấy toàn bộ dữ liệu sheet THONGKE
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: THONGKE_SHEET
      });
      let rows = result.data.values || [];
      // Bỏ dòng tiêu đề đầu tiên
      if (rows.length > 1) rows = rows.slice(1);
      return res.status(200).json({ rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  res.status(405).json({error: 'Method not allowed'});
}