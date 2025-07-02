// Xlbaocao.js – Xử lý báo cáo doanh thu cho Baocao.html (dropdown năm cho BC tháng)

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
// Trả về "dd/MM/yyyy" từ chuỗi "dd/MM/yyyy HH:mm:ss"
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

// Set input placeholder/type theo loại báo cáo
function updateInputByType() {
  // Reset input về mặc định
  bcInput.type = 'text';
  bcInput.placeholder = '';
  bcInput.value = '';
  bcInput.style.display = '';
  bcInput.removeAttribute('min');
  bcInput.removeAttribute('max');
  bcInput.removeAttribute('step');

  // Ẩn dropdown năm mặc định
  if (bcYearSelect) bcYearSelect.style.display = 'none';

  if (bcType.value === 'ngay') {
    bcInput.type = 'date';
    bcInput.value = '';
    bcInput.style.display = '';
    if (bcYearSelect) bcYearSelect.style.display = 'none';
  } else if (bcType.value === 'thang') {
    // Ẩn input thường, show dropdown
    bcInput.style.display = 'none';
    if (bcYearSelect) {
      // Tạo danh sách năm từ 2025 đến hiện tại + 10
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
    // Kiểm tra định dạng yyyy-mm-dd (giá trị từ input type="date")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      bcNote.textContent = 'Vui lòng chọn ngày!';
      return;
    }
    // Chuyển từ yyyy-mm-dd thành dd/MM/yyyy để so sánh với sheet
    let [yyyy, mm, dd] = dateStr.split('-');
    let dayStr = `${dd}/${mm}/${yyyy}`;

    // Lọc đúng chuỗi ngày trong cột A (bỏ phần giờ phút giây)
    const rows = rawTHONGKE.filter(r => {
      let rawDate = getDay(r[0]); // chỉ lấy phần "dd/MM/yyyy"
      return rawDate === dayStr && (r[14]||'').trim() === "Đã thanh toán";
    });

    // Lấy mỗi đơn hàng dòng đầu tiên theo Mã ĐH (cột B)
    let map = {};
    rows.forEach(r => {
      if(!map[r[1]]) map[r[1]] = r;
    });
    let arr = Object.values(map);
    if(arr.length === 0) {
      bcNote.textContent = `Ngày ${dayStr} không tồn tại trong báo cáo.`;
      return;
    }
    // Tổng thành tiền (cột J)
    let total = arr.reduce((t, r) => t + toInteger(r[9]), 0);

    // Hiển thị bảng
    let html = `
      <div class="bc-report-title">BÁO CÁO DOANH THU NGÀY</div>
      <div class="bc-table-total-right">
        Tổng cộng: <span>${formatCurrency(total)}</span>
      </div>
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
          <tbody>
            ${arr.map((r,i) => `<tr>
              <td class="bc-stt">${i+1}</td>
              <td>${r[1]}</td>
              <td>${r[2]}</td>
              <td>${r[9]}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    bcTableWrap.innerHTML = html;
  }

  // ----------------- BÁO CÁO THÁNG -----------------
  else if(bcType.value === 'thang') {
    // Lấy năm từ dropdown
    const yearStr = bcYearSelect && bcYearSelect.value ? bcYearSelect.value.trim() : '';
    if(!/^\d{4}$/.test(yearStr)) {
      bcNote.textContent = 'Vui lòng chọn năm!';
      return;
    }
    // Lọc các dòng thuộc năm nhập vào, cột O là "Đã thanh toán"
    const rows = rawTHONGKE.filter(r => getYear(r[0]) === yearStr && (r[14]||'').trim() === "Đã thanh toán");
    if(rows.length === 0) {
      bcNote.textContent = `Năm ${yearStr} không tồn tại trong báo cáo.`;
      return;
    }
    // Gom nhóm theo tháng, mỗi tháng chỉ lấy đơn hàng dòng đầu tiên (theo mã ĐH), rồi tính tổng thành tiền (cột J)
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
    // Hiển thị bảng
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
    // Lấy toàn bộ dòng có cột O là "Đã thanh toán"
    const rows = rawTHONGKE.filter(r => (r[14]||'').trim() === "Đã thanh toán");
    if(rows.length === 0) {
      bcNote.textContent = "Không có dữ liệu trong báo cáo.";
      return;
    }
    // Gom nhóm theo năm, mỗi năm chỉ lấy đơn hàng dòng đầu tiên (theo mã ĐH), rồi tính tổng thành tiền (cột J)
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
    // Hiển thị bảng
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
