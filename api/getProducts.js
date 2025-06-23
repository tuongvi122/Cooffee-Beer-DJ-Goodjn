import { google } from 'googleapis';

// Setup Google Sheets Auth
const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets.readonly']
);
const sheets = google.sheets({ version: 'v4', auth });

export default async function handler(req, res) {
  // Đảm bảo đủ biến môi trường
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Thiếu cấu hình Google Sheets' });
  }

  try {
    await auth.authorize();
    // Lấy đầy đủ các cột cần thiết: A-H (ID, maNV, caLV, DonGia, linkAnhNV, Tình trạng, Đang bận, Đã full)
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Products!A2:H201'
    });
    const rows = data.values || [];

    // Parse dữ liệu thành object sản phẩm chi tiết
    const products = rows.map((r) => ({
      id: r[0]?.trim() || "",
      maNV: r[1]?.trim() || "",
      caLV: r[2]?.toString().trim() || "",
      donGia: Number((r[3] || "0").replace(/[^\d]/g, "")),
      linkAnhNV: r[4]?.trim() || "",
      trangThai: r[5]?.trim() || "",    // cột F
      dangBan: r[6]?.trim() || "",      // cột G
      daFull: r[7]?.trim() || "",       // cột H
    }))
    .filter(p => p.maNV && p.caLV && p.donGia);

    // Gom theo maNV, group các ca lại
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

    // Lọc ra các nhân viên hợp lệ: 
    // Nếu tất cả ca của nhân viên đều là "Nghỉ việc" hoặc "Nghỉ phép", loại bỏ luôn thẻ đó
    const result = [];
    for (const emp of Object.values(empMap)) {
      const allCaNghi = emp.caList.every(
        ca => ca.trangThai === "Nghỉ việc" || ca.trangThai === "Nghỉ phép"
      );
      if (allCaNghi) continue;

      // Check trạng thái ĐÃ FULL (FE sẽ tự disable thẻ nếu cần)
      const anyCaFull = emp.caList.some(ca => ca.daFull === "Đã full");
      result.push({
        maNV: emp.maNV,
        linkAnhNV: emp.linkAnhNV,
        caList: emp.caList, // FE sẽ tự lọc ca nghỉ phép/nghỉ việc khi show popup
        isFull: anyCaFull,
        allCaFull: emp.caList.every(ca => ca.daFull === "Đã full")
      });
    }

    // LUÔN trả về dữ liệu mới nhất (KHÔNG còn cache)
    res.status(200).json(result);
  } catch (err) {
    console.error("Lỗi getProducts.js:", err);
    res.status(500).json({ error: 'Lỗi lấy sản phẩm từ Google Sheets' });
  }
}
