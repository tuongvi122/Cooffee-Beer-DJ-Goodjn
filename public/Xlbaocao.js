// Xlbaocao.js
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
    color: #1976d2 !;
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
  margin-bottom: 0;
  margin-top: 0;
  padding-bottom: 0;
}
.report-entries-container select {
  font-size: 1em;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1.2px solid #b5c8db;
  outline: none;
}
.bc-note-loading::before {
  content: '';
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #43a047;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 0;
  vertical-align: middle;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;
document.head.appendChild(style);

const bcType = document.getElementById('bcType');
const bcInput = document.getElementById('bcInput');
const bcYearSelect = document.getElementById('bcYearSelect');
const bcSearchBtn = document.getElementById('bcSearchBtn');
const bcResetBtn = document.getElementById('bcResetBtn');
const bcNote = document.getElementById('bcNote');
const bcTableWrap = document.getElementById('bcTableWrap');

let cache = new Map(); // Cache theo key `type-day-year`
const CACHE_EXPIRE = 300000; // 5 phút

function formatCurrency(num) {
  return (Number(num) || 0).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' }).replace('₫', '').trim();
}

function toInteger(str) {
  return Number((str || '').replace(/\./g, '')) || 0;
}

function getDay(str) {
  return (str || '').split(' ')[0];
}

function getMonth(str) {
  return getDay(str).split('/')[1] || '';
}

function getYear(str) {
  return getDay(str).split('/')[2] || '';
}

let bcDayEntriesPerPage = 10;
let bcDayCurrentPage = 1;
let bcDayData = [];

function renderDayReportControls(totalEntries, totalAmount) {
  const controls = document.createElement('div');
  controls.className = 'bc-table-controls';
  controls.innerHTML = `
    <div class="report-entries-container">
      Hiển thị 
      <select id="bcDayEntriesSelect">
        <option value="10"${bcDayEntriesPerPage === 10 ? ' selected' : ''}>10</option>
        <option value="20"${bcDayEntriesPerPage === 20 ? ' selected' : ''}>20</option>
        <option value="50"${bcDayEntriesPerPage === 50 ? ' selected' : ''}>50</option>
        <option value="100"${bcDayEntriesPerPage === 100 ? ' selected' : ''}>100</option>
      </select>
      đơn hàng
    </div>
    <div class="bc-table-total-right">
      Tổng cộng: <span>${formatCurrency(totalAmount)}</span>
    </div>
  `;
  const pagination = document.createElement('div');
  pagination.id = 'bcDayPagination';
  pagination.className = 'order-pagination';
  return { controls, pagination };
}

function renderDayPagination(totalEntries) {
  const totalPages = Math.ceil(totalEntries / bcDayEntriesPerPage);
  const pagDiv = document.getElementById('bcDayPagination');
  if (!pagDiv || totalPages <= 1) return;

  const fragment = document.createDocumentFragment();
  const addButton = (text, page, disabled, active) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    if (active) btn.className = 'active';
    if (!disabled) btn.onclick = () => window.gotoBcDayPage(page);
    if (disabled) btn.disabled = true;
    fragment.appendChild(btn);
  };

  addButton('Previous', bcDayCurrentPage - 1, bcDayCurrentPage === 1);
  let start = Math.max(1, bcDayCurrentPage - 2);
  let end = Math.min(totalPages, bcDayCurrentPage + 2);
  if (bcDayCurrentPage <= 3) end = Math.min(5, totalPages);
  if (bcDayCurrentPage >= totalPages - 2) start = Math.max(1, totalPages - 4);
  if (start > 1) {
    addButton('1', 1, false);
    if (start > 2) {
      const span = document.createElement('span');
      span.textContent = '...';
      fragment.appendChild(span);
    }
  }
  for (let i = start; i <= end; ++i) {
    addButton(i, i, false, i === bcDayCurrentPage);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) {
      const span = document.createElement('span');
      span.textContent = '...';
      fragment.appendChild(span);
    }
    addButton(totalPages, totalPages, false);
  }
  addButton('Next', bcDayCurrentPage + 1, bcDayCurrentPage === totalPages);
  pagDiv.innerHTML = '';
  pagDiv.appendChild(fragment);
}

window.gotoBcDayPage = function(page) {
  bcDayCurrentPage = page;
  renderDayReportTable();
  renderDayPagination(bcDayData.length);
};

function renderDayReportTable() {
  const startIdx = (bcDayCurrentPage - 1) * bcDayEntriesPerPage;
  const endIdx = Math.min(startIdx + bcDayEntriesPerPage, bcDayData.length);
  const tbody = document.getElementById('bcDayTableBody');
  if (!tbody) return;

  const fragment = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; ++i) {
    const r = bcDayData[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="bc-stt">${i + 1}</td>
      <td>${r[1]}</td>
      <td>${r[2]}</td>
      <td>${formatCurrency(toInteger(r[11]))}</td>
    `;
    fragment.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(fragment);
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

function updateInputByType() {
  bcInput.type = 'text';
  bcInput.placeholder = '';
  bcInput.value = '';
  bcInput.style.display = '';
  bcInput.removeAttribute('min');
  bcInput.removeAttribute('max');
  bcInput.removeAttribute('step');
  if (bcYearSelect) bcYearSelect.style.display = 'none';
  const dateHelp = document.getElementById('dateHelp');
  if (dateHelp) dateHelp.style.display = 'none';

  if (bcType.value === 'ngay') {
    bcInput.type = 'date';
    bcInput.focus();
    if (dateHelp) dateHelp.style.display = '';
  } else if (bcType.value === 'thang') {
    bcInput.style.display = 'none';
    if (bcYearSelect) {
      const thisYear = new Date().getFullYear();
      const fromYear = 2025;
      const toYear = thisYear + 10;
      bcYearSelect.innerHTML = '<option value="">Chọn năm</option>' +
        Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i)
          .map(y => `<option value="${y}">${y}</option>`).join('');
      bcYearSelect.style.display = '';
    }
  } else if (bcType.value === 'nam') {
    bcInput.style.display = 'none';
    if (bcYearSelect) bcYearSelect.style.display = 'none';
  }
  bcNote.textContent = '';
  bcTableWrap.innerHTML = '';
}

bcType.addEventListener('change', updateInputByType);

// Gọi updateInputByType khi trang tải để đồng bộ hóa ban đầu
document.addEventListener('DOMContentLoaded', function() {
  updateInputByType(); // Đồng bộ hóa ban đầu
  const dateHelp = document.getElementById('dateHelp');
  if (bcInput && dateHelp && bcType) {
    bcInput.addEventListener('input', function() {
      if (bcType.value === 'ngay' && bcInput.value) dateHelp.style.display = 'none';
      else if (bcType.value === 'ngay') dateHelp.style.display = '';
    });
    bcInput.addEventListener('change', function() {
      if (bcType.value === 'ngay' && !bcInput.value) dateHelp.style.display = '';
    });
  }
});

bcResetBtn.onclick = function() {
  bcType.value = '';
  updateInputByType();
  cache.clear();
};

function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

async function fetchThongke(type, day, year) {
  const cacheKey = `${type}-${day || ''}-${year || ''}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_EXPIRE) {
    return cached.data;
  }
  const params = new URLSearchParams({ type });
  if (day) params.append('day', day);
  if (year) params.append('year', year);
  const res = await fetch(`/api/baocaodt.js?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
  cache.set(cacheKey, { data: data.rows || [], time: Date.now() });
  return data.rows;
}

bcSearchBtn.onclick = debounce(async function() {
  bcNote.className = 'bc-note bc-note-loading';
  bcTableWrap.innerHTML = '';

  const type = bcType.value;
  let dayStr = '';
  let yearStr = '';

  if (type === 'ngay') {
    const dateStr = (bcInput.value || '').trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      bcNote.className = 'bc-note';
      bcNote.textContent = 'Vui lòng chọn ngày hợp lệ!';
      return;
    }
    const [yyyy, mm, dd] = dateStr.split('-');
    dayStr = `${dd}/${mm}/${yyyy}`;
  } else if (type === 'thang') {
    yearStr = bcYearSelect?.value?.trim() || '';
    if (!yearStr || !/^\d{4}$/.test(yearStr)) {
      bcNote.className = 'bc-note';
      bcNote.textContent = 'Vui lòng chọn năm!';
      return;
    }
  } else if (type === 'nam') {
    // Không cần day hoặc year cho loại 'nam'
  } else {
    bcNote.className = 'bc-note';
    bcNote.textContent = 'Vui lòng chọn loại báo cáo!';
    return;
  }

  try {
    const rows = await fetchThongke(type, dayStr, yearStr);
    bcNote.className = 'bc-note';
    renderReport(type, rows, dayStr, yearStr);
  } catch (err) {
    bcNote.className = 'bc-note';
    bcNote.textContent = `Không thể lấy dữ liệu: ${err.message}`;
  }
}, 300);

function renderReport(type, rows, dayStr, yearStr) {
  if (!rows.length) {
    bcNote.textContent = type === 'ngay' ? `Ngày ${dayStr} không có dữ liệu.` :
                         type === 'thang' ? `Năm ${yearStr} không có dữ liệu.` :
                         'Không có dữ liệu trong báo cáo.';
    return;
  }

  const fragment = document.createDocumentFragment();
  const title = document.createElement('div');
  title.className = 'bc-report-title';
  title.textContent = type === 'ngay' ? 'BÁO CÁO DOANH THU NGÀY' :
                      type === 'thang' ? 'BÁO CÁO DOANH THU THÁNG' :
                      'BÁO CÁO DOANH THU NĂM';
  fragment.appendChild(title);

  if (type === 'ngay') {
    bcDayData = rows;
    bcDayCurrentPage = 1;
    const total = bcDayData.reduce((t, r) => t + toInteger(r[11]), 0);
    const { controls, pagination } = renderDayReportControls(bcDayData.length, total);
    const tableWrap = document.createElement('div');
    tableWrap.className = 'bc-table-wrap';
    const table = document.createElement('table');
    table.className = 'bc-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Stt</th>
          <th>Mã ĐH</th>
          <th>Tên KH</th>
          <th>Thành tiền</th>
        </tr>
      </thead>
      <tbody id="bcDayTableBody"></tbody>
    `;
    tableWrap.appendChild(table);
    fragment.appendChild(controls);
    fragment.appendChild(tableWrap);
    fragment.appendChild(pagination);
    bcTableWrap.innerHTML = '';
    bcTableWrap.appendChild(fragment);
    renderDayReportTable();
    renderDayPagination(bcDayData.length);
    attachBcDayEntriesSelectListener();
  } else {
    const total = rows.reduce((t, r) => t + (Number(r.total) || 0), 0);
    const totalDiv = document.createElement('div');
    totalDiv.className = 'bc-table-total-right';
    totalDiv.innerHTML = `Tổng cộng: <span>${formatCurrency(total)}</span>`;
    const tableWrap = document.createElement('div');
    tableWrap.className = 'bc-table-wrap';
    const table = document.createElement('table');
    table.className = 'bc-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>${type === 'thang' ? 'Tháng' : 'Năm'}</th>
          <th>Thành tiền</th>
          <th>Tỷ lệ (%)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="bc-${type === 'thang' ? 'month' : 'year'}">${r[type === 'thang' ? 'monthYear' : 'year']}</td>
            <td>${formatCurrency(r.total)}</td>
            <td>${r.tyle}%</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    tableWrap.appendChild(table);
    fragment.appendChild(totalDiv);
    fragment.appendChild(tableWrap);
    bcTableWrap.innerHTML = '';
    bcTableWrap.appendChild(fragment);
  }
}
