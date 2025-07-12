// ==== Thêm đoạn này vào đầu file Xlbaocao.js hoặc trong <style> của trang báo cáo ====

const style = document.createElement('style');
style.textContent = `
@media (max-width: 600px) {
  .bc-table {
    font-size: 0.95em;
    margin-left: 0px;
    margin-right: 4px;
    width: calc(100% - 4px);
    min-width: unset !important;
  }
  .bc-table-wrap {
    overflow-x: auto;
    margin-left: 0;
    margin-right: 0;
  }
  .bc-table th, .bc-table td {
    padding-left: 3px;
    padding-right: 3px;
    font-size: 1em;
    white-space: nowrap;
  }
  .bc-table-total-right {
    font-size: 0.93em !important;
    line-height: 1.2 !important;
    color: #1976d2 !important;
    font-weight: bold !important;
    margin-right: 7px !important;
    padding: 0 !important;
    white-space: nowrap;
    margin-bottom: 0;
    margin-top: 0;
    padding-bottom: 0;
    }
  .bc-table-total-right span {
    font-size: 1em !important;
    font-weight: bold !important;
    color: #111 !important;
  }
  .report-entries-container {
    font-size: 0.85em !important;
  }
}
.order-pagination {
  display: flex;
  gap: 2px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  margin: 16px auto 0 auto;
}
.order-pagination button, .order-pagination span {
  min-width: 32px;
  padding: 5px 7px;
  border: none;
  background: none;
  color: #1976d2;
  font-weight: 500;
  border-radius: 5px;
  cursor: pointer;
  font-size: 1em;
  outline: none;
  transition: background 0.14s, color 0.14s;
}
.order-pagination .active {
  background: #2196f3;
  color: #fff;
  font-weight: bold;
  pointer-events: none;
}
.order-pagination button:disabled {
  color: #bbb;
  background: #f1f1f1;
  pointer-events: none;
}
.report-entries-container {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 1em;
  white-space: nowrap;
  margin-bottom: 0;          /* Bỏ margin dưới */
  margin-top: 0;             /* Nếu có, bỏ luôn */
  padding-bottom: 0;         /* Nếu có, bỏ luôn */
}
.report-entries-container select {
  font-size: 1em;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1.2px solid #b5c8db;
  outline: none;
}
/* Thêm style cho tổng cộng bên phải cùng dòng */
.bc-table-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 0;          /* Bỏ margin dưới */
  margin-top: 0;             /* Nếu có, bỏ luôn */
  padding-bottom: 0;         /* Nếu có, bỏ luôn */
}
`;
document.head.appendChild(style);

// ============ TOÀN BỘ CODE JS DƯỚI ĐÂY GIỮ NGUYÊN ============

const bcType = document.getElementById('bcType');
const bcInput = document.getElementById('bcInput');
const bcYearSelect = document.getElementById('bcYearSelect');
const bcSearchBtn = document.getElementById('bcSearchBtn');
const bcResetBtn = document.getElementById('bcResetBtn');
const bcNote = document.getElementById('bcNote');
const bcTableWrap = document.getElementById('bcTableWrap');

// Dữ liệu báo cáo đã cache client (chỉ cache kết quả mỗi lần search)
let lastSearch = {
  type: null,
  day: null,
  year: null,
  data: null
};

function formatCurrency(num) {
  num = Number(num) || 0;
  return num.toLocaleString('vi-VN');
}

// Hàm chuyển "200.000" => 200000
function toInteger(str) {
  return Number((str||'').replace(/\./g, '')) || 0;
}

// --- Hàm tách ngày/tháng/năm từ timestamp ---
function getDay(str) {
  return (str || '').split(' ')[0];
}
function getMonth(str) {
  let d = getDay(str).split('/');
  return d[1] || '';
}
function getYear(str) {
  let d = getDay(str).split('/');
  return d[2] || '';
}

// ====== Biến phân trang cho báo cáo ngày =======
let bcDayEntriesPerPage = 10;
let bcDayCurrentPage = 1;
let bcDayData = []; // mảng chứa các dòng sau khi lọc theo ngày

function renderDayReportControls(totalEntries, totalAmount) {
  let controlsHtml = `
    <div class="bc-table-controls">
      <div class="report-entries-container">
        Hiển thị 
        <select id="bcDayEntriesSelect">
          <option value="10"${bcDayEntriesPerPage===10?' selected':''}>10</option>
          <option value="20"${bcDayEntriesPerPage===20?' selected':''}>20</option>
          <option value="50"${bcDayEntriesPerPage===50?' selected':''}>50</option>
          <option value="100"${bcDayEntriesPerPage===100?' selected':''}>100</option>
        </select>
        đơn hàng
      </div>
      <div class="bc-table-total-right">
        Tổng cộng: <span>${formatCurrency(totalAmount)}</span>
      </div>
    </div>
  `;
  let paginationHtml = `<div id="bcDayPagination" class="order-pagination"></div>`;
  return { controlsHtml, paginationHtml };
}

function renderDayPagination(totalEntries) {
  const totalPages = Math.ceil(totalEntries / bcDayEntriesPerPage);
  let html = '';
  if (totalPages > 1) {
    html += `<button ${bcDayCurrentPage === 1 ? 'disabled' : ''} onclick="window.gotoBcDayPage(${bcDayCurrentPage - 1})">Previous</button>`;
    let start = Math.max(1, bcDayCurrentPage - 2);
    let end = Math.min(totalPages, bcDayCurrentPage + 2);
    if (bcDayCurrentPage <= 3) end = Math.min(5, totalPages);
    if (bcDayCurrentPage >= totalPages - 2) start = Math.max(1, totalPages - 4);
    if (start > 1) html += `<button onclick="window.gotoBcDayPage(1)">1</button>${start > 2 ? '<span>...</span>' : ''}`;
    for (let i = start; i <= end; ++i) {
      html += `<button class="${i === bcDayCurrentPage ? 'active' : ''}" onclick="window.gotoBcDayPage(${i})">${i}</button>`;
    }
    if (end < totalPages) html += `${end < totalPages - 1 ? '<span>...</span>' : ''}<button onclick="window.gotoBcDayPage(${totalPages})">${totalPages}</button>`;
    html += `<button ${bcDayCurrentPage === totalPages ? 'disabled' : ''} onclick="window.gotoBcDayPage(${bcDayCurrentPage + 1})">Next</button>`;
  }
  const pagDiv = document.getElementById('bcDayPagination');
  if (pagDiv) pagDiv.innerHTML = html;
}

window.gotoBcDayPage = function(page) {
  bcDayCurrentPage = page;
  renderDayReportTable();
  renderDayPagination(bcDayData.length);
};

function renderDayReportTable() {
  const startIdx = (bcDayCurrentPage - 1) * bcDayEntriesPerPage;
  const endIdx = Math.min(startIdx + bcDayEntriesPerPage, bcDayData.length);
  let tbodyHtml = '';
  for (let i = startIdx; i < endIdx; ++i) {
    const r = bcDayData[i];
    tbodyHtml += `<tr>
      <td class="bc-stt">${i+1}</td>
      <td>${r[1]}</td>
      <td>${r[2]}</td>
      <td>${r[11]}</td>
    </tr>`;
  }
  const tbody = document.getElementById('bcDayTableBody');
  if (tbody) tbody.innerHTML = tbodyHtml;
}

function attachBcDayEntriesSelectListener() {
  const sel = document.getElementById('bcDayEntriesSelect');
  if (sel) {
    sel.onchange = function() {
      bcDayEntriesPerPage = Number(this.value);
      bcDayCurrentPage = 1;
      renderDayReportTable();
      renderDayPagination(bcDayData.length);
    };
  }
}

// Set input placeholder/type theo loại báo cáo
function updateInputByType() {
  bcInput.type = 'text';
  bcInput.placeholder = '';
  bcInput.value = '';
  bcInput.style.display = '';
  bcInput.removeAttribute('min');
  bcInput.removeAttribute('max');
  bcInput.removeAttribute('step');

  if (bcYearSelect) bcYearSelect.style.display = 'none';

 // Ẩn hướng dẫn mặc định
  var dateHelp = document.getElementById('dateHelp');
  if (dateHelp) dateHelp.style.display = 'none';

  if (bcType.value === 'ngay') {
    bcInput.type = 'date';
    bcInput.value = '';
    bcInput.style.display = '';
    // HIỆN hướng dẫn khi chọn BC ngày
    if (dateHelp) dateHelp.style.display = '';
    if (bcYearSelect) bcYearSelect.style.display = 'none';
  } else if (bcType.value === 'thang') {
    bcInput.style.display = 'none';
    if (bcYearSelect) {
      const thisYear = new Date().getFullYear();
      const fromYear = 2025;
      const toYear = thisYear + 10;
      bcYearSelect.innerHTML = '<option value="">Chọn năm</option>';
      for (let y = fromYear; y <= toYear; y++) {
        bcYearSelect.innerHTML += `<option value="${y}">${y}</option>`;
      }
      bcYearSelect.style.display = '';
      bcYearSelect.value = '';
    }
  } else if (bcType.value === 'nam') {
    bcInput.value = '';
    bcInput.style.display = 'none';
    if (bcYearSelect) bcYearSelect.style.display = 'none';
  } else {
    bcInput.type = 'text';
    bcInput.placeholder = '';
    bcInput.value = '';
    bcInput.style.display = '';
    if (bcYearSelect) bcYearSelect.style.display = 'none';
  }
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';
}
bcType.addEventListener('change', updateInputByType);

bcResetBtn.onclick = function() {
  bcType.value = '';
  bcInput.value = '';
  bcInput.placeholder = '';
  bcInput.style.display = '';
  if (bcYearSelect) bcYearSelect.style.display = 'none';
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';
  lastSearch = { type: null, day: null, year: null, data: null };
    // Ẩn dòng hướng dẫn chọn ngày
  var dateHelp = document.getElementById('dateHelp');
  if (dateHelp) dateHelp.style.display = 'none';
};

// Hàm gọi API lấy dữ liệu, chỉ lọc phía server
async function fetchThongke(type, day, year) {
  let params = new URLSearchParams();
  params.append('type', type);
  if (day) params.append('day', day);
  if (year) params.append('year', year);
  try {
    const res = await fetch(`/api/baocaodt.js?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Lỗi không xác định');
    }
    return data.rows || [];
  } catch (err) {
    throw err;
  }
}

// Sự kiện Search
bcSearchBtn.onclick = async function() {
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';

  let type = bcType.value;
  let dayStr = '';
  let yearStr = '';

  if (type === 'ngay') {
    let dateStr = (bcInput.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      bcNote.textContent = 'Vui lòng chọn ngày!';
      return;
    }
    let [yyyy, mm, dd] = dateStr.split('-');
    dayStr = `${dd}/${mm}/${yyyy}`;
  } else if (type === 'thang') {
    yearStr = bcYearSelect && bcYearSelect.value ? bcYearSelect.value.trim() : '';
    if (!/^\d{4}$/.test(yearStr)) {
      bcNote.textContent = 'Vui lòng chọn năm!';
      return;
    }
  }

  // Kiểm tra cache client trước khi gọi API
  if (
    lastSearch.type === type &&
    lastSearch.day === dayStr &&
    lastSearch.year === yearStr &&
    lastSearch.data
  ) {
    renderReport(type, lastSearch.data, dayStr, yearStr);
    return;
  }

  try {
    bcNote.textContent = 'Đang tải dữ liệu...';
    const rows = await fetchThongke(type, dayStr, yearStr);
    lastSearch = { type, day: dayStr, year: yearStr, data: rows };
    renderReport(type, rows, dayStr, yearStr);
  } catch (err) {
    bcNote.textContent = `Không thể lấy dữ liệu báo cáo: ${err.message}`;
    bcTableWrap.innerHTML = '';
  }
};

function renderReport(type, rows, dayStr, yearStr) {
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';

  // Báo cáo ngày
  if (type === 'ngay') {
    bcDayData = rows;
    bcDayCurrentPage = 1;
    if (bcDayData.length === 0) {
      bcNote.textContent = `Ngày ${dayStr} không tồn tại trong báo cáo.`;
      return;
    }
    let total = bcDayData.reduce((t, r) => t + toInteger(r[11]), 0);
    let { controlsHtml, paginationHtml } = renderDayReportControls(bcDayData.length, total);
    let html = `
      <div class="bc-report-title">BÁO CÁO DOANH THU NGÀY</div>
      ${controlsHtml}
      <div class="bc-table-wrap">
        <table class="bc-table">
          <thead>
            <tr>
              <th>Stt</th>
              <th>Mã ĐH</th>
              <th>Tên KH</th>
              <th>Thành tiền</th>
            </tr>
          </thead>
          <tbody id="bcDayTableBody"></tbody>
        </table>
      </div>
      ${paginationHtml}
    `;
    bcTableWrap.innerHTML = html;
    renderDayReportTable();
    renderDayPagination(bcDayData.length);
    attachBcDayEntriesSelectListener();
    return;
  }

  // Báo cáo tháng
  if (type === 'thang') {
    if (rows.length === 0) {
      bcNote.textContent = `Năm ${yearStr} không tồn tại trong báo cáo.`;
      return;
    }
    let monthMap = {};
    let tongNam = 0;
    rows.forEach(r => {
      let month = getMonth(r[0]);
      if (!monthMap[month]) monthMap[month] = [];
      monthMap[month].push(r);
    });
    let monthArr = [];
    Object.keys(monthMap).sort().forEach(m => {
      let total = monthMap[m].reduce((t, r) => t + toInteger(r[11]), 0);
      tongNam += total;
      monthArr.push({ month: m, total, count: monthMap[m].length });
    });
    monthArr.forEach(mo => { mo.tyle = tongNam ? Math.round(mo.total*100/tongNam) : 0; });
    let html = `
      <div class="bc-report-title">BÁO CÁO DOANH THU THÁNG</div>
      <div class="bc-table-total-right">
        Tổng cộng: <span>${formatCurrency(tongNam)}</span>
      </div>
      <div class="bc-table-wrap">
        <table class="bc-table">
          <thead>
            <tr>
              <th>Tháng</th>
              <th>Thành tiền</th>
              <th>Tỷ lệ (%)</th>
            </tr>
          </thead>
          <tbody>
            ${monthArr.map(mo => `<tr>
              <td class="bc-month">${mo.month}/${yearStr}</td>
              <td>${formatCurrency(mo.total)}</td>
              <td>${mo.tyle}%</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    bcTableWrap.innerHTML = html;
    return;
  }

  // Báo cáo năm
  if (type === 'nam') {
    if (rows.length === 0) {
      bcNote.textContent = "Không có dữ liệu trong báo cáo.";
      return;
    }
    let yearMap = {};
    let tongAll = 0;
    rows.forEach(r => {
      let year = getYear(r[0]);
      if (!yearMap[year]) yearMap[year] = [];
      yearMap[year].push(r);
    });
    let yearArr = [];
    Object.keys(yearMap).sort().forEach(y => {
      let total = yearMap[y].reduce((t, r) => t + toInteger(r[11]), 0);
      tongAll += total;
      yearArr.push({ year: y, total, count: yearMap[y].length });
    });
    yearArr.forEach(yo => { yo.tyle = tongAll ? Math.round(yo.total*100/tongAll) : 0; });
    let html = `
      <div class="bc-report-title">BÁO CÁO DOANH THU NĂM</div>
      <div class="bc-table-total-right">
        Tổng cộng: <span>${formatCurrency(tongAll)}</span>
      </div>
      <div class="bc-table-wrap">
        <table class="bc-table">
          <thead>
            <tr>
              <th>Năm</th>
              <th>Thành tiền</th>
              <th>Tỷ lệ (%)</th>
            </tr>
          </thead>
          <tbody>
            ${yearArr.map(yo => `<tr>
              <td class="bc-year">${yo.year}</td>
              <td>${formatCurrency(yo.total)}</td>
              <td>${yo.tyle}%</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    bcTableWrap.innerHTML = html;
    return;
  }

  // Nếu không hợp lệ
  bcNote.textContent = "Vui lòng chọn loại báo cáo.";
}
