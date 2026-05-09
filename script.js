// =============================================
// CONFIG: เปลี่ยนเป็น URL ของ Apps Script Web App ที่ Deploy แล้ว
// =============================================
const API_URL = 'https://script.google.com/macros/s/AKfycbzIHtQT0pBnoMyL65c8dIoWQPJahM0syThhoE13UfK-lAygc2x8BFTlc7msBHZzKm_g/exec';

function callApi(action, payload) {
  payload = payload || {};
  var bodyObj = {};
  for (var key in payload) {
    if (payload.hasOwnProperty(key)) bodyObj[key] = payload[key];
  }
  bodyObj.action = action;

  return fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(bodyObj),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }
  }).then(function(response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }).then(function(data) {
    if (!data) throw new Error('Empty response');
    return data;
  });
}

var currentUser = null;
var currentPage = 'landing';
var cooperativesData = [];
var inspectionsData = [];
var usersData = [];
var criteriaList = [];
var currentInspection = null;
var currentAttachments = [];
var pendingUploads = [];

// --- Init ---
document.addEventListener('DOMContentLoaded', function() {
  navigateTo('landing');
  loadLandingStats();
  document.getElementById('insp-date').valueAsDate = new Date();
});

// --- Loader ---
function showLoader(text) {
  var l = document.getElementById('loader');
  if (l) { l.querySelector('.loader-text').textContent = text || 'กำลังโหลด...'; l.classList.add('active'); }
}
function hideLoader() {
  var l = document.getElementById('loader');
  if (l) l.classList.remove('active');
}

// --- Toast ---
function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
}

// --- Navigation (SPA - ไม่ reload) ---
function navigateTo(page) {
  currentPage = page;
  var pages = ['landing', 'login', 'dashboard', 'inspection-list', 'inspection-form',
    'cooperative-list', 'cooperative-form', 'report-page', 'admin-users', 'admin-user-form', 'admin-settings',
    'inspection-team', 'assign-criteria', 'my-assignments'];

  pages.forEach(function(p) {
    var el = document.getElementById(p + '-page');
    if (el) el.classList.remove('active');
  });

  document.querySelectorAll('.sidebar-item, .bottom-nav-item').forEach(function(item) {
    item.classList.remove('active');
    if (item.getAttribute('data-page') === page) item.classList.add('active');
  });

  var target = document.getElementById(page + '-page');
  if (target) target.classList.add('active');

  var body = document.body;
  if (!currentUser) {
    body.classList.add('guest-state');
  } else {
    body.classList.remove('guest-state');
  }

  updateAuthUI();

  if (page === 'dashboard') loadDashboard();
  if (page === 'inspection-list') loadInspections();
  if (page === 'cooperative-list') loadCooperatives();
  if (page === 'report-page') loadReportPage();
  if (page === 'admin-users') loadUsers();
  if (page === 'admin-settings') loadSettings();
  if (page === 'my-assignments') loadMyAssignments();

  window.scrollTo(0, 0);
}

function updateAuthUI() {
  var isAdmin = currentUser && currentUser.role === 'admin';
  var isInspector = currentUser && (currentUser.role === 'admin' || currentUser.role === 'inspector');
  document.querySelectorAll('.admin-only').forEach(function(el) {
    el.style.display = isAdmin ? '' : 'none';
  });
  document.querySelectorAll('.inspector-only').forEach(function(el) {
    el.style.display = isInspector ? '' : 'none';
  });
  var bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) bottomNav.style.display = currentUser ? 'flex' : 'none';
}

function isTeamLeader(inspection) {
  if (!currentUser || !inspection) return false;
  if (currentUser.role === 'admin') return true;
  return inspection.teamLeaderId === currentUser.id;
}

function canEditCriterion(criterionResult, inspection) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (isTeamLeader(inspection)) return true;
  if (criterionResult.assignedTo === currentUser.id) return true;
  return false;
}

// --- Login ---
function handleLogin() {
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;
  if (!username || !password) { showToast('กรุณาระบุชื่อผู้ใช้และรหัสผ่าน', 'error'); return; }

  showLoader('กำลังเข้าสู่ระบบ...');
  callApi('login', {username: username, password: password})
    .then(function(res) {
      hideLoader();
      if (res && res.success && res.user) {
        currentUser = res.user;
        showToast('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ' + res.user.name, 'success');
        navigateTo('dashboard');
      } else {
        showToast(res && res.message ? res.message : 'เข้าสู่ระบบไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('ข้อผิดพลาด: ' + (err && err.message ? err.message : 'ไม่ทราบสาเหตุ'), 'error');
    });
}

function showLogoutModal() {
  var m = document.getElementById('logout-modal');
  if (m) m.classList.add('active');
}
function closeModal(id) {
  var m = document.getElementById(id);
  if (m) m.classList.remove('active');
}
function confirmLogout() {
  currentUser = null;
  currentInspection = null;
  pendingUploads = [];
  closeModal('logout-modal');
  showToast('ออกจากระบบสำเร็จ', 'info');
  navigateTo('landing');
  updateAuthUI();
}

// --- Dashboard ---
function loadDashboard() {
  showLoader('โหลดข้อมูลแดชบอร์ด...');
  callApi('getDashboardData', {})
    .then(function(res) {
      hideLoader();
      if (res && res.success && res.stats) {
        var s = res.stats;
        setText('dash-coop', s.totalCooperatives || 0);
        setText('dash-insp', s.totalInspections || 0);
        setText('dash-completed', s.completedInspections || 0);
        setText('dash-draft', s.draftInspections || 0);
        setText('dash-issue', s.totalIssues || 0);
        setText('dash-high', s.highRiskIssues || 0);
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดแดชบอร์ดไม่สำเร็จ', 'error');
    });

  callApi('getInspections', {})
    .then(function(res) {
      if (res && res.success && res.inspections) {
        var container = document.getElementById('dash-recent-list');
        if (!container) return;
        var html = '';
        var list = res.inspections || [];
        if (list.length === 0) { container.innerHTML = '<p class="text-sm text-gray-400">ไม่มีรายการ</p>'; return; }
        list.slice(0, 5).forEach(function(item) {
          html += '<div class="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition cursor-pointer" onclick="viewInspection(\'' + escapeHtml(item.id || '') + '\')">' +
            '<div><div class="font-medium text-sm text-gray-800">' + escapeHtml(item.cooperativeName || '') + '</div>' +
            '<div class="text-xs text-gray-400">' + escapeHtml(item.inspectionDate || '') + ' &middot; ' + escapeHtml(item.inspectorName || '') + '</div></div>' +
            '<span class="badge ' + getStatusClass(item.status) + '">' + escapeHtml(item.status || '') + '</span></div>';
        });
        container.innerHTML = html;
      }
    })
    .catch(function(err) {});
}

function loadLandingStats() {
  callApi('getDashboardData', {})
    .then(function(res) {
      if (res && res.success && res.stats) {
        setText('land-stat-coop', res.stats.totalCooperatives || 0);
        setText('land-stat-insp', res.stats.totalInspections || 0);
        setText('land-stat-issue', res.stats.totalIssues || 0);
      }
    })
    .catch(function(err) {});
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val !== null && val !== undefined ? val : '-';
}

// --- Cooperatives ---
function loadCooperatives() {
  showLoader('โหลดข้อมูลสหกรณ์...');
  callApi('getCooperatives', {})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        cooperativesData = res.cooperatives || [];
        renderCooperatives();
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดข้อมูลไม่สำเร็จ', 'error');
    });
}

function renderCooperatives() {
  var tbody = document.getElementById('cooperative-table-body');
  if (!tbody) return;
  if (!cooperativesData || cooperativesData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-6">ไม่มีข้อมูลสหกรณ์</td></tr>';
    return;
  }
  var html = '';
  cooperativesData.forEach(function(c) {
    html += '<tr>' +
      '<td>' + escapeHtml(c.id || '') + '</td>' +
      '<td>' + escapeHtml(c.name || '') + '</td>' +
      '<td>' + escapeHtml(c.regNo || '') + '</td>' +
      '<td>' + escapeHtml(c.type || '') + '</td>' +
      '<td>' + escapeHtml(c.members || '') + '</td>' +
      '<td>' + escapeHtml(c.fiscalYearEnd || '') + '</td>' +
      '<td><span class="badge ' + (c.status === 'active' ? 'status-passed' : 'status-draft') + '">' + escapeHtml(c.status || '') + '</span></td>' +
      '<td>';
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'inspector')) {
      html += '<button class="text-slate-700 text-sm hover:underline mr-2" onclick="editCooperative(\'' + escapeHtml(c.id || '') + '\')">แก้ไข</button>';
    }
    if (currentUser && currentUser.role === 'admin') {
      html += '<button class="text-red-500 text-sm hover:underline" onclick="deleteCooperativeConfirm(\'' + escapeHtml(c.id || '') + '\')">ลบ</button>';
    }
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'inspector')) {
      html += '<span class="text-xs text-gray-400">-</span>';
    }
    html += '</td></tr>';
  });
  tbody.innerHTML = html;
}

function openCooperativeForm() {
  document.getElementById('coop-id').value = '';
  document.getElementById('coop-form-title').textContent = 'เพิ่มสหกรณ์ใหม่';
  ['coop-name','coop-regno','coop-address','coop-phone','coop-members','coop-fiscal','coop-shares'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  navigateTo('cooperative-form');
}

function editCooperative(id) {
  var c = cooperativesData.find(function(x) { return x.id === id; });
  if (!c) return;
  document.getElementById('coop-id').value = c.id || '';
  document.getElementById('coop-name').value = c.name || '';
  document.getElementById('coop-regno').value = c.regNo || '';
  document.getElementById('coop-type').value = c.type || 'สหกรณ์การเกษตร';
  document.getElementById('coop-address').value = c.address || '';
  document.getElementById('coop-phone').value = c.phone || '';
  document.getElementById('coop-members').value = c.members || '';
  document.getElementById('coop-fiscal').value = c.fiscalYearEnd || '';
  document.getElementById('coop-shares').value = c.memberShares || '';
  document.getElementById('coop-status').value = c.status || 'active';
  document.getElementById('coop-form-title').textContent = 'แก้ไขสหกรณ์';
  navigateTo('cooperative-form');
}

function saveCooperative() {
  var data = {
    id: document.getElementById('coop-id').value,
    name: document.getElementById('coop-name').value,
    regNo: document.getElementById('coop-regno').value,
    type: document.getElementById('coop-type').value,
    address: document.getElementById('coop-address').value,
    phone: document.getElementById('coop-phone').value,
    members: document.getElementById('coop-members').value,
    fiscalYearEnd: document.getElementById('coop-fiscal').value,
    memberShares: document.getElementById('coop-shares').value,
    status: document.getElementById('coop-status').value,
    updatedBy: currentUser ? currentUser.name : 'system'
  };
  if (!data.name) { showToast('กรุณาระบุชื่อสหกรณ์', 'error'); return; }
  showLoader('กำลังบันทึก...');
  callApi('saveCooperative', data)
    .then(function(res) {
      hideLoader();
      if (res && res.success) { showToast(res.message || 'บันทึกสำเร็จ', 'success'); navigateTo('cooperative-list'); }
      else showToast(res && res.message ? res.message : 'บันทึกไม่สำเร็จ', 'error');
    })
    .catch(function(err) {
      hideLoader();
      showToast('ข้อผิดพลาด: ' + (err && err.message ? err.message : ''), 'error');
    });
}

function deleteCooperativeConfirm(id) {
  if (!confirm('ยืนยันการลบสหกรณ์นี้?')) return;
  showLoader('กำลังลบ...');
  callApi('deleteCooperative', {id: id})
    .then(function(res) {
      hideLoader();
      if (res && res.success) { showToast('ลบสำเร็จ', 'success'); loadCooperatives(); }
      else showToast(res && res.message ? res.message : 'ลบไม่สำเร็จ', 'error');
    })
    .catch(function(err) {
      hideLoader();
      showToast('ลบไม่สำเร็จ', 'error');
    });
}

// --- Inspections ---
function loadInspections() {
  showLoader('โหลดรายการตรวจสอบ...');
  callApi('getInspections', {})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        inspectionsData = res.inspections || [];
        renderInspections();
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดไม่สำเร็จ', 'error');
    });
}

function renderInspections() {
  var tbody = document.getElementById('inspection-table-body');
  if (!tbody) return;
  if (!inspectionsData || inspectionsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-400 py-6">ไม่มีรายการตรวจสอบ</td></tr>';
    return;
  }
  var html = '';
  inspectionsData.forEach(function(item) {
    var isLeader = isTeamLeader(item);
    html += '<tr>' +
      '<td>' + escapeHtml(item.id || '') + '</td>' +
      '<td>' + escapeHtml(item.cooperativeName || '') + '</td>' +
      '<td>' + escapeHtml(item.inspectionDate || '') + '</td>' +
      '<td>' + escapeHtml(item.inspectorName || '') + '</td>' +
      '<td><span class="badge ' + getStatusClass(item.status) + '">' + escapeHtml(item.status || '') + '</span></td>' +
      '<td>' + escapeHtml(item.overallResult || '-') + '</td>' +
      '<td>' +
      '<button class="text-slate-700 text-sm hover:underline mr-2" onclick="viewInspection(\'' + escapeHtml(item.id || '') + '\')">ดู</button>';
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'inspector')) {
      html += '<button class="text-slate-700 text-sm hover:underline mr-2" onclick="editInspection(\'' + escapeHtml(item.id || '') + '\')">แก้ไข</button>';
    }
    if (currentUser && currentUser.role === 'admin') {
      html += '<button class="text-blue-500 text-sm hover:underline mr-2" onclick="openTeamManagement(\'' + escapeHtml(item.id || '') + '\')">ทีม</button>';
    }
    if (isLeader) {
      html += '<button class="text-purple-500 text-sm hover:underline mr-2" onclick="openAssignCriteria(\'' + escapeHtml(item.id || '') + '\')">มอบหมาย</button>';
    }
    if (currentUser && currentUser.role === 'admin') {
      html += '<button class="text-red-500 text-sm hover:underline" onclick="deleteInspectionConfirm(\'' + escapeHtml(item.id || '') + '\')">ลบ</button>';
    }
    html += '</td></tr>';
  });
  tbody.innerHTML = html;
}

function viewInspection(id) {
  editInspection(id, true);
}

function editInspection(id, readonly) {
  showLoader('โหลดข้อมูล...');
  callApi('getInspectionDetail', {id: id})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        currentInspection = res;
        populateInspectionForm(res, readonly);
        navigateTo('inspection-form');
      } else {
        showToast('ไม่พบรายการ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดไม่สำเร็จ', 'error');
    });
}

function openInspectionForm() {
  currentInspection = null;
  currentAttachments = [];
  pendingUploads = [];
  document.getElementById('insp-id').value = '';
  document.getElementById('insp-form-title').textContent = 'สร้างรายการตรวจสอบใหม่';
  document.getElementById('insp-status').value = 'draft';
  document.getElementById('insp-overall').value = '';
  document.getElementById('insp-findings').value = '';
  document.getElementById('insp-recommendations').value = '';
  document.getElementById('insp-date').valueAsDate = new Date();
  if (currentUser) {
    document.getElementById('insp-inspector-id').value = currentUser.id || '';
    document.getElementById('insp-inspector-name').value = currentUser.name || '';
  }
  loadCooperativeSelect();
  loadCriteriaTabsAndForms(null, false);
  renderAttachments();
  navigateTo('inspection-form');
}

function populateInspectionForm(res, readonly) {
  var insp = res.inspection || {};
  document.getElementById('insp-id').value = insp.id || '';
  document.getElementById('insp-form-title').textContent = readonly ? 'รายละเอียดการตรวจสอบ' : 'แก้ไขรายการตรวจสอบ';
  document.getElementById('insp-status').value = insp.status || 'draft';
  document.getElementById('insp-overall').value = insp.overallResult || '';
  document.getElementById('insp-findings').value = insp.summaryFindings || '';
  document.getElementById('insp-recommendations').value = insp.summaryRecommendations || '';
  document.getElementById('insp-date').value = '';
  if (insp.inspectionDate) {
    var parts = insp.inspectionDate.split('-');
    if (parts.length === 3) {
      var y = parseInt(parts[2], 10);
      if (y > 2500) y -= 543;
      document.getElementById('insp-date').value = y + '-' + parts[1] + '-' + parts[0];
    }
  }
  document.getElementById('insp-inspector-id').value = insp.inspectorId || '';
  document.getElementById('insp-inspector-name').value = insp.inspectorName || '';

  loadCooperativeSelect(insp.cooperativeId);
  var isRead = !!readonly;
  loadCriteriaTabsAndForms(res.results || [], isRead);
  currentAttachments = res.attachments || [];
  renderAttachments();

  ['insp-coop-select','insp-date','insp-status','insp-overall','insp-findings','insp-recommendations']
    .forEach(function(id) { var el = document.getElementById(id); if (el) el.disabled = isRead; });
    
  var formPage = document.getElementById('inspection-form-page');
  if (formPage) {
    if (isRead) formPage.classList.add('readonly-mode');
    else formPage.classList.remove('readonly-mode');
  }
}

function loadCooperativeSelect(selectedId) {
  showLoader('โหลดรายชื่อสหกรณ์...');
  callApi('getCooperatives', {})
    .then(function(res) {
      hideLoader();
      var sel = document.getElementById('insp-coop-select');
      if (!sel) return;
      sel.innerHTML = '<option value="">เลือกสหกรณ์</option>';
      if (res && res.success && res.cooperatives) {
        res.cooperatives.forEach(function(c) {
          var opt = document.createElement('option');
          opt.value = c.id || '';
          opt.textContent = (c.name || '') + ' (' + (c.regNo || '') + ')';
          if (selectedId && c.id === selectedId) opt.selected = true;
          sel.appendChild(opt);
        });
      }
    })
    .catch(function(err) { hideLoader(); });
}

function updateCoopName() {
  var sel = document.getElementById('insp-coop-select');
  if (!sel || !sel.value) return;
  callApi('getCooperatives', {})
    .then(function(res) {
      if (res && res.success && res.cooperatives) {
        var c = res.cooperatives.find(function(x) { return x.id === sel.value; });
        if (c) { }
      }
    })
    .catch(function(err) {});
}

// --- Criteria Tabs & Forms ---
function loadCriteriaTabsAndForms(results, readonly) {
  if (!criteriaList || criteriaList.length === 0) {
    callApi('getCriteriaList', {})
      .then(function(res) {
        if (res && res.success && res.criteria) {
          criteriaList = res.criteria;
          buildCriteriaUI(results || [], readonly);
        }
      })
      .catch(function(err) {});
  } else {
    buildCriteriaUI(results || [], readonly);
  }
}

function buildCriteriaUI(results, readonly) {
  var tabsContainer = document.getElementById('criteria-tabs');
  var contentContainer = document.getElementById('criteria-content');
  if (!tabsContainer || !contentContainer) return;

  var tabsHtml = '';
  var contentHtml = '';
  var resultMap = {};
  if (results && results.length > 0) {
    results.forEach(function(r) { resultMap[r.criterionNo] = r; });
  }

  var inspection = currentInspection ? currentInspection.inspection : null;
  var isRead = !!readonly;

  criteriaList.forEach(function(c, idx) {
    var r = resultMap[c.no] || {};
    var activeClass = idx === 0 ? 'active' : '';
    var displayStyle = idx === 0 ? 'block' : 'none';
    var canEdit = canEditCriterion(r, inspection);
    var isAssigned = r.assignedTo && r.assignedTo !== '';
    var assignedLabel = isAssigned ? ('<span class="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded ml-2">มอบหมายให้: ' + escapeHtml(getUserNameById(r.assignedTo)) + '</span>') : '';
    var statusBadge = '';
    if (r.status === 'assigned') statusBadge = '<span class="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded ml-1">assigned</span>';
    if (r.status === 'submitted') statusBadge = '<span class="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded ml-1">submitted</span>';
    if (r.status === 'approved') statusBadge = '<span class="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded ml-1">approved</span>';

    tabsHtml += '<div class="criteria-tab ' + activeClass + '" data-cno="' + c.no + '" onclick="switchCriteriaTab(' + c.no + ')">' +
      '<span class="font-medium">' + c.no + '</span> ' + c.name + assignedLabel + statusBadge + '</div>';

    contentHtml += '<div id="criteria-panel-' + c.no + '" style="display:' + displayStyle + '">' +
      '<div class="criterion-form">' +
      '<div class="criterion-header">' + c.no + '. ' + c.name + '</div>' +
      '<div class="criterion-desc">' + escapeHtml(c.desc || '') + '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">' +
      '<div class="md:col-span-2">' +
      '<label class="pastel-label">ข้อเท็จจริงที่ตรวจพบ</label>' +
      '<textarea id="crit-findings-' + c.no + '" class="pastel-input w-full" rows="3" placeholder="สรุปข้อเท็จจริง..."' + (isRead || !canEdit ? ' disabled' : '') + '>' + escapeHtml(r.findings || '') + '</textarea>' +
      '</div>' +
      '<div class="md:col-span-2">' +
      '<label class="pastel-label">ข้อเสนอความเห็น / วิธีการแก้ไข</label>' +
      '<textarea id="crit-recs-' + c.no + '" class="pastel-input w-full" rows="3" placeholder="เสนอแนะและวิธีแก้ไข..."' + (isRead || !canEdit ? ' disabled' : '') + '>' + escapeHtml(r.recommendations || '') + '</textarea>' +
      '</div>' +
      '<div>' +
      '<label class="pastel-label">ระยะเวลาที่ควรให้แก้ไข (วัน)</label>' +
      '<input type="number" id="crit-deadline-' + c.no + '" class="pastel-input w-full" value="' + escapeHtml(r.deadlineDays || '') + '"' + (isRead || !canEdit ? ' disabled' : '') + '>' +
      '</div>' +
      '<div>' +
      '<label class="pastel-label">ระดับความเสี่ยง</label>' +
      '<select id="crit-risk-' + c.no + '" class="pastel-input w-full"' + (isRead || !canEdit ? ' disabled' : '') + '>' +
      '<option value="low" ' + (r.riskLevel === 'low' ? 'selected' : '') + '>ต่ำ (Low)</option>' +
      '<option value="medium" ' + (r.riskLevel === 'medium' ? 'selected' : '') + '>ปานกลาง (Medium)</option>' +
      '<option value="high" ' + (r.riskLevel === 'high' ? 'selected' : '') + '>สูง (High)</option>' +
      '</select>' +
      '</div>' +
      '<div>' +
      '<label class="pastel-label">สถานะ</label>' +
      '<select id="crit-status-' + c.no + '" class="pastel-input w-full"' + (isRead || !canEdit ? ' disabled' : '') + '>' +
      '<option value="pending" ' + (r.status === 'pending' ? 'selected' : '') + '>รอดำเนินการ</option>' +
      '<option value="passed" ' + (r.status === 'passed' ? 'selected' : '') + '>ผ่าน</option>' +
      '<option value="issue" ' + (r.status === 'issue' ? 'selected' : '') + '>พบปัญหา</option>' +
      '</select>' +
      '</div>' +
      '<div class="flex items-end">' +
      '<div id="crit-badge-' + c.no + '" class="risk-' + (r.riskLevel || 'low') + ' inline-block">' + getRiskLabel(r.riskLevel || 'low') + '</div>' +
      '</div>' +
      '</div>';

    // Show assignment info and action buttons for team workflow
    if (r.assignedTo && inspection) {
      var assignedUser = getUserNameById(r.assignedTo);
      contentHtml += '<div class="mt-3 p-3 bg-slate-50 rounded-lg text-sm">' +
        '<div class="flex justify-between items-center">' +
        '<span class="text-gray-600">ผู้รับมอบหมาย: <strong>' + escapeHtml(assignedUser) + '</strong></span>' +
        '<span class="text-xs text-gray-400">สถานะ: ' + escapeHtml(r.status || 'pending') + '</span>' +
        '</div>';

      // Submit button for assigned user
      if (r.assignedTo === (currentUser ? currentUser.id : '') && r.status !== 'approved') {
        contentHtml += '<button class="btn-pastel btn-mint px-4 py-1.5 text-xs mt-2" onclick="submitCriterionResult(' + c.no + ')">ส่งผลตรวจสอบ</button>';
      }

      // Review buttons for team leader
      if (isTeamLeader(inspection) && r.status === 'submitted') {
        contentHtml += '<div class="flex gap-2 mt-2">' +
          '<button class="btn-pastel btn-blue px-3 py-1.5 text-xs" onclick="reviewCriterionResult(' + c.no + ', \'approved\')">อนุมัติ</button>' +
          '<button class="btn-pastel bg-gray-100 text-gray-700 px-3 py-1.5 text-xs" onclick="reviewCriterionResult(' + c.no + ', \'rejected\')">ส่งกลับแก้ไข</button>' +
          '</div>';
      }

      contentHtml += '</div>';
    }

    contentHtml += '</div></div>';
  });

  tabsContainer.innerHTML = tabsHtml;
  contentContainer.innerHTML = contentHtml;

  criteriaList.forEach(function(c) {
    var riskSel = document.getElementById('crit-risk-' + c.no);
    if (riskSel) {
      riskSel.addEventListener('change', function() {
        var badge = document.getElementById('crit-badge-' + c.no);
        if (badge) { badge.className = 'risk-' + this.value + ' inline-block'; badge.textContent = getRiskLabel(this.value); }
      });
    }
  });
}

function getUserNameById(userId) {
  if (!userId) return userId;
  // 1. Try usersData first
  if (usersData && usersData.length > 0) {
    var u = usersData.find(function(x) { return x.id === userId; });
    if (u) return u.name;
  }
  // 2. Fallback to currentInspection.team
  if (currentInspection && currentInspection.team && currentInspection.team.length > 0) {
    var t = currentInspection.team.find(function(x) { return x.userId === userId; });
    if (t) return t.userName;
  }
  // 3. Fallback to currentInspection.inspection inspectorName
  if (currentInspection && currentInspection.inspection && currentInspection.inspection.inspectorId === userId) {
    return currentInspection.inspection.inspectorName || userId;
  }
  return userId;
}

function switchCriteriaTab(cno) {
  document.querySelectorAll('.criteria-tab').forEach(function(t) { t.classList.remove('active'); });
  var tab = document.querySelector('.criteria-tab[data-cno="' + cno + '"]');
  if (tab) tab.classList.add('active');
  criteriaList.forEach(function(c) {
    var panel = document.getElementById('criteria-panel-' + c.no);
    if (panel) panel.style.display = (c.no === cno) ? 'block' : 'none';
  });
}

function getRiskLabel(val) {
  if (val === 'high') return 'สูง';
  if (val === 'medium') return 'ปานกลาง';
  return 'ต่ำ';
}

// --- Save Inspection ---
function saveInspection() {
  var coopSel = document.getElementById('insp-coop-select');
  if (!coopSel || !coopSel.value) { showToast('กรุณาเลือกสหกรณ์', 'error'); return; }
  var coopName = coopSel.options[coopSel.selectedIndex].text;
  var dateVal = document.getElementById('insp-date').value;
  var dateStr = '';
  if (dateVal) {
    var d = new Date(dateVal);
    var y = d.getFullYear() + 543;
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    dateStr = day + '-' + m + '-' + y;
  }

  var results = [];
  criteriaList.forEach(function(c) {
    results.push({
      id: currentInspection && currentInspection.results ? (currentInspection.results.find(function(r){ return r.criterionNo === c.no; }) || {}).id : '',
      criterionNo: c.no,
      criterionName: c.name,
      findings: document.getElementById('crit-findings-' + c.no) ? document.getElementById('crit-findings-' + c.no).value : '',
      recommendations: document.getElementById('crit-recs-' + c.no) ? document.getElementById('crit-recs-' + c.no).value : '',
      deadlineDays: document.getElementById('crit-deadline-' + c.no) ? document.getElementById('crit-deadline-' + c.no).value : '',
      riskLevel: document.getElementById('crit-risk-' + c.no) ? document.getElementById('crit-risk-' + c.no).value : 'low',
      status: document.getElementById('crit-status-' + c.no) ? document.getElementById('crit-status-' + c.no).value : 'pending'
    });
  });

  var teamStatus = 'draft';
  var teamLeaderId = '';
  if (currentInspection && currentInspection.inspection) {
    teamStatus = currentInspection.inspection.teamStatus || 'draft';
    teamLeaderId = currentInspection.inspection.teamLeaderId || '';
  }

  var data = {
    id: document.getElementById('insp-id').value,
    cooperativeId: coopSel.value,
    cooperativeName: coopName.split('(')[0].trim(),
    inspectorId: currentUser ? currentUser.id : '',
    inspectorName: currentUser ? currentUser.name : '',
    inspectionDate: dateStr,
    status: document.getElementById('insp-status').value,
    overallResult: document.getElementById('insp-overall').value,
    summaryFindings: document.getElementById('insp-findings').value,
    summaryRecommendations: document.getElementById('insp-recommendations').value,
    teamStatus: teamStatus,
    teamLeaderId: teamLeaderId,
    results: results
  };

  showLoader('กำลังบันทึก...');
  callApi('saveInspection', data)
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        if (pendingUploads.length > 0) {
          uploadPendingFiles(res.id || data.id);
        }
        showToast('บันทึกรายการตรวจสอบสำเร็จ', 'success');
        navigateTo('inspection-list');
      } else {
        showToast(res && res.message ? res.message : 'บันทึกไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('ข้อผิดพลาด: ' + (err && err.message ? err.message : ''), 'error');
    });
}

function deleteInspectionConfirm(id) {
  if (!confirm('ยืนยันการลบรายการตรวจสอบนี้?')) return;
  showLoader('กำลังลบ...');
  callApi('deleteInspection', {id: id})
    .then(function(res) {
      hideLoader();
      if (res && res.success) { showToast('ลบสำเร็จ', 'success'); loadInspections(); }
      else showToast(res && res.message ? res.message : 'ลบไม่สำเร็จ', 'error');
    })
    .catch(function(err) {
      hideLoader();
      showToast('ลบไม่สำเร็จ', 'error');
    });
}

// --- File Upload ---
function handleFileUpload(input) {
  if (!input || !input.files || input.files.length === 0) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result;
    var mime = file.type || 'application/octet-stream';
    pendingUploads.push({ base64: base64, name: file.name, mimeType: mime });
    renderPendingAttachments();
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function renderPendingAttachments() {
  var container = document.getElementById('attachment-preview');
  if (!container) return;
  var html = '';
  currentAttachments.forEach(function(a) {
    html += renderAttachmentItem(a, false);
  });
  pendingUploads.forEach(function(p, idx) {
    html += '<div class="relative group">' +
      '<div class="w-24 h-24 rounded-xl bg-gray-100 flex items-center justify-center border-2 border-dashed border-slate-200">' +
      '<svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>' +
      '</div>' +
      '<button onclick="removePendingUpload(' + idx + ')" class="absolute -top-1 -right-1 w-5 h-5 bg-slate-500 text-white rounded-full text-xs flex items-center justify-center shadow hide-in-readonly">&times;</button>' +
      '<div class="text-[10px] text-gray-500 mt-1 w-24 truncate">' + escapeHtml(p.name) + '</div>' +
      '</div>';
  });
  container.innerHTML = html;
}

function renderAttachments() {
  renderPendingAttachments();
}

function renderAttachmentItem(a, showDelete) {
  var isImage = (a.fileType || '').indexOf('image') !== -1;
  var html = '<div class="relative group">';
  if (isImage) {
    html += '<img src="' + escapeHtml(a.fileUrl || '') + '" class="w-24 h-24 rounded-xl img-preview object-cover" onerror="this.parentNode.innerHTML=\'<div class=\\\'w-24 h-24 rounded-xl bg-gray-100 flex items-center justify-center text-xs text-gray-400\\\'>ไม่สามารถแสดงรูป</div>\'">';
  } else {
    html += '<a href="' + escapeHtml(a.fileUrl || '') + '" target="_blank" class="w-24 h-24 rounded-xl bg-gray-100 flex items-center justify-center border border-gray-200 hover:bg-gray-200 transition">' +
      '<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg></a>';
  }
  if (showDelete) {
    html += '<button onclick="deleteAttachmentConfirm(\'' + escapeHtml(a.id || '') + '\')" class="absolute -top-1 -right-1 w-5 h-5 bg-slate-500 text-white rounded-full text-xs flex items-center justify-center shadow">&times;</button>';
  }
  html += '<div class="text-[10px] text-gray-500 mt-1 w-24 truncate">' + escapeHtml(a.fileName || '') + '</div></div>';
  return html;
}

function removePendingUpload(idx) {
  pendingUploads.splice(idx, 1);
  renderPendingAttachments();
}

function uploadPendingFiles(inspectionId) {
  pendingUploads.forEach(function(p) {
    callApi('uploadFile', {
      base64Data: p.base64,
      fileName: p.name,
      mimeType: p.mimeType,
      inspectionId: inspectionId,
      criterionNo: ''
    })
      .then(function(res) {
        if (res && res.success) {
          showToast('อัปโหลด ' + p.name + ' สำเร็จ', 'success');
        } else {
          showToast('อัปโหลด ' + p.name + ' ไม่สำเร็จ: ' + (res && res.message ? res.message : ''), 'error');
        }
      })
      .catch(function(err) {
        showToast('อัปโหลด ' + p.name + ' ไม่สำเร็จ', 'error');
      });
  });
  pendingUploads = [];
}

function deleteAttachmentConfirm(id) {
  if (!confirm('ลบไฟล์นี้?')) return;
  callApi('deleteAttachment', {id: id})
    .then(function(res) {
      if (res && res.success) {
        showToast('ลบไฟล์สำเร็จ', 'success');
        if (currentInspection) editInspection(currentInspection.inspection.id);
      }
    })
    .catch(function(err) {
      showToast('ลบไฟล์ไม่สำเร็จ', 'error');
    });
}

// --- Report ---
function loadReportPage() {
  var sel = document.getElementById('report-insp-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">เลือกรายการตรวจสอบ</option>';
  callApi('getInspections', {})
    .then(function(res) {
      if (res && res.success && res.inspections) {
        res.inspections.forEach(function(item) {
          var opt = document.createElement('option');
          opt.value = item.id || '';
          opt.textContent = (item.id || '') + ' - ' + (item.cooperativeName || '') + ' (' + (item.inspectionDate || '') + ')';
          sel.appendChild(opt);
        });
      }
    })
    .catch(function(err) {});
}

function generateReport() {
  var sel = document.getElementById('report-insp-select');
  if (!sel || !sel.value) { showToast('กรุณาเลือกรายการตรวจสอบ', 'error'); return; }
  showLoader('กำลังสร้างรายงาน...');
  callApi('generateInspectionReport', {id: sel.value})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        document.getElementById('report-output').classList.remove('hidden');
        document.getElementById('report-content').textContent = res.report || '';
      } else {
        showToast('สร้างรายงานไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('สร้างรายงานไม่สำเร็จ', 'error');
    });
}

// --- Team Management ---
var currentTeamMembers = [];

function openTeamManagement(inspectionId) {
  document.getElementById('team-inspection-id').value = inspectionId;
  currentTeamMembers = [];
  showLoader('โหลดข้อมูลทีม...');
  callApi('getInspectionTeam', {inspectionId: inspectionId})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        currentTeamMembers = res.team || [];
        renderTeamMembers();
        loadUserSelect();
        navigateTo('inspection-team');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดข้อมูลทีมไม่สำเร็จ', 'error');
    });
}

function loadUserSelect() {
  var sel = document.getElementById('team-user-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">เลือกผู้ใช้</option>';
  if (!usersData || usersData.length === 0) {
    callApi('getUsers', {}).then(function(res) {
      if (res && res.success) {
        usersData = res.users || [];
        usersData.forEach(function(u) {
          if (u.status === 'active' && (u.role === 'inspector' || u.role === 'admin')) {
            var opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.name + ' (' + u.role + ')';
            sel.appendChild(opt);
          }
        });
      }
    });
  } else {
    usersData.forEach(function(u) {
      if (u.status === 'active' && (u.role === 'inspector' || u.role === 'admin')) {
        var opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name + ' (' + u.role + ')';
        sel.appendChild(opt);
      }
    });
  }
}

function renderTeamMembers() {
  var container = document.getElementById('team-members-list');
  if (!container) return;
  if (!currentTeamMembers || currentTeamMembers.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-400">ยังไม่มีสมาชิกทีม</p>';
    return;
  }
  var html = '';
  currentTeamMembers.forEach(function(m, idx) {
    html += '<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">' +
      '<div class="flex items-center gap-2">' +
      '<span class="font-medium text-sm">' + escapeHtml(m.userName || '') + '</span>' +
      '<span class="text-xs ' + (m.roleInTeam === 'leader' ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-100') + ' px-2 py-0.5 rounded">' + (m.roleInTeam === 'leader' ? 'หัวหน้าทีม' : 'สมาชิก') + '</span>' +
      '</div>' +
      '<button class="text-red-500 text-xs hover:underline" onclick="removeTeamMember(' + idx + ')">ลบ</button>' +
      '</div>';
  });
  container.innerHTML = html;
}

function addTeamMember() {
  var userSel = document.getElementById('team-user-select');
  var roleSel = document.getElementById('team-role-select');
  if (!userSel || !userSel.value) { showToast('กรุณาเลือกผู้ใช้', 'error'); return; }
  var userId = userSel.value;
  var userName = userSel.options[userSel.selectedIndex].text.split(' (')[0];
  var role = roleSel ? roleSel.value : 'member';

  // Check if already exists
  var exists = currentTeamMembers.some(function(m) { return m.userId === userId; });
  if (exists) { showToast('ผู้ใช้นี้อยู่ในทีมแล้ว', 'error'); return; }

  // If adding leader, remove existing leader
  if (role === 'leader') {
    currentTeamMembers = currentTeamMembers.filter(function(m) { return m.roleInTeam !== 'leader'; });
  }

  currentTeamMembers.push({
    userId: userId,
    userName: userName,
    roleInTeam: role,
    addedBy: currentUser ? currentUser.id : 'system'
  });
  renderTeamMembers();
  userSel.value = '';
}

function removeTeamMember(idx) {
  currentTeamMembers.splice(idx, 1);
  renderTeamMembers();
}

function saveTeamMembers() {
  var inspectionId = document.getElementById('team-inspection-id').value;
  if (!inspectionId) return;
  showLoader('กำลังบันทึก...');
  callApi('saveInspectionTeam', {
    inspectionId: inspectionId,
    members: currentTeamMembers
  })
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        showToast('บันทึกทีมสำเร็จ', 'success');
        navigateTo('inspection-list');
      } else {
        showToast(res && res.message ? res.message : 'บันทึกไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('บันทึกไม่สำเร็จ', 'error');
    });
}

// --- Assign Criteria ---
function openAssignCriteria(inspectionId) {
  document.getElementById('assign-inspection-id').value = inspectionId;
  showLoader('โหลดข้อมูล...');
  callApi('getInspectionDetail', {id: inspectionId})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        currentInspection = res;
        loadAssignCriteriaList();
        navigateTo('assign-criteria');
      } else {
        showToast('โหลดไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดไม่สำเร็จ', 'error');
    });
}

function loadAssignCriteriaList() {
  var container = document.getElementById('assign-criteria-list');
  if (!container) return;
  var team = currentInspection && currentInspection.team ? currentInspection.team : [];
  var results = currentInspection && currentInspection.results ? currentInspection.results : [];

  if (!team || team.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-400">ยังไม่มีทีมตรวจ กรุณาจัดการทีมก่อน</p>';
    return;
  }

  var html = '';
  results.forEach(function(r) {
    var assignedUserName = getUserNameById(r.assignedTo);
    html += '<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">' +
      '<div class="flex-1">' +
      '<div class="font-medium text-sm">' + r.criterionNo + '. ' + escapeHtml(r.criterionName) + '</div>' +
      '<div class="text-xs text-gray-400">' + (r.assignedTo ? 'มอบหมายให้: ' + escapeHtml(assignedUserName) : 'ยังไม่ได้มอบหมาย') + '</div>' +
      '</div>' +
      '<select class="pastel-input text-sm w-40" onchange="assignCriterion(' + r.criterionNo + ', this.value)">' +
      '<option value="">-- มอบหมาย --</option>';
    team.forEach(function(m) {
      var selected = r.assignedTo === m.userId ? 'selected' : '';
      html += '<option value="' + escapeHtml(m.userId) + '" ' + selected + '>' + escapeHtml(m.userName) + '</option>';
    });
    html += '</select></div>';
  });
  container.innerHTML = html;
}

function assignCriterion(criterionNo, userId) {
  if (!userId) return;
  var inspectionId = document.getElementById('assign-inspection-id').value;
  var userName = getUserNameById(userId);
  showLoader('กำลังมอบหมาย...');
  callApi('assignCriteria', {
    inspectionId: inspectionId,
    criterionNo: String(criterionNo),
    userId: userId,
    userName: userName,
    assignedBy: currentUser ? currentUser.id : ''
  })
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        showToast('มอบหมายสำเร็จ', 'success');
      } else {
        showToast(res && res.message ? res.message : 'มอบหมายไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('มอบหมายไม่สำเร็จ', 'error');
    });
}

// --- My Assignments ---
function loadMyAssignments() {
  if (!currentUser) return;
  showLoader('โหลดงานของฉัน...');
  callApi('getMyAssignments', {userId: currentUser.id})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        renderMyAssignments(res.assignments || []);
      } else {
        showToast('โหลดไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดไม่สำเร็จ', 'error');
    });
}

function renderMyAssignments(assignments) {
  var tbody = document.getElementById('my-assignments-table-body');
  if (!tbody) return;
  if (!assignments || assignments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-gray-400 py-6">ไม่มีงานที่ได้รับมอบหมาย</td></tr>';
    return;
  }
  var html = '';
  assignments.forEach(function(a) {
    var statusClass = a.status === 'submitted' ? 'status-completed' : (a.status === 'assigned' ? 'status-passed' : 'status-pending');
    html += '<tr>' +
      '<td>' + escapeHtml(a.inspectionId || '') + '</td>' +
      '<td>' + escapeHtml(a.criterionNo + '. ' + a.criterionName) + '</td>' +
      '<td><span class="badge ' + statusClass + '">' + escapeHtml(a.status || '') + '</span></td>' +
      '<td><button class="text-slate-700 text-sm hover:underline" onclick="openAssignmentInspection(\'' + escapeHtml(a.resultId) + '\')">ตรวจสอบ</button></td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function openAssignmentInspection(resultId) {
  showLoader('โหลดข้อมูล...');
  callApi('getMyAssignments', {userId: currentUser.id})
    .then(function(res) {
      hideLoader();
      if (res && res.success && res.assignments) {
        var assignment = res.assignments.find(function(a) { return a.resultId === resultId; });
        if (assignment && assignment.inspectionId) {
          editInspection(assignment.inspectionId, false);
        } else {
          showToast('ไม่พบรายการ', 'error');
        }
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดไม่สำเร็จ', 'error');
    });
}

// --- Submit / Review Criteria ---
function submitCriterionResult(criterionNo) {
  if (!currentInspection || !currentInspection.results) return;
  var result = currentInspection.results.find(function(r) { return r.criterionNo === criterionNo; });
  if (!result) return;
  if (!currentUser) return;

  var findings = document.getElementById('crit-findings-' + criterionNo) ? document.getElementById('crit-findings-' + criterionNo).value : '';
  var recommendations = document.getElementById('crit-recs-' + criterionNo) ? document.getElementById('crit-recs-' + criterionNo).value : '';
  var deadlineDays = document.getElementById('crit-deadline-' + criterionNo) ? document.getElementById('crit-deadline-' + criterionNo).value : '';
  var riskLevel = document.getElementById('crit-risk-' + criterionNo) ? document.getElementById('crit-risk-' + criterionNo).value : 'low';

  showLoader('กำลังส่งผล...');
  callApi('submitCriteriaResult', {
    resultId: result.id,
    userId: currentUser.id,
    findings: findings,
    recommendations: recommendations,
    deadlineDays: deadlineDays,
    riskLevel: riskLevel
  })
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        showToast('ส่งผลตรวจสอบสำเร็จ', 'success');
        editInspection(currentInspection.inspection.id, false);
      } else {
        showToast(res && res.message ? res.message : 'ส่งไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('ส่งไม่สำเร็จ', 'error');
    });
}

function reviewCriterionResult(criterionNo, status) {
  if (!currentInspection || !currentInspection.results) return;
  var result = currentInspection.results.find(function(r) { return r.criterionNo === criterionNo; });
  if (!result || !currentUser) return;

  var comment = '';
  if (status === 'rejected') {
    comment = prompt('ระบุหมายเหตุการส่งกลับแก้ไข:');
    if (comment === null) return;
  }

  showLoader('กำลังดำเนินการ...');
  callApi('reviewCriteria', {
    resultId: result.id,
    reviewerId: currentUser.id,
    status: status,
    comment: comment
  })
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        showToast(res.message || 'ดำเนินการสำเร็จ', 'success');
        editInspection(currentInspection.inspection.id, false);
      } else {
        showToast(res && res.message ? res.message : 'ดำเนินการไม่สำเร็จ', 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('ดำเนินการไม่สำเร็จ', 'error');
    });
}

function copyReport() {
  var text = document.getElementById('report-content').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(function() { showToast('คัดลอกรายงานแล้ว', 'success'); });
}

function printReport() {
  var content = document.getElementById('report-content').innerHTML;
  var w = window.open('', '_blank');
  w.document.write('<html><head><meta charset="UTF-8"><title>รายงานการตรวจสอบ</title></head><body style="font-family:Kanit,sans-serif;padding:24px;line-height:1.8;"><pre style="white-space:pre-wrap;font-family:Kanit,sans-serif;">' + content + '</pre></body></html>');
  w.document.close();
  w.print();
}

// --- Admin: Users ---
function loadUsers() {
  showLoader('โหลดข้อมูลผู้ใช้...');
  callApi('getUsers', {})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        usersData = res.users || [];
        renderUsers();
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('โหลดไม่สำเร็จ', 'error');
    });
}

function renderUsers() {
  var tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  if (!usersData || usersData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-400 py-6">ไม่มีข้อมูลผู้ใช้</td></tr>';
    return;
  }
  var html = '';
  usersData.forEach(function(u) {
    html += '<tr>' +
      '<td>' + escapeHtml(u.username || '') + '</td>' +
      '<td>' + escapeHtml(u.name || '') + '</td>' +
      '<td>' + escapeHtml(u.role || '') + '</td>' +
      '<td>' + escapeHtml(u.email || '') + '</td>' +
      '<td><span class="badge ' + (u.status === 'active' ? 'status-passed' : 'status-draft') + '">' + escapeHtml(u.status || '') + '</span></td>' +
      '<td><button class="text-slate-700 text-sm hover:underline mr-2" onclick="editUser(\'' + escapeHtml(u.id || '') + '\')">แก้ไข</button>' +
      '<button class="text-slate-700 text-sm hover:underline" onclick="deleteUserConfirm(\'' + escapeHtml(u.id || '') + '\')">ลบ</button></td></tr>';
  });
  tbody.innerHTML = html;
}

function openUserForm() {
  document.getElementById('user-id').value = '';
  document.getElementById('user-form-title').textContent = 'เพิ่มผู้ใช้ใหม่';
  ['user-username','user-password','user-name','user-email'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('user-role').value = 'inspector';
  document.getElementById('user-status').value = 'active';
  document.getElementById('user-pwd-hint').textContent = '* (สำหรับผู้ใช้ใหม่)';
  navigateTo('admin-user-form');
}

function editUser(id) {
  var u = usersData.find(function(x) { return x.id === id; });
  if (!u) return;
  document.getElementById('user-id').value = u.id || '';
  document.getElementById('user-username').value = u.username || '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-name').value = u.name || '';
  document.getElementById('user-role').value = u.role || 'inspector';
  document.getElementById('user-email').value = u.email || '';
  document.getElementById('user-status').value = u.status || 'active';
  document.getElementById('user-form-title').textContent = 'แก้ไขผู้ใช้';
  document.getElementById('user-pwd-hint').textContent = '(เว้นว่างหากไม่เปลี่ยน)';
  navigateTo('admin-user-form');
}

function saveUser() {
  var data = {
    id: document.getElementById('user-id').value,
    username: document.getElementById('user-username').value,
    password: document.getElementById('user-password').value,
    name: document.getElementById('user-name').value,
    role: document.getElementById('user-role').value,
    email: document.getElementById('user-email').value,
    status: document.getElementById('user-status').value
  };
  if (!data.username || !data.name) { showToast('กรุณาระบุชื่อผู้ใช้และชื่อ-นามสกุล', 'error'); return; }
  if (!data.id && !data.password) { showToast('กรุณาระบุรหัสผ่านสำหรับผู้ใช้ใหม่', 'error'); return; }
  showLoader('กำลังบันทึก...');
  callApi('saveUser', data)
    .then(function(res) {
      hideLoader();
      if (res && res.success) { showToast(res.message || 'บันทึกสำเร็จ', 'success'); navigateTo('admin-users'); }
      else showToast(res && res.message ? res.message : 'บันทึกไม่สำเร็จ', 'error');
    })
    .catch(function(err) {
      hideLoader();
      showToast('ข้อผิดพลาด', 'error');
    });
}

function deleteUserConfirm(id) {
  if (!confirm('ยืนยันการลบผู้ใช้นี้?')) return;
  showLoader('กำลังลบ...');
  callApi('deleteUser', {id: id})
    .then(function(res) {
      hideLoader();
      if (res && res.success) { showToast('ลบสำเร็จ', 'success'); loadUsers(); }
      else showToast(res && res.message ? res.message : 'ลบไม่สำเร็จ', 'error');
    })
    .catch(function(err) {
      hideLoader();
      showToast('ลบไม่สำเร็จ', 'error');
    });
}

// --- Admin: Settings ---
function loadSettings() {
  callApi('getSettings', {})
    .then(function(res) {
      if (res && res.success && res.settings) {
        var s = res.settings;
        var el1 = document.getElementById('setting-systemName'); if (el1) el1.value = s.systemName || '';
        var el2 = document.getElementById('setting-driveFolderId'); if (el2) el2.value = s.driveFolderId || '';
        var el3 = document.getElementById('setting-version'); if (el3) el3.value = s.version || '';
        var el4 = document.getElementById('setting-allowRegister'); if (el4) el4.value = s.allowRegister || 'false';
      }
    })
    .catch(function(err) {
      showToast('โหลดการตั้งค่าไม่สำเร็จ', 'error');
    });
}

function saveSettings() {
  var pairs = [
    { key: 'systemName', val: document.getElementById('setting-systemName').value },
    { key: 'version', val: document.getElementById('setting-version').value },
    { key: 'allowRegister', val: document.getElementById('setting-allowRegister').value }
  ];
  var done = 0;
  pairs.forEach(function(p) {
    callApi('saveSetting', {key: p.key, value: p.val})
      .then(function() {
        done++;
        if (done >= pairs.length) showToast('บันทึกการตั้งค่าสำเร็จ', 'success');
      })
      .catch(function() {
        showToast('บันทึกบางรายการไม่สำเร็จ', 'error');
      });
  });
}

function runSetup() {
  if (!confirm('รัน setupSystem() จะสร้างชีตและข้อมูลตัวอย่างใหม่ ดำเนินการต่อ?')) return;
  showLoader('กำลังสร้างโครงสร้างระบบ...');
  callApi('setupSystem', {})
    .then(function(res) {
      hideLoader();
      if (res && res.success) {
        showToast('Setup สำเร็จ: ' + (res.message || ''), 'success');
      } else {
        showToast('Setup ไม่สำเร็จ: ' + (res && res.message ? res.message : ''), 'error');
      }
    })
    .catch(function(err) {
      hideLoader();
      showToast('Setup ไม่สำเร็จ: ' + (err && err.message ? err.message : ''), 'error');
    });
}

// --- Admin Panel (Mobile) ---
function toggleAdminPanel() {
  var overlay = document.getElementById('admin-panel-overlay');
  if (overlay) overlay.classList.toggle('active');
}

// --- Helpers ---
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  var div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function getStatusClass(status) {
  if (status === 'completed') return 'status-completed';
  if (status === 'draft') return 'status-draft';
  if (status === 'passed') return 'status-passed';
  if (status === 'issue') return 'status-issue';
  if (status === 'pending') return 'status-pending';
  if (status === 'assigned') return 'status-passed';
  if (status === 'submitted') return 'status-completed';
  if (status === 'approved') return 'status-passed';
  return 'status-draft';
}

window.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeModal('logout-modal');
    var panel = document.getElementById('admin-panel-overlay');
    if (panel && panel.classList.contains('active')) panel.classList.remove('active');
  }
});
