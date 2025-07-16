const { google } = require('googleapis');
const getbill = require('./getbill'); // Import để bust cache

module.exports = async (req, res) => {
  try {
    const { order, items } = req.body;
    if (!order || !Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'Missing data' });

    const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'Orders';

    // Lấy toàn bộ dữ liệu để xác định đúng dòng
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:U`,
    });
    const dataRows = rows.data.values.slice(1);

    const getVal = (arr, idx) => (arr[idx] !== undefined ? arr[idx] : '');

    // Tìm index các dòng cần cập nhật
    const updates = [];
    dataRows.forEach((r, idx) => {
      const code = getVal(r, 1).toString().trim();
      const maNV = getVal(r, 5).toString().trim();
      const caLV = getVal(r, 6).toString().trim();
      if (
        code === order &&
        items.some(it => it.maNV === maNV && it.caLV == caLV)
      ) {
        updates.push(idx + 2); // +2 vì header + 1-based index của Sheets
      }
    });

    if (!updates.length) return res.json({ updated: 0 });

    // --- Cập nhật nhanh bằng batchUpdate ---
    const requests = updates.map(rowNum => ({
      range: `${sheetName}!Q${rowNum}`,
      values: [['Đã thanh toán']]
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        data: requests,
        valueInputOption: 'RAW'
      }
    });

    // XÓA CACHE BILL ĐANG IN để lần getbill tiếp theo luôn lấy data mới nhất
    getbill.bustCache(order);

    res.json({ updated: updates.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.toString() });
  }
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
