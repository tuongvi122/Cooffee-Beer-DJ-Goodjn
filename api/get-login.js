import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' }); return;
  }
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const auth = new google.auth.JWT(
    CLIENT_EMAIL, null, PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  const { username, password, role } = req.body;

  if(!username || !password || !role) {
    res.status(400).json({ success: false, message: "Thiếu thông tin đăng nhập" });
    return;
  }
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Login!A2:C100',
    });
    const values = result.data.values || [];
    // So sánh vai trò KHÔNG phân biệt hoa thường, loại bỏ khoảng trắng
    const userRow = values.find(row =>
      row[0] && row[1] && row[2]
      && row[0].trim() === username.trim()
      && row[1] === password
      && row[2].trim().toLowerCase() === role.trim().toLowerCase()
    );
    if (userRow) {
      res.status(200).json({ success: true, role });
    } else {
      res.status(401).json({ success: false, message: "Sai tên đăng nhập, mật khẩu hoặc vai trò" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Lỗi truy cập Google Sheets." });
  }
}
