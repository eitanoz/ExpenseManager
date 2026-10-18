// Connected Backend Google Apps Script Web App URL
var SCRIPT_URL = window.SCRIPT_URL || "https://script.google.com/macros/s/AKfycbyum6T_l__A43wHTS7epcJoeWhaOHIjdAFFTA2aNeCpQt568WiZuLFhXeoLdeF6h5K1/exec";
var RATES = window.RATES || { ILS: 1, USD: 3.70, EUR: 4.00 };

function getRateToILS(currency) {
  if (!currency) return 1;
  var clean = String(currency).trim().toUpperCase();
  if (clean === 'ILS') return 1;
  if (typeof RATES !== 'undefined' && RATES[clean]) return parseFloat(RATES[clean]);
  if (clean === 'USD') return 3.70;
  if (clean === 'EUR') return 4.00;
  return 1;
}

var expenses = [];
var packages = [];
var vouchers = [];
var cards = [];
var trendChartInstance = null;
var packagesChartInstance = null;
var categoryChartInstance = null;
var cardChartInstance = null;

function switchTab(tab) {
  try {
    var tabs = ['expenses', 'analytics', 'packages', 'vouchers', 'settings'];
    tabs.forEach(function(t) {
      var view = document.getElementById('view-' + t);
      var btn = document.getElementById('tab-' + t);
      if (view) view.classList.toggle('hidden', t !== tab);
      if (btn) {
        btn.className = (t === tab)
          ? "tab-btn px-4 py-2 border-b-2 border-indigo-600 text-indigo-600 font-semibold flex items-center gap-2 whitespace-nowrap"
          : "tab-btn px-4 py-2 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-2 whitespace-nowrap";
      }
    });
    if (tab === 'analytics') renderAnalytics();
  } catch (err) {
    console.error("Tab switch non-fatal:", err);
  }
}

function parseDateToISO(raw) {
  if (!raw) return '';
  var str = String(raw).replace(/^'+/, '').trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  if (str.includes('/')) {
    var p = str.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
      if (p[0].length === 4) return p[0] + '-' + p[1].padStart(2, '0') + '-' + p[2].padStart(2, '0');
    }
  }

  var parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    var d = new Date(parsed);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  return str.split('T')[0];
}

function sortExpensesDescending() {
  expenses.sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });
}

document.addEventListener("DOMContentLoaded", function() {
  var todayISO = new Date().toISOString().split('T')[0];
  ['expDate', 'pkgDate'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = todayISO;
  });

  try { expenses = JSON.parse(localStorage.getItem("expenses") || "[]"); } catch(e){}
  try { packages = JSON.parse(localStorage.getItem("packages") || "[]"); } catch(e){}
  try { vouchers = JSON.parse(localStorage.getItem("vouchers") || "[]"); } catch(e){}
  try { cards = JSON.parse(localStorage.getItem("cards") || "[]"); } catch(e){}

  sortExpensesDescending();
  populateCardDropdown();
  renderCardsTable();
  updateMonthFilterOptions();
  renderExpenses();
  renderPackages();
  renderVouchers();

  fetchAll();
});

function fetchAll() {
  fetchLiveRates();
  fetchCards();
  fetchExpenses();
  fetchPackages();
  fetchVouchers();
}

async function fetchLiveRates() {
  try {
    var res = await fetch("https://open.er-api.com/v6/latest/ILS");
    var data = await res.json();
    if (data && data.rates) {
      RATES.USD = parseFloat((1 / data.rates.USD).toFixed(3));
      RATES.EUR = parseFloat((1 / data.rates.EUR).toFixed(3));
      var u = document.getElementById("fxUsdRate");
      var e = document.getElementById("fxEurRate");
      if (u) u.textContent = RATES.USD.toFixed(2);
      if (e) e.textContent = RATES.EUR.toFixed(2);
      var b = document.getElementById("fxBadge");
      if (b) { b.textContent = "Live"; b.className = "text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded"; }
      updatePackageConversionPreview();
      renderPackages();
    }
  } catch (err) {
    console.warn("FX rate fallback:", err);
  }
}

/* ------------------- CARDS ------------------- */
async function fetchCards() {
  try {
    var res = await fetch(SCRIPT_URL + "?sheet=Cards&t=" + Date.now());
    var data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      cards = data.map(function(item, idx) {
        return {
          id: String(item.id || ('c_' + idx)),
          nickname: String(item.nickname || item.Nickname || item.name || ('Card ' + (idx + 1))).trim(),
          issuer: String(item.issuer || item.Issuer || '-').trim(),
          billingCycleDay: String(item.billingCycleDay || item.BillingCycleDay || item.day || '-').trim()
        };
      });
      localStorage.setItem("cards", JSON.stringify(cards));
    }
  } catch (e) {
    cards = JSON.parse(localStorage.getItem("cards") || "[]");
  }
  populateCardDropdown();
  renderCardsTable();
}

function populateCardDropdown() {
  var select = document.getElementById("expCard");
  if (!select) return;
  var currentSelected = select.value;
  var list = cards.length ? cards : [{ nickname: "Default Card" }];
  select.innerHTML = list.map(function(c) {
    return '<option value="' + c.nickname + '">' + c.nickname + '</option>';
  }).join('');
  if (currentSelected && list.some(function(c) { return c.nickname === currentSelected; })) {
    select.value = currentSelected;
  }
}

function renderCardsTable() {
  var tbody = document.getElementById("cardsTableBody");
  if (!tbody) return;
  if (!cards.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">No cards registered yet. Add one above.</td></tr>';
    return;
  }
  tbody.innerHTML = cards.map(function(c, i) {
    return '<tr class="hover:bg-slate-50 border-b border-slate-100">' +
      '<td class="p-2.5 font-medium text-slate-900">' + c.nickname + '</td>' +
      '<td class="p-2.5 text-slate-600">' + c.issuer + '</td>' +
      '<td class="p-2.5 text-slate-500">' + c.billingCycleDay + '</td>' +
      '<td class="p-2.5 text-center">' +
        '<button onclick="deleteCard(\'' + (c.id || i) + '\')" class="text-rose-500 hover:text-rose-700 text-xs px-2 py-0.5"><i class="fa-solid fa-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function handleNewCard(e) {
  if (e) e.preventDefault();
  var nickname = document.getElementById("cardNickname").value.trim();
  var issuer = document.getElementById("cardIssuer").value.trim();
  var day = document.getElementById("cardBillingDay").value.trim();
  if (!nickname) return;

  var card = { id: "c_" + Date.now(), nickname: nickname, issuer: issuer, billingCycleDay: day };
  cards.push(card);
  localStorage.setItem("cards", JSON.stringify(cards));
  populateCardDropdown();
  renderCardsTable();

  document.getElementById("cardNickname").value = "";
  document.getElementById("cardIssuer").value = "";
  document.getElementById("cardBillingDay").value = "";

  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: "add", sheet: "Cards", data: card })
  });
}

function deleteCard(id) {
  cards = cards.filter(function(c, i) { return String(c.id || i) !== String(id); });
  localStorage.setItem("cards", JSON.stringify(cards));
  populateCardDropdown();
  renderCardsTable();
  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: "delete", sheet: "Cards", id: id })
  });
}

/* ------------------- EXPENSES ------------------- */
async function fetchExpenses() {
  setSyncStatus("Loading...", "amber");
  try {
    var res = await fetch(SCRIPT_URL + "?sheet=Expenses&t=" + Date.now());
    var rawData = await res.json();
    if (Array.isArray(rawData)) {
      expenses = rawData.map(function(item, idx) {
        var desc = item.description || item.Description || item.item || 'Expense';
        var amount = parseFloat(item.amount || item.Amount || 0);
        var currency = item.currency || item.Currency || 'ILS';
        var rate = getRateToILS(currency);
        var ilsVal = parseFloat(item.ilsAmount || item.IlsAmount || item.ILS || 0);
        if (isNaN(ilsVal) || ilsVal === 0 || (currency !== 'ILS' && ilsVal === amount)) {
          ilsVal = parseFloat((amount * rate).toFixed(2));
        }
        var isRec = String(item.isRecurring || item.IsRecurring || '').toLowerCase() === 'yes' || Boolean(item.isRecurring === true);

        return {
          id: String(item.id || item.ID || ('exp_' + idx)),
          date: parseDateToISO(item.date || item.Date),
          description: String(desc),
          amount: isNaN(amount) ? 0 : amount,
          currency: String(currency),
          ilsAmount: isNaN(ilsVal) ? (amount || 0) : ilsVal,
          category: String(item.category || item.Category || 'General'),
          card: String(item.card || item.Card || 'Default Card'),
          paymentMethod: String(item.paymentMethod || item.PaymentMethod || 'Credit Card'),
          isRecurring: isRec
        };
      });
      sortExpensesDescending();
      localStorage.setItem("expenses", JSON.stringify(expenses));
      setSyncStatus("Cloud Synced", "emerald");
    }
  } catch (err) {
    expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
    sortExpensesDescending();
    setSyncStatus("Cached / Offline", "slate");
  }

  updateMonthFilterOptions();
  renderExpenses();
  renderAnalytics();
}

function updateMonthFilterOptions() {
  var select = document.getElementById("monthFilter");
  if (!select) return;
  var current = select.value;
  var months = new Set();
  expenses.forEach(function(item) {
    if (item.date && item.date.length >= 7) months.add(item.date.substring(0, 7));
  });
  var html = '<option value="ALL">All Time</option>';
  Array.from(months).sort().reverse().forEach(function(m) {
    html += '<option value="' + m + '">' + m + '</option>';
  });
  select.innerHTML = html;
  if (current && html.includes('value="' + current + '"')) select.value = current;
}

function renderExpenses() {
  var tbody = document.getElementById("expensesTableBody");
  if (!tbody) return;
  var monthSelect = document.getElementById("monthFilter");
  var selectedMonth = monthSelect ? monthSelect.value : "ALL";
  var badge = document.getElementById("monthSummaryBadge");

  var filtered = expenses;
  if (selectedMonth !== "ALL") {
    filtered = expenses.filter(function(item) {
      return item.date && item.date.startsWith(selectedMonth);
    });
  }

  if (badge) badge.textContent = 'Showing ' + filtered.length + ' entries (Sorted newest first)';

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">No transactions found.</td></tr>';
    document.getElementById("totalSpend").textContent = "₪0.00";
    document.getElementById("txCount").textContent = "0";
    return;
  }

  var totalIls = 0;
  tbody.innerHTML = filtered.map(function(item) {
    var ils = parseFloat(item.ilsAmount) || 0;
    totalIls += ils;
    var sym = item.currency === 'USD' ? '$' : item.currency === 'EUR' ? '€' : '₪';

    return '<tr class="hover:bg-slate-50 border-b border-slate-100 ' + (item.isRecurring ? 'bg-indigo-50/30' : '') + '">' +
      '<td class="p-3 text-slate-500 whitespace-nowrap font-mono text-xs">' + (item.date || '-') + '</td>' +
      '<td class="p-3 font-medium text-slate-900">' +
        '<div class="flex items-center gap-1.5 flex-wrap">' +
          '<span>' + item.description + '</span>' +
          (item.isRecurring ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700"><i class="fa-solid fa-repeat"></i> Monthly</span>' : '') +
        '</div>' +
      '</td>' +
      '<td class="p-3"><span class="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700">' + item.card + '</span></td>' +
      '<td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">' + item.category + '</span></td>' +
      '<td class="p-3 text-right font-medium">' + sym + Number(item.amount).toFixed(2) + '</td>' +
      '<td class="p-3 text-right font-semibold text-slate-900">₪' + ils.toFixed(2) + '</td>' +
      '<td class="p-3 text-center whitespace-nowrap">' +
        '<button onclick="startExpenseEdit(\'' + item.id + '\')" class="text-indigo-600 px-1.5 py-1 text-xs"><i class="fa-solid fa-pen"></i></button> ' +
        '<button onclick="deleteExpense(\'' + item.id + '\')" class="text-rose-500 px-1.5 py-1 text-xs"><i class="fa-solid fa-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).join('');

  document.getElementById("totalSpend").textContent = '₪' + totalIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById("txCount").textContent = filtered.length;
}

function handleExpenseSubmit(e) {
  if (e) e.preventDefault();
  var desc = document.getElementById("expDesc").value.trim();
  var rawAmount = parseFloat(document.getElementById("expAmount").value) || 0;
  if (!desc || rawAmount <= 0) return alert("Please enter description and amount");

  var rawDate = document.getElementById("expDate").value || new Date().toISOString().split('T')[0];
  var date = parseDateToISO(rawDate);
  var currency = document.getElementById("expCurrency").value;
  var category = document.getElementById("expCategory").value;
  var card = document.getElementById("expCard").value;
  var method = document.getElementById("expMethod").value;
  var isRecurring = document.getElementById("expIsRecurring").checked;
  var editId = document.getElementById("editExpId").value.trim();
  var isEditing = Boolean(editId);

  var rate = getRateToILS(currency);
  var ilsAmount = parseFloat((rawAmount * rate).toFixed(2));
  var targetId = isEditing ? editId : ("exp_" + Date.now());

  var payload = {
    id: targetId,
    date: date,
    description: desc,
    amount: rawAmount,
    currency: currency,
    ilsAmount: ilsAmount,
    category: category,
    card: card,
    paymentMethod: method,
    isRecurring: isRecurring ? "Yes" : "No"
  };

  if (isEditing) {
    expenses = expenses.map(function(x) {
      return String(x.id) === String(editId) ? Object.assign({}, payload, { isRecurring: isRecurring }) : x;
    });
  } else {
    expenses.unshift(Object.assign({}, payload, { isRecurring: isRecurring }));
  }

  sortExpensesDescending();
  localStorage.setItem("expenses", JSON.stringify(expenses));
  updateMonthFilterOptions();
  renderExpenses();
  renderAnalytics();
  cancelExpenseEdit();

  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: isEditing ? "update" : "add", sheet: "Expenses", id: editId || undefined, data: payload })
  });
}

function startExpenseEdit(id) {
  var exp = expenses.find(function(x) { return String(x.id) === String(id); });
  if (!exp) return;
  document.getElementById("editExpId").value = exp.id;
  document.getElementById("expDate").value = parseDateToISO(exp.date);
  document.getElementById("expDesc").
