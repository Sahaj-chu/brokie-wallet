// ── Auth guard ───────────────────────────────────────────────
async function checkAuth() {
  // Tab-specific check — sessionStorage is cleared when tab is closed
  if (!sessionStorage.getItem('loggedIn')) {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' }); // clear server session
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  const res = await fetch('/api/records/today', { credentials: 'include' });
  if (res.status === 401) {
    sessionStorage.removeItem('loggedIn');
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
}

async function logout() {
  sessionStorage.removeItem('loggedIn');
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html';
}

// ── Number key guard ─────────────────────────────────────────
function isNumberKey(evt) {
  const charCode = evt.which || evt.keyCode;
  return charCode === 46 || (charCode >= 48 && charCode <= 57);
}

// ── Chart setup ──────────────────────────────────────────────
const ctx = document.getElementById('myChart');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Expenses',
        data: [],
        borderColor: '#F60000',
        backgroundColor: 'rgba(246, 0, 0, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { title: { display: true, text: 'Day' } },
      y: { beginAtZero: true, title: { display: true, text: 'Amount' } }
    }
  }
});

// ── Update savings display ───────────────────────────────────
function updateSavings(totals) {
  const income = parseFloat(totals.totalIncome) || 0;
  const expense = parseFloat(totals.totalExpense) || 0;
  const savings = income - expense;
  document.getElementById('Value-Savings').textContent = savings.toLocaleString();
}

// ── Update expense list and chart ────────────────────────────
function updateUI(today, week) {
  // Expense list — only today's expenses
  const list = document.getElementById('List');
  list.innerHTML = '';
  today
    .filter(r => r.type === 'expense')
    .forEach(r => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${r.label || 'Expense'}</span>
        <span class="amount">-${parseFloat(r.amount).toLocaleString()}</span>
      `;
      list.appendChild(li);
    });

  // Chart — fill 7 days, default 0 for missing days
  const last7 = getLast7Days();
  const weekMap = {};
  week.forEach(row => { weekMap[row.day] = row; });

  chart.data.labels = last7.map(d => formatDay(d));
  chart.data.datasets[0].data = last7.map(d => parseFloat(weekMap[d]?.expense) || 0);
  chart.update();
}

// ── Submit a new income or expense record ────────────────────
async function submitRecord() {
  const incomeVal = document.getElementById('Income').value.trim();
  const expenseVal = document.getElementById('Expenses').value.trim();
  const label = document.getElementById('ExpenseLabel').value.trim();

  if (!incomeVal && !expenseVal) return;

  const requests = [];

  if (incomeVal && parseFloat(incomeVal) > 0) {
    requests.push(fetch('/api/records', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'income', amount: incomeVal, label: 'Income' })
    }));
  }

  if (expenseVal && parseFloat(expenseVal) > 0) {
    requests.push(fetch('/api/records', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'expense', amount: expenseVal, label: label || 'Expense' })
    }));
  }

  if (requests.length === 0) return;

  const responses = await Promise.all(requests);
  const data = await responses[responses.length - 1].json();
  updateUI(data.today, data.week);

  // Refresh all-time savings
  const totalsRes = await fetch('/api/records/totals', { credentials: 'include' });
  const totals = await totalsRes.json();
  updateSavings(totals);

  // Clear inputs
  document.getElementById('Income').value = '';
  document.getElementById('Expenses').value = '';
  document.getElementById('ExpenseLabel').value = '';
}

// ── Helpers ───────────────────────────────────────────────────
function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  try {
    await checkAuth();
    const [todayRes, weekRes, meRes, totalsRes] = await Promise.all([
      fetch('/api/records/today', { credentials: 'include' }),
      fetch('/api/records/week', { credentials: 'include' }),
      fetch('/api/me', { credentials: 'include' }),
      fetch('/api/records/totals', { credentials: 'include' })
    ]);
    const today = await todayRes.json();
    const week = await weekRes.json();
    const me = await meRes.json();
    const totals = await totalsRes.json();
    document.getElementById('username-display').textContent = `Hi, ${me.username}`;
    updateSavings(totals);
    updateUI(today, week);
  } catch (e) {
    console.error('Init error:', e);
  }
}

init();