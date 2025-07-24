import { google } from 'googleapis';

const sheetId = process.env.GOOGLE_SHEET_ID;
const sheetId2 = process.env.GOOGLE_SHEET_ID2;
const emailService = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const auth = new google.auth.JWT(emailService, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
const sheets = google.sheets({ version: 'v4', auth });

const ORDERS_SHEET = "Orders!A:Q";
const THONGKE_SHEET = "THONGKE!A:Q";
const BCTH_SHEET = "BC TONGHOP!A:C";

let sheetCache = {
  orders: { data: null, updated: 0, expires: 60, lock: false },
  thongke: { data: null, updated: 0, expires: 60, lock: false },
  bctonghop: { data: null, updated: 0, expires: 60, lock: false },
};

async function fetchSheetData({ spreadsheetId, range, cacheKey }) {
  const c = sheetCache[cacheKey];
  if (c.data && (Date.now() - c.updated < c.expires * 1000)) {
    return c.data;
  }
  if (c.lock) {
    while (c.lock) await new Promise(resolve => setTimeout(resolve, 100));
    return c.data;
  }
  c.lock = true;
  try {
    const result = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    let rows = result.data.values || [];
    if (rows.length > 1) rows = rows.slice(1);
    c.data = rows;
    c.updated = Date.now();
    return rows;
  } catch (error) {
    console.error(`Error fetching ${cacheKey}:`, error);
    throw new Error('Failed to fetch sheet data');
  } finally {
    c.lock = false;
  }
}

function getFirstPaidRowsByDay(rows, dayStr) {
  let rowsOfDay = rows.filter(r => (r[0] || '').split(' ')[0] === dayStr);
  let orderGroups = {};
  for (let r of rowsOfDay) {
    let maDH = r[1];
    if (!orderGroups[maDH]) orderGroups[maDH] = [];
    orderGroups[maDH].push(r);
  }
  let filtered = [];
  for (let maDH in orderGroups) {
    let group = orderGroups[maDH];
    if (group.some(r => (r[16] || '').trim() === "Đã thanh toán")) {
      filtered.push(group[0]);
    }
  }
  return filtered;
}

async function getOrdersRows() {
  return await fetchSheetData({ spreadsheetId: sheetId, range: ORDERS_SHEET, cacheKey: 'orders' });
}

async function getThongkeRows() {
  return await fetchSheetData({ spreadsheetId: sheetId2, range: THONGKE_SHEET, cacheKey: 'thongke' });
}

async function getBcTonghopRows() {
  return await fetchSheetData({ spreadsheetId: sheetId2, range: BCTH_SHEET, cacheKey: 'bctonghop' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const type = (req.query.type || '').toLowerCase();
    const day = req.query.day || '';
    const year = req.query.year || '';
    const sysDate = new Date();
    const sysDD = String(sysDate.getDate()).padStart(2, '0');
    const sysMM = String(sysDate.getMonth() + 1).padStart(2, '0');
    const sysYYYY = String(sysDate.getFullYear());
    const sysDayStr = `${sysDD}/${sysMM}/${sysYYYY}`;

    if (type === 'ngay' && day) {
      const [ordersRows, thongkeRows] = await Promise.all([getOrdersRows(), getThongkeRows()]);
      let allRows = [...ordersRows, ...thongkeRows];
      let filtered = getFirstPaidRowsByDay(allRows, day);
      return res.status(200).json({ rows: filtered });
    } else if (type === 'thang' && year) {
      const bcTonghopRows = await getBcTonghopRows();
      let bcRows = bcTonghopRows
        .map(r => ({
          monthYear: (r[1] || '').trim(),
          total: Number((r[2] || '0').replace(/\./g, '')) || 0,
        }))
        .filter(obj => obj.monthYear.endsWith(`/${year}`) && obj.total > 0);

      let monthMap = {};
      bcRows.forEach(obj => {
        let [mm] = obj.monthYear.split('/');
        monthMap[mm] = (monthMap[mm] || 0) + obj.total;
      });

      if (year === sysYYYY) {
        const ordersRows = await getOrdersRows();
        const filtered = getFirstPaidRowsByDay(ordersRows, sysDayStr);
        const totalToday = filtered.reduce((t, r) => t + (Number((r[11] || '').replace(/\./g, '')) || 0), 0);
        monthMap[sysMM] = (monthMap[sysMM] || 0) + totalToday;
      }

      let tongNam = Object.values(monthMap).reduce((a, b) => a + b, 0);
      let monthArr = Object.keys(monthMap)
        .sort((a, b) => Number(a) - Number(b))
        .map(m => ({
          monthYear: `${m}/${year}`,
          total: monthMap[m],
          tyle: tongNam ? Math.round((monthMap[m] / tongNam) * 100) : 0,
        }));
      return res.status(200).json({ rows: monthArr });
    } else if (type === 'nam') {
      const bcTonghopRows = await getBcTonghopRows();
      let yearMap = {};
      bcTonghopRows.forEach(r => {
        const monthYear = (r[1] || '').trim();
        const total = Number((r[2] || '0').replace(/\./g, '')) || 0;
        const [, yyyy] = monthYear.split('/');
        if (yyyy && total > 0) {
          yearMap[yyyy] = (yearMap[yyyy] || 0) + total;
        }
      });

      if (yearMap[sysYYYY] !== undefined) {
        const ordersRows = await getOrdersRows();
        const filtered = getFirstPaidRowsByDay(ordersRows, sysDayStr);
        const totalToday = filtered.reduce((t, r) => t + (Number((r[11] || '').replace(/\./g, '')) || 0), 0);
        yearMap[sysYYYY] += totalToday;
      }

      let tongAll = Object.values(yearMap).reduce((a, b) => a + b, 0);
      let yearArr = Object.keys(yearMap)
        .sort()
        .map(y => ({
          year: y,
          total: yearMap[y],
          tyle: tongAll ? Math.round((yearMap[y] / tongAll) * 100) : 0,
        }));
      return res.status(200).json({ rows: yearArr });
    }

    return res.status(400).json({ error: 'Invalid report type or missing parameters.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
