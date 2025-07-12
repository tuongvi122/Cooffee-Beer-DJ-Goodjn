import { google } from 'googleapis';

let productsCache = { value: null, expires: 0 };
const CACHE_TTL = 60000; // 1 phút

const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets.readonly']
);
const sheets = google.sheets({ version: 'v4', auth });

export default async function handler(req, res) {
  const now = Date.now();
  if (productsCache.value && productsCache.expires > now) {
    return res.status(200).json(productsCache.value);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Thiếu cấu hình Google Sheets' });
  }

  try {
    await auth.authorize();

    // 1. Lấy sản phẩm
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Products!A2:H201'
    });
    const rows = data.values || [];
    const products = rows.map((r) => ({
      id: r[0]?.trim() || "",
      maNV: r[1]?.trim() || "",
      caLV: r[2]?.toString().trim() || "",
      donGia: Number((r[3] || "0").replace(/[^\d]/g, "")),
      linkAnhNV: r[4]?.trim() || "",
      trangThai: r[5]?.trim() || "",
      dangBan: r[6]?.trim() || "",
      daFull: r[7]?.trim() || "",
    }))
    .filter(p => p.maNV && p.caLV && p.donGia);

    const empMap = {};
    for (const prod of products) {
      if (!empMap[prod.maNV]) {
        empMap[prod.maNV] = {
          maNV: prod.maNV,
          linkAnhNV: prod.linkAnhNV,
          caList: []
        };
      }
      empMap[prod.maNV].caList.push({
        caLV: prod.caLV,
        donGia: prod.donGia,
        trangThai: prod.trangThai,
        dangBan: prod.dangBan,
        daFull: prod.daFull
      });
    }

    const result = [];
    for (const emp of Object.values(empMap)) {
      const allCaNghi = emp.caList.every(
        ca => ca.trangThai === "Nghỉ việc" || ca.trangThai === "Nghỉ phép"
      );
      if (allCaNghi) continue;
      const anyCaFull = emp.caList.some(ca => ca.daFull === "Đã full");
      result.push({
        maNV: emp.maNV,
        linkAnhNV: emp.linkAnhNV,
        caList: emp.caList,
        isFull: anyCaFull,
        allCaFull: emp.caList.every(ca => ca.daFull === "Đã full")
      });
    }

    // 2. Lấy danh sách bàn trống
    const { data: tableData } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'COUNTER!D2:D',
    });
    const bookedTables = (tableData.values || [])
      .map(row => Number(row && row[0]))
      .filter(x => Number.isInteger(x) && x > 0);
    const allTables = Array.from({ length: 150 }, (_, i) => i + 1);
    const availableTables = allTables.filter(table => !bookedTables.includes(table));

    // Cache lại cả products và availableTables
    productsCache.value = { products: result, availableTables };
    productsCache.expires = now + CACHE_TTL;

    res.status(200).json({ products: result, availableTables });
  } catch (err) {
    console.error("Lỗi getProducts.js:", err);
    res.status(500).json({ error: 'Lỗi lấy sản phẩm từ Google Sheets' });
  }
}
