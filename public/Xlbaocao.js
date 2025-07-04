// ==== Thêm đoạn này vào đầu file Xlbaocao.js hoặc trong <style> của trang báo cáo ====

const style = document.createElement('style');
style.textContent = `
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
.bc-table-total-right {
  font-weight: bold;
  color: #1976d2;
  font-size: 1.08em;
  white-space: nowrap;
  margin-bottom: 0;
  margin-top: 0;
  padding-bottom: 0;
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

let rawTHONGKE = []; // Dữ liệu lấy từ API

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

// Thêm HTML cho chọn số entries và phân trang, gọi lại sau khi render bảng
function renderDayReportControls(totalEntries, totalAmount) {
  // Thêm tổng cộng bên phải và hiển thị...đơn hàng bên trái trong 1 container flex
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

// Render phân trang
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

// Chuyển trang
window.gotoBcDayPage = function(page) {
  bcDayCurrentPage = page;
  renderDayReportTable();
  renderDayPagination(bcDayData.length);
};

// Render lại bảng báo cáo ngày theo phân trang
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
      <td>${r[9]}</td>
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

  if (bcType.value === 'ngay') {
    bcInput.type = 'date';
    bcInput.value = '';
    bcInput.style.display = '';
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

// Nút Xóa (reset form)
bcResetBtn.onclick = function() {
  bcType.value = '';
  bcInput.value = '';
  bcInput.placeholder = '';
  bcInput.style.display = '';
  if (bcYearSelect) bcYearSelect.style.display = 'none';
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';
};

// Lấy dữ liệu THONGKE từ API
async function fetchThongke() {
  const res = await fetch('/api/baocaodt.js');
  if(res.ok) {
    const data = await res.json();
    rawTHONGKE = data.rows || [];
  } else {
    rawTHONGKE = [];
  }
}

// Sự kiện Search
bcSearchBtn.onclick = async function() {
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';

  if(!rawTHONGKE.length) await fetchThongke();

  // ----------------- BÁO CÁO NGÀY -----------------
  if (bcType.value === 'ngay') {
    let dateStr = (bcInput.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      bcNote.textContent = 'Vui lòng chọn ngày!';
      return;
    }
    let [yyyy, mm, dd] = dateStr.split('-');
    let dayStr = `${dd}/${mm}/${yyyy}`;

    const rows = rawTHONGKE.filter(r => {
      let rawDate = getDay(r[0]);
      return rawDate === dayStr && (r[14]||'').trim() === "Đã thanh toán";
    });

    // Lấy mỗi đơn hàng dòng đầu tiên theo Mã ĐH (cột B), giữ đúng thứ tự xuất hiện
    let seen = {};
    let arr = [];
    rows.forEach(r => {
      if(!seen[r[1]]) {
        seen[r[1]] = 1;
        arr.push(r);
      }
    });
    bcDayData = arr;
    bcDayCurrentPage = 1;

    if(arr.length === 0) {
      bcNote.textContent = `Ngày ${dayStr} không tồn tại trong báo cáo.`;
      return;
    }
    let total = arr.reduce((t, r) => t + toInteger(r[9]), 0);

    // SỬA TẠI ĐÂY: renderDayReportControls trả về controlsHtml, paginationHtml
    let { controlsHtml, paginationHtml } = renderDayReportControls(arr.length, total);

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
    renderDayPagination(arr.length);
    attachBcDayEntriesSelectListener();
  }

  // ----------------- BÁO CÁO THÁNG -----------------
  else if(bcType.value === 'thang') {
    const yearStr = bcYearSelect && bcYearSelect.value ? bcYearSelect.value.trim() : '';
    if(!/^\d{4}$/.test(yearStr)) {
      bcNote.textContent = 'Vui lòng chọn năm!';
      return;
    }
    const rows = rawTHONGKE.filter(r => getYear(r[0]) === yearStr && (r[14]||'').trim() === "Đã thanh toán");
    if(rows.length === 0) {
      bcNote.textContent = `Năm ${yearStr} không tồn tại trong báo cáo.`;
      return;
    }
    let monthMap = {};
    rows.forEach(r => {
      let month = getMonth(r[0]);
      let orderId = r[1];
      if(!monthMap[month]) monthMap[month] = {};
      if(!monthMap[month][orderId]) monthMap[month][orderId] = r;
    });
    let monthArr = [];
    let tongNam = 0;
    Object.keys(monthMap).sort().forEach(m => {
      let orders = Object.values(monthMap[m]);
      let total = orders.reduce((t, r) => t + toInteger(r[9]), 0);
      tongNam += total;
      monthArr.push({ month: m, total, count: orders.length });
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
  }

  // ----------------- BÁO CÁO NĂM -----------------
  else if(bcType.value === 'nam') {
    const rows = rawTHONGKE.filter(r => (r[14]||'').trim() === "Đã thanh toán");
    if(rows.length === 0) {
      bcNote.textContent = "Không có dữ liệu trong báo cáo.";
      return;
    }
    let yearMap = {};
    rows.forEach(r => {
      let year = getYear(r[0]);
      let orderId = r[1];
      if(!yearMap[year]) yearMap[year] = {};
      if(!yearMap[year][orderId]) yearMap[year][orderId] = r;
    });
    let yearArr = [];
    let tongAll = 0;
    Object.keys(yearMap).sort().forEach(y => {
      let orders = Object.values(yearMap[y]);
      let total = orders.reduce((t, r) => t + toInteger(r[9]), 0);
      tongAll += total;
      yearArr.push({ year: y, total, count: orders.length });
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
  }

  // ----------------- Lựa chọn chưa hợp lệ -----------------
  else {
    bcNote.textContent = "Vui lòng chọn loại báo cáo.";
  }
};
