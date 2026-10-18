// Connected Backend Google Apps Script Web App URL
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyum6T_l__A43wHTS7epcJoeWhaOHIjdAFFTA2aNeCpQt568WiZuLFhXeoLdeF6h5K1/exec";

const RATES = { ILS: 1, USD: 3.70, EUR: 4.00 };

function getRateToILS(currency) {
  if (!currency) return 1;
  const clean = String(currency).trim().toUpperCase();
  if (clean === 'ILS') return 1;
  if (typeof RATES !== 'undefined' && RATES[clean]) return parseFloat(RATES[clean]);
  if (clean === 'USD') return 3.70;
  if (clean === 'EUR') return 4.00;
  return 1;
}

let expenses = [];
let packages = [];
let vouchers = [];
let cards = [];
let trendChartInstance = null;
let packagesChartInstance = null;
let categoryChartInstance = null;
let cardChartInstance = null;
let deferredPrompt = null;

function switchTab(tab) {
  try {
    const tabs = ['expenses', 'analytics', 'packages', 'vouchers', 'settings'];
    tabs.forEach(t => {
      const view = document.getElementById(`view-${t}`);
      const btn = document.getElementById(`tab-${t}`);
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
  let str = String(raw).replace(/^'+/, '').trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  if (str.includes('/')) {
    const p = str.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
      if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    }
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return str.split('T')[0];
}

function sortExpensesDescending() {
  expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

document.addEventListener("DOMContentLoaded", () => {
  const todayISO = new Date().toISOString().split('T')[0];
  ['expDate', 'pkgDate', 'voucherExpiry'].forEach(id => {
    const el = document.getElementById(id);
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
    const res = await fetch("https://open.er-api.com/v6/latest/ILS");
    const data = await res.json();
    if (data && data.rates) {
      RATES.USD = parseFloat((1 / data.rates.USD).toFixed(3));
      RATES.EUR = parseFloat((1 / data.rates.EUR).toFixed(3));
      const u = document.getElementById("fxUsdRate");
      const e = document.getElementById("fxEurRate");
      if (u) u.textContent = RATES.USD.toFixed(2);
      if (e) e.textContent = RATES.EUR.toFixed(2);
      const b = document.getElementById("fxBadge");
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
    const res = await fetch(`${SCRIPT_URL}?sheet=Cards&t=${Date.now()}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      cards = data.map((item, idx) => ({
        id: String(item.id || `c_${idx}`),
        nickname: String(item.nickname || item.Nickname || item.name || `Card ${idx + 1}`).trim(),
        issuer: String(item.issuer || item.Issuer || '-').trim(),
        billingCycleDay: String(item.billingCycleDay || item.BillingCycleDay || item.day || '-').trim()
      }));
      localStorage.setItem("cards", JSON.stringify(cards));
    }
  } catch (e) {
    cards = JSON.parse(localStorage.getItem("cards") || "[]");
  }
  populateCardDropdown();
  renderCardsTable();
}

function populateCardDropdown() {
  const select = document.getElementById("expCard");
  if (!select) return;
  const currentSelected = select.value;
  const list = cards.length ? cards : [{ nickname: "Default Card" }];
  select.innerHTML = list.map(c => `<option value="${c.nickname}">${c.nickname}</option>`).join('');
  if (currentSelected && list.some(c => c.nickname === currentSelected)) {
    select.value = currentSelected;
  }
}

function renderCardsTable() {
  const tbody = document.getElementById("cardsTableBody");
  if (!tbody) return;
  if (!cards.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">No cards registered yet. Add one above.</td></tr>`;
    return;
  }
  tbody.innerHTML = cards.map((c, i) => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="p-2.5 font-medium text-slate-900">${c.nickname}</td>
      <td class="p-2.5 text-slate-600">${c.issuer}</td>
      <td class="p-2.5 text-slate-500">${c.billingCycleDay}</td>
      <td class="p-2.5 text-center">
        <button onclick="deleteCard('${c.id || i}')" class="text-rose-500 hover:text-rose-700 text-xs px-2 py-0.5"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function handleNewCard(e) {
  if (e) e.preventDefault();
  const nickname = document.getElementById("cardNickname").value.trim();
  const issuer = document.getElementById("cardIssuer").value.trim();
  const day = document.getElementById("cardBillingDay").value.trim();
  if (!nickname) return;

  const card = { id: "c_" + Date.now(), nickname, issuer, billingCycleDay: day };
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
  cards = cards.filter((c, i) => String(c.id || i) !== String(id));
  localStorage.setItem("cards", JSON.stringify(cards));
  populateCardDropdown();
  renderCardsTable();
  fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "delete", sheet: "Cards", id: id }) });
}

/* ------------------- EXPENSES ------------------- */
async function fetchExpenses() {
  setSyncStatus("Loading...", "amber");
  try {
    const res = await fetch(`${SCRIPT_URL}?sheet=Expenses&t=${Date.now()}`);
    const rawData = await res.json();
    if (Array.isArray(rawData)) {
      expenses = rawData.map((item, idx) => {
        const desc = item.description || item.Description || item.item || 'Expense';
        const amount = parseFloat(item.amount || item.Amount || 0);
        const currency = item.currency || item.Currency || 'ILS';
        const rate = getRateToILS(currency);
        let ilsVal = parseFloat(item.ilsAmount || item.IlsAmount || item.ILS || 0);
        if (isNaN(ilsVal) || ilsVal === 0 || (currency !== 'ILS' && ilsVal === amount)) {
          ilsVal = parseFloat((amount * rate).toFixed(2));
        }
        const isRec = String(item.isRecurring || item.IsRecurring || '').toLowerCase() === 'yes' || Boolean(item.isRecurring === true);

        return {
          id: String(item.id || item.ID || `exp_${idx}`),
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
  const select = document.getElementById("monthFilter");
  if (!select) return;
  const current = select.value;
  const months = new Set();
  expenses.forEach(item => {
    if (item.date && item.date.length >= 7) months.add(item.date.substring(0, 7));
  });
  let html = `<option value="ALL">All Time</option>`;
  Array.from(months).sort().reverse().forEach(m => {
    html += `<option value="${m}">${m}</option>`;
  });
  select.innerHTML = html;
  if (current && html.includes(`value="${current}"`)) select.value = current;
}

function renderExpenses() {
  const tbody = document.getElementById("expensesTableBody");
  if (!tbody) return;
  const monthSelect = document.getElementById("monthFilter");
  const selectedMonth = monthSelect ? monthSelect.value : "ALL";
  const badge = document.getElementById("monthSummaryBadge");

  let filtered = expenses;
  if (selectedMonth !== "ALL") {
    filtered = expenses.filter(item => item.date && item.date.startsWith(selectedMonth));
  }

  if (badge) badge.textContent = `Showing ${filtered.length} entries (Sorted newest first)`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">No transactions found.</td></tr>`;
    document.getElementById("totalSpend").textContent = "₪0.00";
    document.getElementById("txCount").textContent = "0";
    return;
  }

  let totalIls = 0;
  tbody.innerHTML = filtered.map(item => {
    const ils = parseFloat(item.ilsAmount) || 0;
    totalIls += ils;
    const sym = item.currency === 'USD' ? '$' : item.currency === 'EUR' ? '€' : '₪';

    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 ${item.isRecurring ? 'bg-indigo-50/30' : ''}">
        <td class="p-3 text-slate-500 whitespace-nowrap font-mono text-xs">${item.date || '-'}</td>
        <td class="p-3 font-medium text-slate-900">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span>${item.description}</span>
            ${item.isRecurring ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700"><i class="fa-solid fa-repeat"></i> Monthly</span>` : ''}
          </div>
        </td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700">${item.card}</span></td>
        <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">${item.category}</span></td>
        <td class="p-3 text-right font-medium">${sym}${Number(item.amount).toFixed(2)}</td>
        <td class="p-3 text-right font-semibold text-slate-900">₪${ils.toFixed(2)}</td>
        <td class="p-3 text-center whitespace-nowrap">
          <button onclick="startExpenseEdit('${item.id}')" class="text-indigo-600 px-1.5 py-1 text-xs"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deleteExpense('${item.id}')" class="text-rose-500 px-1.5 py-1 text-xs"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById("totalSpend").textContent = `₪${totalIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("txCount").textContent = filtered.length;
}

function handleExpenseSubmit(e) {
  if (e) e.preventDefault();
  const desc = document.getElementById("expDesc").value.trim();
  const rawAmount = parseFloat(document.getElementById("expAmount").value) || 0;
  if (!desc || rawAmount <= 0) return alert("Please enter description and amount");

  const rawDate = document.getElementById("expDate").value || new Date().toISOString().split('T')[0];
  const date = parseDateToISO(rawDate);
  const currency = document.getElementById("expCurrency").value;
  const category = document.getElementById("expCategory").value;
  const card = document.getElementById("expCard").value;
  const method = document.getElementById("expMethod").value;
  const isRecurring = document.getElementById("expIsRecurring").checked;
  const editId = document.getElementById("editExpId").value.trim();
  const isEditing = Boolean(editId);

  const rate = getRateToILS(currency);
  const ilsAmount = parseFloat((rawAmount * rate).toFixed(2));
  const targetId = isEditing ? editId : ("exp_" + Date.now());

  const payload = {
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
    expenses = expenses.map(x => String(x.id) === String(editId) ? { ...payload, isRecurring } : x);
  } else {
    expenses.unshift({ ...payload, isRecurring });
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
  const exp = expenses.find(x => String(x.id) === String(id));
  if (!exp) return;
  document.getElementById("editExpId").value = exp.id;
  document.getElementById("expDate").value = parseDateToISO(exp.date);
  document.getElementById("expDesc").value = exp.description;
  document.getElementById("expAmount").value = exp.amount;
  document.getElementById("expCurrency").value = exp.currency;
  document.getElementById("expCategory").value = exp.category;
  document.getElementById("expCard").value = exp.card;
  document.getElementById("expMethod").value = exp.paymentMethod;
  document.getElementById("expIsRecurring").checked = Boolean(exp.isRecurring);

  document.getElementById("formHeader").innerHTML = `<i class="fa-solid fa-pen text-amber-500"></i> Edit Expense`;
  document.getElementById("expSubmitText").textContent = "Update Expense";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelExpenseEdit() {
  document.getElementById("editExpId").value = "";
  document.getElementById("expDesc").value = "";
  document.getElementById("expAmount").value = "";
  const d = document.getElementById("expDate");
  if (d) d.value = new Date().toISOString().split('T')[0];
  document.getElementById("expIsRecurring").checked = false;
  document.getElementById("formHeader").innerHTML = `<i class="fa-solid fa-plus-circle text-indigo-500"></i> Add New Expense`;
  document.getElementById("expSubmitText").textContent = "Save Expense";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

function deleteExpense(id) {
  if (!confirm("Delete this expense?")) return;
  expenses = expenses.filter(x => String(x.id) !== String(id));
  localStorage.setItem("expenses", JSON.stringify(expenses));
  renderExpenses();
  renderAnalytics();
  fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "delete", sheet: "Expenses", id: id }) });
}

/* ------------------- ANALYTICS ------------------- */
function renderAnalytics() {
  try {
    const monthSelect = document.getElementById("monthFilter");
    const selectedMonth = monthSelect ? monthSelect.value : "ALL";
    const filteredExp = (selectedMonth !== "ALL") ? expenses.filter(i => i.date && i.date.startsWith(selectedMonth)) : expenses;
    const filteredPkg = (selectedMonth !== "ALL") ? packages.filter(i => i.date && i.date.startsWith(selectedMonth)) : packages;

    let totalIls = 0;
    let recurringIls = 0;
    const catTotals = {};
    const cardTotals = {};

    filteredExp.forEach(item => {
      const val = parseFloat(item.ilsAmount) || 0;
      totalIls += val;
      if (item.isRecurring === true || String(item.isRecurring).toLowerCase() === 'yes') recurringIls += val;
      catTotals[item.category] = (catTotals[item.category] || 0) + val;
      cardTotals[item.card] = (cardTotals[item.card] || 0) + val;
    });

    let pkgSpendIls = 0;
    filteredPkg.forEach(p => {
      pkgSpendIls += parseFloat(p.totalCostIls) || 0;
    });

    const setEl = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setEl("statTotalSpend", `₪${totalIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setEl("statRecurringSpend", `₪${recurringIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setEl("statPackagesSpend", `₪${pkgSpendIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    let topCard = "-", topCardVal = 0;
    for (const [k, v] of Object.entries(cardTotals)) {
      if (v > topCardVal) { topCardVal = v; topCard = k; }
    }
    setEl("statTopCard", topCardVal > 0 ? `${topCard} (₪${topCardVal.toFixed(0)})` : "-");

    buildCharts(catTotals, cardTotals);
  } catch (err) {
    console.warn("Analytics error:", err);
  }
}

function buildCharts(catTotals, cardTotals) {
  if (typeof Chart === 'undefined') return;

  const monthlyStandard = {};
  const monthlyRecurring = {};
  const allMonthsSet = new Set();

  expenses.forEach(item => {
    if (item.date && item.date.length >= 7) {
      const ym = item.date.substring(0, 7);
      allMonthsSet.add(ym);
      const val = parseFloat(item.ilsAmount) || 0;
      const isRec = item.isRecurring === true || String(item.isRecurring).toLowerCase() === 'yes';
      if (isRec) monthlyRecurring[ym] = (monthlyRecurring[ym] || 0) + val;
      else monthlyStandard[ym] = (monthlyStandard[ym] || 0) + val;
    }
  });

  const mLabels = Array.from(allMonthsSet).sort();
  const standardData = mLabels.map(m => monthlyStandard[m] || 0);
  const recurringData = mLabels.map(m => monthlyRecurring[m] || 0);

  const mCanvas = document.getElementById("monthlyTrendChart");
  if (mCanvas) {
    if (trendChartInstance) trendChartInstance.destroy();
    trendChartInstance = new Chart(mCanvas.getContext("2d"), {
      type: 'bar',
      data: {
        labels: mLabels,
        datasets: [
          { label: 'Standard', data: standardData, backgroundColor: '#6366f1', borderRadius: 4 },
          { label: 'Recurring', data: recurringData, backgroundColor: '#10b981', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
      }
    });
  }

  const pkgMonthly = {};
  packages.forEach(pkg => {
    if (pkg.date && pkg.date.length >= 7) {
      const ym = pkg.date.substring(0, 7);
      pkgMonthly[ym] = (pkgMonthly[ym] || 0) + (parseFloat(pkg.totalCostIls) || 0);
    }
  });

  const pkgLabels = Object.keys(pkgMonthly).sort();
  const pkgPoints = pkgLabels.map(m => pkgMonthly[m]);
  const pkgCanvas = document.getElementById("packagesTrendChart");
  if (pkgCanvas) {
    if (packagesChartInstance) packagesChartInstance.destroy();
    packagesChartInstance = new Chart(pkgCanvas.getContext("2d"), {
      type: 'bar',
      data: {
        labels: pkgLabels.length ? pkgLabels : ['No Data'],
        datasets: [{ label: 'Packages Spend', data: pkgLabels.length ? pkgPoints : [0], backgroundColor: '#0284c7', borderRadius: 6 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  const catCanvas = document.getElementById("categoryChart");
  if (catCanvas) {
    if (categoryChartInstance) categoryChartInstance.destroy();
    categoryChartInstance = new Chart(catCanvas.getContext("2d"), {
      type: 'doughnut',
      data: {
        labels: Object.keys(catTotals),
        datasets: [{ data: Object.values(catTotals), backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#06b6d4', '#3b82f6', '#8b5cf6', '#14b8a6', '#64748b'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  const cardCanvas = document.getElementById("cardChart");
  if (cardCanvas) {
    if (cardChartInstance) cardChartInstance.destroy();
    cardChartInstance = new Chart(cardCanvas.getContext("2d"), {
      type: 'doughnut',
      data: {
        labels: Object.keys(cardTotals),
        datasets: [{ data: Object.values(cardTotals), backgroundColor: ['#0ea5e9', '#6366f1', '#f43f5e', '#eab308', '#84cc16'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }
}

/* ------------------- PACKAGES & EXPENSE SYNC ------------------- */
function toggleReceivedCheck(checked) {
  const box = document.getElementById("receivedDateBox");
  const dateEl = document.getElementById("pkgReceivedDate");
  const statusEl = document.getElementById("pkgStatus");
  if (checked) {
    if (box) box.classList.remove("hidden");
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
    if (statusEl) statusEl.value = "Delivered";
  } else {
    if (box) box.classList.add("hidden");
    if (dateEl) dateEl.value = "";
  }
}

function handleStatusChange(val) {
  const chk = document.getElementById("pkgIsReceived");
  if (chk) {
    if (val === "Delivered") { chk.checked = true; toggleReceivedCheck(true); }
    else if (chk.checked) { chk.checked = false; toggleReceivedCheck(false); }
  }
}

function updatePackageConversionPreview() {
  const cost = parseFloat(document.getElementById("pkgCost")?.value) || 0;
  const curr = document.getElementById("pkgCurrency")?.value || "USD";
  const ship = parseFloat(document.getElementById("pkgShippingFee")?.value) || 0;
  const shipCurr = document.getElementById("pkgShippingCurrency")?.value || "USD";

  const itemIls = cost * getRateToILS(curr);
  const shipIls = ship * getRateToILS(shipCurr);

  const itemPrev = document.getElementById("itemCostIlsPreview");
  const shipPrev = document.getElementById("shipFeeIlsPreview");
  if (itemPrev) itemPrev.textContent = `≈ ₪${itemIls.toFixed(2)}`;
  if (shipPrev) shipPrev.textContent = `≈ ₪${shipIls.toFixed(2)}`;
}

function syncLinkedExpense(expId, date, desc, amount, currency) {
  try {
    if (!amount || amount <= 0) return;
    const rate = getRateToILS(currency);
    const ilsAmount = parseFloat((amount * rate).toFixed(2));
    
    const payload = {
      id: expId,
      date: date,
      description: desc,
      amount: amount,
      currency: currency,
      ilsAmount: ilsAmount,
      category: "Shopping",
      card: "Default Card",
      paymentMethod: "Credit Card",
      isRecurring: false
    };

    const existingIdx = expenses.findIndex(x => String(x.id) === String(expId));
    if (existingIdx !== -1) expenses[existingIdx] = payload;
    else expenses.unshift(payload);

    sortExpensesDescending();
    localStorage.setItem("expenses", JSON.stringify(expenses));
    renderExpenses();

    fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify({
        action: existingIdx !== -1 ? "update" : "add",
        sheet: "Expenses",
        id: existingIdx !== -1 ? expId : undefined,
        data: { ...payload, isRecurring: "No" }
      })
    }).catch(e => console.warn(e));
  } catch (err) {
    console.error("Expense sync error:", err);
  }
}

async function fetchPackages() {
  try {
    const res = await fetch(`${SCRIPT_URL}?sheet=Packages&t=${Date.now()}`);
    const rawData = await res.json();
    if (Array.isArray(rawData)) {
      packages = rawData.map((item, idx) => {
        const itemCost = parseFloat(item.itemCost || item.ItemCost || 0) || 0;
        const curr = String(item.currency || item.Currency || 'USD').trim().toUpperCase();
        const shipFee = parseFloat(item.shippingFee !== undefined ? item.shippingFee : (item.shippingFeeIls || 0)) || 0;
        const shipCurr = String(item.shippingCurrency || item.ShippingCurrency || 'USD').trim().toUpperCase();

        const trueLandedIls = parseFloat((itemCost * getRateToILS(curr) + shipFee * getRateToILS(shipCurr)).toFixed(2));
        let storedIls = parseFloat(item.totalCostIls || item.TotalCostIls || 0);

        if (isNaN(storedIls) || storedIls <= 0 || (curr !== 'ILS' && Math.abs(storedIls - (itemCost + shipFee)) < 0.05)) {
          storedIls = trueLandedIls;
        }

        return {
          id: String(item.id || item.ID || `pkg_${idx}`),
          date: parseDateToISO(item.date || item.Date || item.purchaseDate || item.PurchaseDate),
          shop: String(item.shop || item.Shop || item.store || item.Store || '-'),
          itemDescription: String(item.itemDescription || item.ItemDescription || item.item || item.description || 'Package'),
          trackingNumber: String(item.trackingNumber || item.TrackingNumber || item.tracking || ''),
          forwarder: String(item.forwarder || item.Forwarder || 'RedBox'),
          status: String(item.status || item.Status || 'Ordered'),
          isReceived: String(item.isReceived || item.received || '').toLowerCase() === 'true' || item.status === 'Delivered',
          receivedDate: parseDateToISO(item.receivedDate || item.ReceivedDate || ''),
          itemCost: itemCost,
          currency: curr,
          shippingFee: shipFee,
          shippingCurrency: shipCurr,
          totalCostIls: storedIls
        };
      });
      localStorage.setItem("packages", JSON.stringify(packages));
    }
  } catch (err) {
    packages = JSON.parse(localStorage.getItem("packages") || "[]");
  }
  renderPackages();
}

function renderPackages() {
  const tbody = document.getElementById("packagesTableBody");
  if (!tbody) return;
  if (!packages.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-400">No active packages.</td></tr>`;
    return;
  }
  tbody.innerHTML = packages.map(pkg => {
    const isUSD = pkg.currency === 'USD';
    const isShipUSD = pkg.shippingCurrency === 'USD';
    const dynamicTotalIls = (pkg.currency !== 'ILS' || pkg.shippingCurrency !== 'ILS')
      ? (pkg.itemCost * getRateToILS(pkg.currency) + pkg.shippingFee * getRateToILS(pkg.shippingCurrency))
      : (parseFloat(pkg.totalCostIls) || 0);

    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 ${pkg.isReceived ? 'bg-emerald-50/20' : ''}">
        <td class="p-3 text-center">
          <input type="checkbox" ${pkg.isReceived ? 'checked' : ''} onchange="quickToggleReceived('${pkg.id}', this.checked)" class="w-4 h-4 text-emerald-600 rounded cursor-pointer border-slate-300 focus:ring-emerald-500" />
        </td>
        <td class="p-3 text-slate-500 whitespace-nowrap font-mono text-xs">${pkg.date || '-'}</td>
        <td class="p-3 font-medium text-slate-700 whitespace-nowrap">${pkg.shop || '-'}</td>
        <td class="p-3 font-medium text-slate-900">${pkg.itemDescription}</td>
        <td class="p-3">
          <span class="font-mono text-slate-700 block">${pkg.trackingNumber}</span>
          <span class="text-[11px] font-semibold text-indigo-600">${pkg.forwarder}</span>
        </td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-xs font-medium ${pkg.isReceived ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100'}">
            ${pkg.status}
          </span>
          ${pkg.receivedDate ? `<span class="block text-[11px] text-slate-500 mt-0.5 font-mono">Recv: ${pkg.receivedDate}</span>` : ''}
        </td>
        <td class="p-3 text-right font-medium">${isUSD ? '$' : '₪'}${Number(pkg.itemCost || 0).toFixed(2)}</td>
        <td class="p-3 text-right font-medium">${isShipUSD ? '$' : '₪'}${Number(pkg.shippingFee || 0).toFixed(2)}</td>
        <td class="p-3 text-right font-semibold text-slate-900">₪${Number(dynamicTotalIls).toFixed(2)}</td>
        <td class="p-3 text-center whitespace-nowrap">
          <button onclick="startPackageEdit('${pkg.id}')" class="text-indigo-600 px-1 py-1 text-xs"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deletePackage('${pkg.id}')" class="text-rose-500 px-1 py-1 text-xs"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

function quickToggleReceived(id, isReceived) {
  const pkg = packages.find(x => String(x.id) === String(id));
  if (!pkg) return;
  pkg.isReceived = isReceived;
  pkg.status = isReceived ? "Delivered" : "In Transit to IL";
  pkg.receivedDate = isReceived ? new Date().toISOString().split('T')[0] : "";
  localStorage.setItem("packages", JSON.stringify(packages));
  renderPackages();
  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: "update", sheet: "Packages", id: pkg.id, data: pkg })
  });
}

function handlePackageSubmit(e) {
  if (e) e.preventDefault();
  const desc = document.getElementById("pkgDesc").value.trim();
  if (!desc) return alert("Enter item description");

  const rawDate = document.getElementById("pkgDate").value || new Date().toISOString().split('T')[0];
  const date = parseDateToISO(rawDate);
  const shop = document.getElementById("pkgShop").value.trim();
  const tracking = document.getElementById("pkgTracking").value.trim();
  const forwarder = document.getElementById("pkgForwarder").value;
  const cost = parseFloat(document.getElementById("pkgCost").value) || 0;
  const currency = document.getElementById("pkgCurrency").value;
  const shippingFee = parseFloat(document.getElementById("pkgShippingFee").value) || 0;
  const shippingCurrency = document.getElementById("pkgShippingCurrency").value;
  let status = document.getElementById("pkgStatus").value;
  const isReceived = document.getElementById("pkgIsReceived").checked;
  const receivedDate = isReceived ? (document.getElementById("pkgReceivedDate").value || new Date().toISOString().split('T')[0]) : "";

  if (isReceived) status = "Delivered";

  const editId = document.getElementById("editPkgId").value.trim();
  const isEditing = Boolean(editId);
  const targetId = isEditing ? editId : ("pkg_" + Date.now());

  const itemIls = cost * getRateToILS(currency);
  const shipIls = shippingFee * getRateToILS(shippingCurrency);
  const totalCostIls = parseFloat((itemIls + shipIls).toFixed(2));

  const itemExpId = `${targetId}_item`;
  const shippingExpId = `${targetId}_ship`;

  if (cost > 0) syncLinkedExpense(itemExpId, date, shop ? `[${shop}] ${desc}` : desc, cost, currency);
  if (shippingFee > 0) syncLinkedExpense(shippingExpId, date, `Shipping: ${desc} (${forwarder})`, shippingFee, shippingCurrency);

  const payload = {
    id: targetId,
    date: date,
    purchaseDate: date,
    shop: shop,
    itemDescription: desc,
    trackingNumber: tracking,
    forwarder: forwarder,
    status: status,
    isReceived: isReceived,
    receivedDate: receivedDate,
    itemCost: cost,
    currency: currency,
    shippingFee: shippingFee,
    shippingCurrency: shippingCurrency,
    totalCostIls: totalCostIls
  };

  if (isEditing) packages = packages.map(x => String(x.id) === String(editId) ? payload : x);
  else packages.unshift(payload);

  localStorage.setItem("packages", JSON.stringify(packages));
  renderPackages();
  cancelPackageEdit();

  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: isEditing ? "update" : "add", sheet: "Packages", id: editId || undefined, data: payload })
  });
}

function startPackageEdit(id) {
  const pkg = packages.find(x => String(x.id) === String(id));
  if (!pkg) return;
  document.getElementById("editPkgId").value = pkg.id;
  document.getElementById("pkgDate").value = parseDateToISO(pkg.date);
  document.getElementById("pkgShop").value = pkg.shop === '-' ? '' : (pkg.shop || '');
  document.getElementById("pkgDesc").value = pkg.itemDescription;
  document.getElementById("pkgTracking").value = pkg.trackingNumber;
  document.getElementById("pkgForwarder").value = pkg.forwarder;
  document.getElementById("pkgCost").value = pkg.itemCost;
  document.getElementById("pkgCurrency").value = pkg.currency;
  document.getElementById("pkgShippingFee").value = pkg.shippingFee;
  document.getElementById("pkgShippingCurrency").value = pkg.shippingCurrency;
  document.getElementById("pkgStatus").value = pkg.status;
  const chk = document.getElementById("pkgIsReceived");
  chk.checked = Boolean(pkg.isReceived);
  toggleReceivedCheck(chk.checked);
  if (pkg.receivedDate) document.getElementById("pkgReceivedDate").value = parseDateToISO(pkg.receivedDate);

  updatePackageConversionPreview();
  document.getElementById("pkgFormHeader").innerHTML = `<i class="fa-solid fa-pen text-amber-500"></i> Update Package`;
  document.getElementById("pkgSubmitText").textContent = "Update Package";
  document.getElementById("cancelPkgEditBtn").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelPackageEdit() {
  document.getElementById("editPkgId").value = "";
  const d = document.getElementById("pkgDate");
  if (d) d.value = new Date().toISOString().split('T')[0];
  document.getElementById("pkgShop").value = "";
  document.getElementById("pkgDesc").value = "";
  document.getElementById("pkgTracking").value = "";
  document.getElementById("pkgCost").value = "";
  document.getElementById("pkgShippingFee").value = "";
  const chk = document.getElementById("pkgIsReceived");
  if (chk) { chk.checked = false; toggleReceivedCheck(false); }
  updatePackageConversionPreview();
  document.getElementById("pkgFormHeader").innerHTML = `<i class="fa-solid fa-plus-circle text-indigo-500"></i> Add Tracked Package / Order`;
  document.getElementById("pkgSubmitText").textContent = "Save Package";
  document.getElementById("cancelPkgEditBtn").classList.add("hidden");
}

function deletePackage(id) {
  if (!confirm("Delete package and its linked expenses?")) return;
  packages = packages.filter(x => String(x.id) !== String(id));
  localStorage.setItem("packages", JSON.stringify(packages));
  renderPackages();

  const itemExpId = `${id}_item`;
  const shipExpId = `${id}_ship`;
  expenses = expenses.filter(x => String(x.id) !== itemExpId && String(x.id) !== shipExpId);
  sortExpensesDescending();
  localStorage.setItem("expenses", JSON.stringify(expenses));
  renderExpenses();

  fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "delete", sheet: "Packages", id: id }) });
  fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "delete", sheet: "Expenses", id: itemExpId }) });
  fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "delete", sheet: "Expenses", id: shipExpId }) });
}

/* ------------------- VOUCHERS ------------------- */
async function fetchVouchers() {
  try {
    const res = await fetch(`${SCRIPT_URL}?sheet=Vouchers&t=${Date.now()}`);
    const rawData = await res.json();
    if (Array.isArray(rawData)) {
      vouchers = rawData.map((item, idx) => {
        const val = parseFloat(item.value || item.Value || item.amount || 0) || 0;
        const isUsed = String(item.used || item.Used || item.isUsed || '').toLowerCase() === 'yes' || Boolean(item.used === true);
        return {
          id: String(item.id || item.ID || `v_${idx}`),
          description: String(item.description || item.Description || item.store || 'Voucher'),
          number: String(item.number || item.Number || item.code || '-'),
          expiryDate: parseDateToISO(item.expiryDate || item.ExpiryDate || item.expirationDate),
          origin: String(item.origin || item.Origin || item.provider || '-'),
          value: val,
          currency: String(item.currency || item.Currency || 'ILS').trim().toUpperCase(),
          used: isUsed
        };
      });
      localStorage.setItem("vouchers", JSON.stringify(vouchers));
    }
  } catch (err) {
    vouchers = JSON.parse(localStorage.getItem("vouchers") || "[]");
  }
  renderVouchers();
}

function renderVouchers() {
  const tbody = document.getElementById("vouchersTableBody");
  if (!tbody) return;

  if (!vouchers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">No vouchers registered yet. Add one above.</td></tr>`;
    document.getElementById("voucherTotalAvailable").textContent = "₪0.00";
    document.getElementById("voucherActiveCount").textContent = "0";
    document.getElementById("voucherUsedCount").textContent = "0";
    return;
  }

  let activeTotalIls = 0;
  let activeCount = 0;
  let usedCount = 0;
  const todayISO = new Date().toISOString().split('T')[0];

  tbody.innerHTML = vouchers.map(v => {
    const isUsed = Boolean(v.used);
    const rate = getRateToILS(v.currency);
    const valIls = (parseFloat(v.value) || 0) * rate;
    const sym = v.currency === 'USD' ? '$' : v.currency === 'EUR' ? '€' : '₪';

    if (isUsed) usedCount++;
    else { activeCount++; activeTotalIls += valIls; }

    const isExpired = !isUsed && v.expiryDate && v.expiryDate < todayISO;

    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 ${isUsed ? 'opacity-50 bg-slate-50/60' : isExpired ? 'bg-rose-50/30' : ''}">
        <td class="p-3 text-center">
          <input type="checkbox" ${isUsed ? 'checked' : ''} onchange="quickToggleVoucherUsed('${v.id}', this.checked)" class="w-4 h-4 text-indigo-600 rounded cursor-pointer border-slate-300 focus:ring-indigo-500" />
        </td>
        <td class="p-3 font-medium text-slate-900">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span>${v.description}</span>
            ${isUsed ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-600">Redeemed</span>` : isExpired ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">Expired</span>` : ''}
          </div>
        </td>
        <td class="p-3 font-mono text-slate-800 whitespace-nowrap">
          <div class="flex items-center gap-2">
            <span>${v.number}</span>
            <button type="button" onclick="navigator.clipboard.writeText('${v.number}'); alert('Copied!');" class="text-slate-400 hover:text-indigo-600 text-xs" title="Copy code">
              <i class="fa-regular fa-copy"></i>
            </button>
          </div>
        </td>
        <td class="p-3 text-slate-600 whitespace-nowrap">${v.origin || '-'}</td>
        <td class="p-3 whitespace-nowrap font-mono text-xs ${isExpired ? 'text-rose-600 font-bold' : 'text-slate-500'}">
          ${v.expiryDate || '-'}
        </td>
        <td class="p-3 text-right font-semibold ${isUsed ? 'text-slate-400 line-through' : 'text-slate-900'}">
          ${sym}${Number(v.value || 0).toFixed(2)}
          ${v.currency !== 'ILS' ? `<span class="block text-[11px] font-normal text-slate-400">≈ ₪${valIls.toFixed(2)}</span>` : ''}
        </td>
        <td class="p-3 text-center whitespace-nowrap">
          <button onclick="startVoucherEdit('${v.id}')" class="text-indigo-600 px-1 py-1 text-xs"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deleteVoucher('${v.id}')" class="text-rose-500 px-1 py-1 text-xs"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById("voucherTotalAvailable").textContent = `₪${activeTotalIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("voucherActiveCount").textContent = activeCount;
  document.getElementById("voucherUsedCount").textContent = usedCount;
}

function quickToggleVoucherUsed(id, isUsed) {
  const v = vouchers.find(x => String(x.id) === String(id));
  if (!v) return;
  v.used = isUsed;
  localStorage.setItem("vouchers", JSON.stringify(vouchers));
  renderVouchers();

  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: "update", sheet: "Vouchers", id: v.id, data: { ...v, used: isUsed ? "Yes" : "No" } })
  }).catch(e => console.warn(e));
}

function handleVoucherSubmit(e) {
  if (e) e.preventDefault();
  const desc = document.getElementById("voucherDesc").value.trim();
  const num = document.getElementById("voucherNumber").value.trim();
  const val = parseFloat(document.getElementById("voucherValue").value) || 0;
  const expiry = parseDateToISO(document.getElementById("voucherExpiry").value);
  const origin = document.getElementById("voucherOrigin").value.trim();
  const curr = document.getElementById("voucherCurrency").value;
  const isUsed = document.getElementById("voucherIsUsed").checked;

  if (!desc || !num) return alert("Please enter description and code number");

  const editId = document.getElementById("editVoucherId").value.trim();
  const isEditing = Boolean(editId);
  const targetId = isEditing ? editId : ("v_" + Date.now());

  const payload = {
    id: targetId,
    description: desc,
    number: num,
    origin: origin,
    expiryDate: expiry,
    value: val,
    currency: curr,
    used: isUsed ? "Yes" : "No"
  };

  if (isEditing) vouchers = vouchers.map(x => String(x.id) === String(editId) ? { ...payload, used: isUsed } : x);
  else vouchers.unshift({ ...payload, used: isUsed });

  localStorage.setItem("vouchers", JSON.stringify(vouchers));
  renderVouchers();
  cancelVoucherEdit();

  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify({ action: isEditing ? "update" : "add", sheet: "Vouchers", id: editId || undefined, data: payload })
  }).catch(e => console.warn(e));
}

function startVoucherEdit(id) {
  const v = vouchers.find(x => String(x.id) === String(id));
  if (!v) return;
  document.getElementById("editVoucherId").value = v.id;
  document.getElementById("voucherDesc").value = v.description;
  document.getElementById("voucherNumber").value = v.number;
  document.getElementById("voucherOrigin").value = v.origin === '-' ? '' : v.origin;
  document.getElementById("voucherExpiry").value = parseDateToISO(v.expiryDate);
  document.getElementById("voucherValue").value = v.value;
  document.getElementById("voucherCurrency").value = v.currency;
  document.getElementById("voucherIsUsed").checked = Boolean(v.used);

  document.getElementById("voucherFormHeader").innerHTML = `<i class="fa-solid fa-pen text-amber-500"></i> Edit Voucher`;
  document.getElementById("voucherSubmitText").textContent = "Update Voucher";
  document.getElementById("cancelVoucherEditBtn").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelVoucherEdit() {
  document.getElementById("editVoucherId").value = "";
  document.getElementById("voucherDesc").value = "";
  document.getElementById("voucherNumber").value = "";
  document.getElementById("voucherOrigin").value = "";
  document.getElementById("voucherValue").value = "";
  document.getElementById("voucherIsUsed").checked = false;
  const d = document.getElementById("voucherExpiry");
  if (d) d.value = new Date().toISOString().split('T')[0];

  document.getElementById("voucherFormHeader").innerHTML = `<i class="fa-solid fa-plus-circle text-indigo-500"></i> Add New Voucher / Gift Card`;
  document.getElementById("voucherSubmitText").textContent = "Save Voucher";
  document.getElementById("cancelVoucherEditBtn").classList.add("hidden");
}

function deleteVoucher(id) {
  if (!confirm("Delete this voucher?")) return;
  vouchers = vouchers.filter(x => String(x.id) !== String(id));
  localStorage.setItem("vouchers", JSON.stringify(vouchers));
  renderVouchers();
  fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "delete", sheet: "Vouchers", id: id }) });
}

/* ------------------- HELPERS ------------------- */
function setSyncStatus(text, color) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  const dot = el.querySelector("span:first-child");
  const label = el.querySelector("span:last-child");
  if (label) label.textContent = text;
  if (dot) dot.className = `w-2 h-2 rounded-full ${color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`;
}

function clearLocalStorage() {
  localStorage.clear();
  alert("Cache cleared.");
  location.reload();
}