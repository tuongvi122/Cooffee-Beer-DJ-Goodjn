import { google } from 'googleapis';

export default async function handler(req, res) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID; // Đã có sẵn trong .env
  const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT(
    CLIENT_EMAIL,
    null,
    PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Login!A2:B2', // Lấy user/pass ở dòng thứ 2
    });
    const values = result.data.values;
    if (values && values.length > 0) {
      const [username, password] = values[0];
      res.status(200).json({ username, password });
    } else {
      res.status(404).json({ error: 'Không tìm thấy user/pass trong Google Sheet.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Lỗi truy cập Google Sheets.' });
  }
}