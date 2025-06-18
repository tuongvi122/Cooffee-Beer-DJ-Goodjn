import { google } from 'googleapis';

// Setup Google Sheets Auth
const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets.readonly']
);
const sheets = google.sheets({ version: 'v4', auth });

// Tối ưu cache: cache 1 phút, nhưng luôn ưu tiên reload khi user refresh trang (có thể chỉnh lại nếu cần)
let productCache = { data: null, ts: 0 };
const CACHE_DURATION = 60 * 1000; // 1 phút

export default async function handler(req, res) {
  // Đảm bảo đủ biến môi trường
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Thiếu cấu hình Google Sheets' });
  }

  const now = Date.now();
  if (productCache.data && now - productCache.ts < CACHE_DURATION) {
    return res.status(200).json(productCache.data);
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
    // Chỉ lấy những dòng có mã NV, ca, giá
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
      if (allCaNghi) continue; // ẩn hoàn toàn thẻ

      // Check trạng thái ĐÃ FULL (nếu tất cả ca đều đã full thì thẻ cũng sẽ ẩn ở FE)
      // (trường hợp này chỉ disable ở FE, vẫn trả về cho frontend xử lý)
      const anyCaFull = emp.caList.some(ca => ca.daFull === "Đã full");
      result.push({
        maNV: emp.maNV,
        linkAnhNV: emp.linkAnhNV,
        caList: emp.caList, // FE sẽ tự lọc ca nghỉ phép/nghỉ việc khi show popup
        isFull: anyCaFull,
        // Nếu tất cả ca đều đã full thì FE sẽ disable thẻ luôn
        allCaFull: emp.caList.every(ca => ca.daFull === "Đã full")
      });
    }

    // Cache lại
    productCache = { data: result, ts: now };

    // Trả về dạng: [{ maNV, linkAnhNV, caList:[{caLV, donGia, trangThai, dangBan, daFull}], isFull, allCaFull }]
    res.status(200).json(result);
  } catch (err) {
    console.error("Lỗi getProducts.js:", err);
    res.status(500).json({ error: 'Lỗi lấy sản phẩm từ Google Sheets' });
  }
}