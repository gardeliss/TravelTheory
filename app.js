// ============================================================
// TRAVEL AGENCY APP — app.js
// ============================================================

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ────────────────────────────────────────────────────
const state = {
  user: null,
  trips: [],
  customers: [],
  currentTrip: null,
  currentParticipants: [],
  currentWaitlist: [],
  currentCosts: [],
  currentTasks: [],
  editingId: null,
  selectedCustomerId: null,
  addingToWaitlist: false,
};

const BANK_METHODS  = ['ALPHA','EUROBANK','ΕΘΝΙΚΗ','REVOLUT','E-POS'];
const CASH_METHODS  = ['ΜΕΤΡΗΤΑ','ΜΕΤΡΗΤΑ (ΑΠΟΔΕΙΞΗ)'];

const TASK_DEFINITIONS = [
  { key: 'viber_group',         label: 'Viber Group' },
  { key: 'travel_instructions', label: 'Οδηγίες Ταξιδιού' },
  { key: 'name_check_1',        label: 'Έλεγχος Ονομάτων 1' },
  { key: 'name_check_2',        label: 'Έλεγχος Ονομάτων 2' },
  { key: 'insurance',           label: 'Ασφάλεια' },
  { key: 'optional_excursions', label: 'Προαιρετικά' },
  { key: 'reminder',            label: 'Υπενθύμιση' },
  { key: 'leader_instructions', label: 'Leader και Οδηγίες Συνάντησης' },
  { key: 'leader_briefing',     label: 'Leader Briefing' },
  { key: 'group_arrived',       label: 'Group Arrived' },
  { key: 'feedback_form',       label: 'Feedback Form' },
];

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  bindStaticEvents();

  const { data: { session } } = await db.auth.getSession();
  if (session) {
    state.user = session.user;
    enterApp();
  } else {
    showScreen('login');
  }

  db.auth.onAuthStateChange((_event, session) => {
    if (session) {
      state.user = session.user;
      // Only enter app if we're currently on login screen
      if (!$('app-screen').classList.contains('hidden')) return;
      enterApp();
    } else {
      showScreen('login');
    }
  });
});

// ── AUTH ─────────────────────────────────────────────────────
async function login(email, password) {
  const btn = $('login-btn');
  btn.disabled = true;
  btn.textContent = 'Σύνδεση...';
  hide('login-error');

  const rememberMe = document.getElementById('remember-me')?.checked;
  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    setText('login-error', 'Λανθασμένα στοιχεία. Προσπαθήστε ξανά.');
    show('login-error');
    btn.disabled = false;
    btn.textContent = 'Είσοδος';
  } else {
    if (rememberMe) {
      localStorage.setItem('ta_remember_email', email);
    } else {
      localStorage.removeItem('ta_remember_email');
    }
  }
}

async function logout() {
  await db.auth.signOut();
  showScreen('login');
}

function enterApp() {
  setText('user-email-display', state.user.email);
  showScreen('app');
  navigateTo('trips');
}

// ── NAVIGATION ───────────────────────────────────────────────
function navigateTo(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  if (view === 'trips') {
    show('view-trips');
    document.querySelector('[data-view="trips"]').classList.add('active');
    loadTrips();
  } else if (view === 'customers') {
    show('view-customers');
    document.querySelector('[data-view="customers"]').classList.add('active');
    loadCustomers();
    initSortableTable('customers-table', () => state.customers, renderCustomersRows);
  } else if (view === 'trip-detail') {
    show('view-trip-detail');
  }
}

// ── SCREEN HELPERS ────────────────────────────────────────────
function showScreen(name) {
  $('login-screen').classList.toggle('hidden', name !== 'login');
  $('app-screen').classList.toggle('hidden',   name !== 'app');
}

// ── TRIPS ────────────────────────────────────────────────────
async function loadTrips() {
  const { data, error } = await db.from('trips').select('*').order('date_from', { ascending: false });
  if (error) return toast('Σφάλμα φόρτωσης ταξιδιών', 'error');
  state.trips = data || [];
  renderTrips();
}

function renderTrips() {
  const container = $('trips-list');
  if (!state.trips.length) {
    container.innerHTML = '<p style="color:var(--text3);padding:1rem">Δεν υπάρχουν ταξίδια ακόμα.</p>';
    return;
  }
  container.innerHTML = state.trips.map(t => `
    <div class="trip-card" data-id="${t.id}" onclick="openTrip('${t.id}')">
      <div class="trip-card-title">${esc(t.title)}</div>
      <div class="trip-card-meta">
        <span>📅 ${formatDate(t.date_from)} – ${formatDate(t.date_to)}</span>
        <span>⏱ ${t.duration_days ?? '—'} ημέρες</span>
        <span>👥 ${t.num_persons ?? 0} άτομα</span>
      </div>
      <span class="trip-card-badge">${esc(t.title)}</span>
    </div>
  `).join('');
}

async function openTrip(id) {
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;
  state.currentTrip = trip;

  setText('trip-detail-title', trip.title);

  // Info bar
  $('trip-info-bar').innerHTML = `
    <div class="trip-info-item"><span class="trip-info-label">Αναχώρηση</span><span class="trip-info-value">${formatDate(trip.date_from)}</span></div>
    <div class="trip-info-item"><span class="trip-info-label">Επιστροφή</span><span class="trip-info-value">${formatDate(trip.date_to)}</span></div>
    <div class="trip-info-item"><span class="trip-info-label">Διάρκεια</span><span class="trip-info-value">${trip.duration_days ?? '—'} ημέρες</span></div>
    <div class="trip-info-item"><span class="trip-info-label">Άτομα</span><span class="trip-info-value">${trip.num_persons ?? 0}</span></div>
  `;

  navigateTo('trip-detail');
  switchTab('participants');
}

// ── SAVE TRIP (New / Edit) ────────────────────────────────────
async function saveTrip() {
  const payload = {
    title:       $('trip-title').value.trim(),
    date_from:   $('trip-date-from').value,
    date_to:     $('trip-date-to').value,
    num_persons: parseInt($('trip-num-persons').value) || 0,
  };

  if (!payload.title || !payload.date_from || !payload.date_to) {
    return toast('Συμπληρώστε τίτλο και ημερομηνίες', 'error');
  }

  let error;
  if (state.editingId) {
    ({ error } = await db.from('trips').update(payload).eq('id', state.editingId));
  } else {
    ({ error } = await db.from('trips').insert(payload));
  }

  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  toast(state.editingId ? 'Ταξίδι ενημερώθηκε' : 'Ταξίδι δημιουργήθηκε', 'success');

  // If editing current trip, update state and info bar immediately
  if (state.editingId && state.currentTrip && state.editingId === state.currentTrip.id) {
    Object.assign(state.currentTrip, payload);
    // Re-fetch to get computed duration_days
    const { data: refreshed } = await db.from('trips').select('*').eq('id', state.editingId).single();
    if (refreshed) {
      state.currentTrip = refreshed;
      setText('trip-detail-title', refreshed.title);
      document.getElementById('trip-info-bar').innerHTML = `
        <div class="trip-info-item"><span class="trip-info-label">Αναχώρηση</span><span class="trip-info-value">${formatDate(refreshed.date_from)}</span></div>
        <div class="trip-info-item"><span class="trip-info-label">Επιστροφή</span><span class="trip-info-value">${formatDate(refreshed.date_to)}</span></div>
        <div class="trip-info-item"><span class="trip-info-label">Διάρκεια</span><span class="trip-info-value">${refreshed.duration_days ?? '—'} ημέρες</span></div>
        <div class="trip-info-item"><span class="trip-info-label">Άτομα</span><span class="trip-info-value">${refreshed.num_persons ?? 0}</span></div>
      `;
    }
  }

  closeModal('modal-trip');
  loadTrips();
}

// ── CUSTOMERS ────────────────────────────────────────────────
async function loadCustomers(filter = '') {
  let query = db.from('customers').select('*').order('last_name');
  if (filter) query = query.or(`first_name.ilike.%${filter}%,last_name.ilike.%${filter}%,email.ilike.%${filter}%,passport_number.ilike.%${filter}%`);

  const { data, error } = await query;
  if (error) return toast('Σφάλμα φόρτωσης πελατών', 'error');
  state.customers = data || [];
  renderCustomers();
}

function renderCustomers() {
  applySortFilter('customers-table', () => state.customers, renderCustomersRows);
}

async function saveCustomer() {
  const payload = {
    first_name:      $('cust-first-name').value.trim(),
    last_name:       $('cust-last-name').value.trim(),
    date_of_birth:   $('cust-dob').value.trim(),
    passport_number: $('cust-passport').value.trim(),
    nationality:     $('cust-nationality').value,
    issue_date:      $('cust-issue-date').value || null,
    expiry_date:     $('cust-expiry-date').value || null,
    telephone:       $('cust-telephone').value.trim(),
    email:           $('cust-email').value.trim(),
    notes:           $('cust-notes').value.trim(),
  };

  if (!payload.first_name || !payload.last_name) {
    return toast('Συμπληρώστε τουλάχιστον όνομα και επώνυμο', 'error');
  }

  let error;
  if (state.editingId) {
    ({ error } = await db.from('customers').update(payload).eq('id', state.editingId));
  } else {
    ({ error } = await db.from('customers').insert(payload));
  }

  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  toast(state.editingId ? 'Πελάτης ενημερώθηκε' : 'Πελάτης αποθηκεύτηκε', 'success');
  closeModal('modal-customer');
  loadCustomers();
}

async function editCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  state.editingId = id;

  setText('modal-customer-title', 'Επεξεργασία Πελάτη');
  $('cust-first-name').value   = c.first_name || '';
  $('cust-last-name').value    = c.last_name  || '';
  $('cust-dob').value          = c.date_of_birth || '';
  $('cust-passport').value     = c.passport_number || '';
  $('cust-nationality').value  = c.nationality || '';
  $('cust-issue-date').value   = c.issue_date  || '';
  $('cust-expiry-date').value  = c.expiry_date || '';
  $('cust-telephone').value    = c.telephone   || '';
  $('cust-email').value        = c.email       || '';
  $('cust-notes').value        = c.notes       || '';
  openModal('modal-customer');
}

async function deleteCustomer(id) {
  if (!confirm('Διαγραφή πελάτη; Η ενέργεια δεν αναιρείται.')) return;
  const { error } = await db.from('customers').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  toast('Πελάτης διαγράφηκε', 'success');
  loadCustomers();
}

// ── PARTICIPANTS ──────────────────────────────────────────────
async function loadParticipants() {
  const { data, error } = await db
    .from('trip_participants')
    .select('*, customers(first_name, last_name)')
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', false)
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης συμμετεχόντων', 'error');
  state.currentParticipants = data || [];
  renderParticipants();
  updateParticipantCount();
}

async function loadWaitlist() {
  const { data, error } = await db
    .from('trip_participants')
    .select('*, customers(first_name, last_name)')
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', true)
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης εφεδρικών', 'error');
  state.currentWaitlist = data || [];
  renderWaitlist();
}

function updateParticipantCount() {
  const max     = state.currentTrip.num_persons || 0;
  const current = state.currentParticipants.length;
  const el = document.getElementById('participant-count-bar');
  if (!el) return;
  el.innerHTML = `
    <span>Συμμετέχοντες: <strong>${current}</strong> / <strong>${max}</strong></span>
    ${current >= max && max > 0
      ? '<span class="badge badge-yellow" style="margin-left:.8rem">⚠️ Μέγιστος αριθμός ατόμων</span>'
      : ''}
  `;
}

function renderParticipants() {
  applySortFilter('participants-table', () => state.currentParticipants, renderParticipantsRows);
}

function renderWaitlist() {
  applySortFilter('waitlist-table', () => state.currentWaitlist, renderWaitlistRows);
}

async function saveParticipant() {
  if (!state.selectedCustomerId) return toast('Επιλέξτε πελάτη', 'error');

  const dep  = parseInt(document.getElementById('part-deposit-amount').value)  || 0;
  const ins2 = parseInt(document.getElementById('part-inst2-amount').value)    || 0;
  const ins3 = parseInt(document.getElementById('part-inst3-amount').value)    || 0;
  const ins4 = parseInt(document.getElementById('part-inst4-amount').value)    || 0;
  const totalPaid = dep + ins2 + ins3 + ins4;

  const manualBalance = document.getElementById('part-balance').value;
  let balance;
  if (manualBalance !== '') {
    balance = parseInt(manualBalance);
  } else {
    const trip = state.currentTrip;
    const refPrice = trip.price_full || 0;
    balance = refPrice > 0 ? Math.max(0, refPrice - totalPaid) : 0;
  }

  // Check capacity (only for new non-waitlist entries)
  const isWaitlist = state.addingToWaitlist;
  if (!state.editingId && !isWaitlist) {
    const max = state.currentTrip.num_persons || 0;
    if (max > 0 && state.currentParticipants.length >= max) {
      const goWaitlist = confirm(
        `Έχετε φτάσει τον μέγιστο αριθμό ατόμων (${max}).

Θέλετε να προσθέσετε τον πελάτη στους Εφεδρικούς;`
      );
      if (!goWaitlist) return;
      state.addingToWaitlist = true;
    }
  }

  const payload = {
    trip_id:              state.currentTrip.id,
    customer_id:          state.selectedCustomerId,
    is_waitlist:          state.addingToWaitlist,
    solo_couple:          document.getElementById('part-solo-couple').value  || null,
    room_type:            document.getElementById('part-room-type').value    || null,
    deposit_amount:       dep,
    deposit_method:       document.getElementById('part-deposit-method').value  || null,
    deposit_date:         document.getElementById('part-deposit-date').value    || null,
    installment2_amount:  ins2,
    installment2_method:  document.getElementById('part-inst2-method').value   || null,
    installment2_date:    document.getElementById('part-inst2-date').value      || null,
    installment3_amount:  ins3,
    installment3_method:  document.getElementById('part-inst3-method').value   || null,
    installment3_date:    document.getElementById('part-inst3-date').value      || null,
    installment4_amount:  ins4,
    installment4_method:  document.getElementById('part-inst4-method').value   || null,
    installment4_date:    document.getElementById('part-inst4-date').value      || null,
    balance,
    final_payment:        parseInt(document.getElementById('part-final-payment').value) || 0,
  };

  let error;
  if (state.editingId) {
    ({ error } = await db.from('trip_participants').update(payload).eq('id', state.editingId));
  } else {
    ({ error } = await db.from('trip_participants').insert(payload));
  }

  if (error) return toast('Σφάλμα αποθήκευσης' + (error.message?.includes('unique') ? ': Ο πελάτης συμμετέχει ήδη' : ''), 'error');

  toast(state.addingToWaitlist ? 'Προστέθηκε στους Εφεδρικούς' : 'Αποθηκεύτηκε', 'success');
  closeModal('modal-participant');
  loadParticipants();
  loadWaitlist();
}

async function promoteFromWaitlist(id) {
  const max = state.currentTrip.num_persons || 0;
  if (max > 0 && state.currentParticipants.length >= max) {
    return toast(`Δεν υπάρχει χώρος στη λίστα (μέγιστο: ${max} άτομα)`, 'error');
  }
  if (!confirm('Μεταφορά στην κύρια λίστα;')) return;
  const { error } = await db.from('trip_participants').update({ is_waitlist: false }).eq('id', id);
  if (error) return toast('Σφάλμα μεταφοράς', 'error');
  toast('Μεταφέρθηκε στη λίστα', 'success');
  loadParticipants();
  loadWaitlist();
}

async function editParticipant(id) {
  const p = state.currentParticipants.find(x => x.id === id);
  if (!p) return;
  state.editingId = id;
  state.selectedCustomerId = p.customer_id;

  setText('modal-participant-title', 'Επεξεργασία Συμμετέχοντα');
  if (p.customers) {
    $('participant-search').value = `${p.customers.last_name} ${p.customers.first_name}`;
    showSelectedCustomer(p.customers);
  }

  $('part-solo-couple').value      = p.solo_couple  || '';
  $('part-room-type').value        = p.room_type    || '';
  $('part-deposit-amount').value   = p.deposit_amount  || '';
  $('part-deposit-method').value   = p.deposit_method  || '';
  $('part-deposit-date').value     = p.deposit_date    || '';
  $('part-inst2-amount').value     = p.installment2_amount || '';
  $('part-inst2-method').value     = p.installment2_method || '';
  $('part-inst2-date').value       = p.installment2_date   || '';
  $('part-inst3-amount').value     = p.installment3_amount || '';
  $('part-inst3-method').value     = p.installment3_method || '';
  $('part-inst3-date').value       = p.installment3_date   || '';
  $('part-inst4-amount').value     = p.installment4_amount || '';
  $('part-inst4-method').value     = p.installment4_method || '';
  $('part-inst4-date').value       = p.installment4_date   || '';
  $('part-balance').value          = p.balance       || '';
  $('part-final-payment').value    = p.final_payment || '';

  openModal('modal-participant');
}

async function deleteParticipant(id, fromWaitlist = false) {
  if (!confirm(fromWaitlist ? 'Διαγραφή εφεδρικού;' : 'Αφαίρεση συμμετέχοντα;')) return;
  const { error } = await db.from('trip_participants').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  toast('Αφαιρέθηκε', 'success');
  loadParticipants();
  if (fromWaitlist) loadWaitlist();
}

// Customer search for participant modal
async function searchCustomersForParticipant(query) {
  if (query.length < 2) { hide('participant-search-results'); return; }

  const { data } = await db.from('customers')
    .select('id, first_name, last_name, passport_number')
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .limit(8);

  const results = $('participant-search-results');
  if (!data || !data.length) {
    results.innerHTML = '<div class="search-dropdown-item" style="color:var(--text3)">Δεν βρέθηκαν αποτελέσματα</div>';
    show('participant-search-results');
    return;
  }

  results.innerHTML = data.map(c => `
    <div class="search-dropdown-item" onclick="selectCustomer('${c.id}','${esc(c.last_name)}','${esc(c.first_name)}','${esc(c.passport_number||'')}')">
      <strong>${esc(c.last_name)} ${esc(c.first_name)}</strong>
      ${c.passport_number ? `<span style="color:var(--text3);margin-left:.5rem;font-size:.78rem">${esc(c.passport_number)}</span>` : ''}
    </div>
  `).join('');
  show('participant-search-results');
}

function selectCustomer(id, lastName, firstName, passport) {
  state.selectedCustomerId = id;
  $('participant-search').value = `${lastName} ${firstName}`;
  hide('participant-search-results');
  showSelectedCustomer({ last_name: lastName, first_name: firstName, passport_number: passport });
}

function showSelectedCustomer(c) {
  const el = $('selected-customer-info');
  el.textContent = `✓ ${c.last_name} ${c.first_name}${c.passport_number ? ' — ' + c.passport_number : ''}`;
  show('selected-customer-info');
}

// ── COSTS ────────────────────────────────────────────────────
async function loadCosts() {
  const { data, error } = await db
    .from('trip_costs')
    .select('*')
    .eq('trip_id', state.currentTrip.id)
    .order('entry_date', { ascending: false });

  if (error) return toast('Σφάλμα φόρτωσης εξόδων', 'error');
  state.currentCosts = data || [];
  renderCosts();
}

function renderCosts() {
  applySortFilter('costs-table', () => state.currentCosts, renderCostsRows);
}

async function saveCost() {
  const payload = {
    trip_id:        state.currentTrip.id,
    booking_ref:    $('cost-booking-ref').value.trim()  || null,
    expense_type:   $('cost-expense-type').value        || null,
    cost:           parseInt($('cost-cost').value)      || 0,
    local_currency: $('cost-local-currency').value.trim() || null,
    amount_eur:     parseInt($('cost-amount-eur').value)  || 0,
    payment_method: $('cost-payment-method').value      || null,
    payment_date:   $('cost-payment-date').value        || null,
    entry_date:     $('cost-entry-date').value          || null,
    is_paid:        $('cost-is-paid').checked,
    has_invoice:    $('cost-has-invoice').checked,
    invoice_name:   $('cost-invoice-name').value.trim() || null,
  };

  let error;
  if (state.editingId) {
    ({ error } = await db.from('trip_costs').update(payload).eq('id', state.editingId));
  } else {
    ({ error } = await db.from('trip_costs').insert(payload));
  }

  if (error) return toast('Σφάλμα αποθήκευσης', 'error');
  toast('Αποθηκεύτηκε', 'success');
  closeModal('modal-cost');
  loadCosts();
}

async function editCost(id) {
  const c = state.currentCosts.find(x => x.id === id);
  if (!c) return;
  state.editingId = id;
  setText('modal-cost-title', 'Επεξεργασία Εξόδου');

  $('cost-booking-ref').value     = c.booking_ref    || '';
  $('cost-expense-type').value    = c.expense_type   || '';
  $('cost-cost').value            = c.cost           || '';
  $('cost-local-currency').value  = c.local_currency || '';
  $('cost-amount-eur').value      = c.amount_eur     || '';
  $('cost-payment-method').value  = c.payment_method || '';
  $('cost-payment-date').value    = c.payment_date   || '';
  $('cost-entry-date').value      = c.entry_date     || '';
  $('cost-is-paid').checked       = c.is_paid;
  $('cost-has-invoice').checked   = c.has_invoice;
  $('cost-invoice-name').value    = c.invoice_name   || '';
  openModal('modal-cost');
}

async function deleteCost(id) {
  if (!confirm('Διαγραφή εξόδου;')) return;
  const { error } = await db.from('trip_costs').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  toast('Διαγράφηκε', 'success');
  loadCosts();
}

// ── FINANCIALS ────────────────────────────────────────────────
async function loadFinancials() {
  const { data, error } = await db
    .from('trip_financials')
    .select('*')
    .eq('trip_id', state.currentTrip.id)
    .single();

  if (error && error.code !== 'PGRST116') return toast('Σφάλμα φόρτωσης λογιστικής', 'error');
  renderFinancials(data || {});
}

function renderFinancials(f) {
  const gross     = f.gross_profit     || 0;
  const accounting = f.accounting_profit || 0;

  $('financials-content').innerHTML = `
    <div class="fin-card">
      <div class="fin-card-label">Έσοδα Τράπεζα</div>
      <div class="fin-card-value">${formatEur(f.income_bank || 0)}</div>
    </div>
    <div class="fin-card">
      <div class="fin-card-label">Έσοδα Cash</div>
      <div class="fin-card-value">${formatEur(f.income_cash || 0)}</div>
    </div>
    <div class="fin-card">
      <div class="fin-card-label">Έξοδα Τράπεζα</div>
      <div class="fin-card-value">${formatEur(f.expense_bank || 0)}</div>
    </div>
    <div class="fin-card">
      <div class="fin-card-label">Έξοδα Μετρητά</div>
      <div class="fin-card-value">${formatEur(f.expense_cash || 0)}</div>
    </div>
    <div class="fin-card full-width">
      <div class="fin-card-label">Μικτό Κέρδος (Σύνολο Εσόδων − Εξόδων)</div>
      <div class="fin-card-value ${gross >= 0 ? 'positive' : 'negative'}">${formatEur(gross)}</div>
    </div>
    <div class="fin-card full-width">
      <div class="fin-card-label">Λογιστικό Κέρδος / Ζημία (Τράπεζα μόνο)</div>
      <div class="fin-card-value ${accounting >= 0 ? 'positive' : 'negative'}">${formatEur(accounting)}</div>
    </div>
  `;
}

// ── PRICING ───────────────────────────────────────────────────
function loadPricing() {
  const t = state.currentTrip;
  $('pricing-content').innerHTML = `
    <div class="pricing-card">
      <label>Full Price</label>
      <input type="number" id="price-full" value="${t.price_full || ''}" min="0" placeholder="0" />
    </div>
    <div class="pricing-card">
      <label>No Flight</label>
      <input type="number" id="price-no-flight" value="${t.price_no_flight || ''}" min="0" placeholder="0" />
    </div>
    <div class="pricing-card">
      <label>Single Supplement</label>
      <input type="number" id="price-single-supp" value="${t.price_single_supp || ''}" min="0" placeholder="0" />
    </div>
    <div style="grid-column:1/-1">
      <button class="btn btn-primary pricing-save-btn" onclick="savePricing()">Αποθήκευση Τιμών</button>
    </div>
  `;
}

async function savePricing() {
  const payload = {
    price_full:        parseInt($('price-full').value)        || 0,
    price_no_flight:   parseInt($('price-no-flight').value)   || 0,
    price_single_supp: parseInt($('price-single-supp').value) || 0,
  };

  const { error } = await db.from('trips').update(payload).eq('id', state.currentTrip.id);
  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  Object.assign(state.currentTrip, payload);
  toast('Τιμές αποθηκεύτηκαν', 'success');
}

// ── TASKS ─────────────────────────────────────────────────────
async function loadTasks() {
  const { data, error } = await db
    .from('trip_tasks')
    .select('*')
    .eq('trip_id', state.currentTrip.id)
    .order('sort_order');

  if (error) return toast('Σφάλμα φόρτωσης tasks', 'error');
  state.currentTasks = data || [];
  renderTasks();
}

function renderTasks() {
  const container = $('tasks-content');
  if (!state.currentTasks.length) {
    container.innerHTML = '<p style="color:var(--text3)">Δεν βρέθηκαν tasks.</p>';
    return;
  }
  container.innerHTML = state.currentTasks.map(t => `
    <div class="task-item ${t.is_done ? 'done' : ''}" id="task-row-${t.id}">
      <input class="task-checkbox" type="checkbox" ${t.is_done ? 'checked' : ''}
             onchange="updateTask('${t.id}', 'is_done', this.checked)" />
      <span class="task-label">${esc(t.task_label)}</span>
      <div class="task-date">
        <input type="date" value="${t.task_date || ''}"
               onchange="updateTask('${t.id}', 'task_date', this.value)" />
      </div>
      <div class="task-comments">
        <input type="text" value="${esc(t.comments || '')}" placeholder="Σημειώσεις..."
               onblur="updateTask('${t.id}', 'comments', this.value)" />
      </div>
    </div>
  `).join('');
}

async function updateTask(id, field, value) {
  const { error } = await db.from('trip_tasks').update({ [field]: value }).eq('id', id);
  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  // Update local state & re-render only the row styling
  const task = state.currentTasks.find(t => t.id === id);
  if (task) task[field] = value;

  if (field === 'is_done') {
    const row = document.getElementById(`task-row-${id}`);
    if (row) row.classList.toggle('done', value);
  }
}

// ── TABS ─────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  show(`tab-${tabName}`);
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');

  // Load data for the tab
  if (tabName === 'participants') {
    loadParticipants();
    initSortableTable('participants-table', () => state.currentParticipants, renderParticipantsRows);
  }
  if (tabName === 'costs') {
    loadCosts();
    initSortableTable('costs-table', () => state.currentCosts, renderCostsRows);
  }
  if (tabName === 'financials')   loadFinancials();
  if (tabName === 'pricing')      loadPricing();
  if (tabName === 'tasks')        loadTasks();
  if (tabName === 'waitlist') {
    loadWaitlist();
    initSortableTable('waitlist-table', () => state.currentWaitlist, renderWaitlistRows);
  }
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function openModal(id) { show(id); }

function closeModal(id) {
  hide(id);
  state.editingId = null;
  state.selectedCustomerId = null;
}

function resetTripForm() {
  ['trip-title','trip-date-from','trip-date-to','trip-num-persons'].forEach(id => { $(id).value = ''; });
  setText('modal-trip-title', 'Νέο Ταξίδι');
  state.editingId = null;
}

function resetCustomerForm() {
  ['cust-first-name','cust-last-name','cust-dob','cust-passport','cust-issue-date',
   'cust-expiry-date','cust-telephone','cust-email','cust-notes'].forEach(id => { $(id).value = ''; });
  $('cust-nationality').value = '';
  setText('modal-customer-title', 'Νέος Πελάτης');
  state.editingId = null;
}

function resetParticipantForm() {
  ['part-solo-couple','part-room-type',
   'part-deposit-amount','part-deposit-method','part-deposit-date',
   'part-inst2-amount','part-inst2-method','part-inst2-date',
   'part-inst3-amount','part-inst3-method','part-inst3-date',
   'part-inst4-amount','part-inst4-method','part-inst4-date',
   'part-balance','part-final-payment'].forEach(id => { $(id).value = ''; });
  $('participant-search').value = '';
  hide('participant-search-results');
  hide('selected-customer-info');
  setText('modal-participant-title', 'Προσθήκη Συμμετέχοντα');
  state.editingId = null;
  state.selectedCustomerId = null;
  state.addingToWaitlist = false;
}

function resetCostForm() {
  ['cost-booking-ref','cost-expense-type','cost-cost','cost-local-currency',
   'cost-amount-eur','cost-payment-method','cost-payment-date','cost-entry-date',
   'cost-invoice-name'].forEach(id => { $(id).value = ''; });
  $('cost-is-paid').checked    = false;
  $('cost-has-invoice').checked = false;
  setText('modal-cost-title', 'Νέο Έξοδο');
  state.editingId = null;
}

// ── EVENTS ───────────────────────────────────────────────────
function bindStaticEvents() {
  // Login form
  $('login-form').addEventListener('submit', e => {
    e.preventDefault();
    login($('login-email').value, $('login-password').value);
  });

  // Logout
  $('logout-btn').addEventListener('click', logout);

  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  // Back button
  $('btn-back-trips').addEventListener('click', () => navigateTo('trips'));

  // New trip
  $('btn-new-trip').addEventListener('click', () => {
    resetTripForm();
    openModal('modal-trip');
  });

  // Edit trip (from detail view)
  $('btn-edit-trip').addEventListener('click', () => {
    const t = state.currentTrip;
    setText('modal-trip-title', 'Επεξεργασία Ταξιδιού');
    state.editingId = t.id;
    $('trip-title').value        = t.title      || '';
    $('trip-date-from').value    = t.date_from  || '';
    $('trip-date-to').value      = t.date_to    || '';
    $('trip-num-persons').value  = t.num_persons || '';
    openModal('modal-trip');
  });

  $('btn-save-trip').addEventListener('click', saveTrip);

  // New customer
  $('btn-new-customer').addEventListener('click', () => {
    resetCustomerForm();
    openModal('modal-customer');
  });

  $('btn-save-customer').addEventListener('click', saveCustomer);

  // Customer search
  $('customer-search').addEventListener('input', e => loadCustomers(e.target.value));

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Add participant
  $('btn-add-participant').addEventListener('click', () => {
    resetParticipantForm();
    state.addingToWaitlist = false;
    openModal('modal-participant');
  });

  // Add to waitlist
  document.getElementById('btn-add-waitlist')?.addEventListener('click', () => {
    resetParticipantForm();
    state.addingToWaitlist = true;
    setText('modal-participant-title', 'Προσθήκη Εφεδρικού');
    openModal('modal-participant');
  });

  $('btn-save-participant').addEventListener('click', saveParticipant);

  // Participant customer search
  let searchTimeout;
  $('participant-search').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    state.selectedCustomerId = null;
    hide('selected-customer-info');
    searchTimeout = setTimeout(() => searchCustomersForParticipant(e.target.value), 250);
  });

  // Add cost
  $('btn-add-cost').addEventListener('click', () => {
    resetCostForm();
    openModal('modal-cost');
  });

  $('btn-save-cost').addEventListener('click', saveCost);

  // Close modals via close buttons & backdrop
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal || btn.closest('.modal-overlay').id));
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay && !overlay.hasAttribute('data-no-backdrop-close')) {
        closeModal(overlay.id);
      }
    });
  });

  // Password toggle
  document.getElementById('toggle-password')?.addEventListener('click', () => {
    const input = document.getElementById('login-password');
    const eyeOn  = document.getElementById('eye-icon');
    const eyeOff = document.getElementById('eye-off-icon');
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    eyeOn.classList.toggle('hidden', isPass);
    eyeOff.classList.toggle('hidden', !isPass);
  });

  // Remember me - pre-fill email if saved
  const savedEmail = localStorage.getItem('ta_remember_email');
  if (savedEmail) {
    document.getElementById('login-email').value = savedEmail;
    document.getElementById('remember-me').checked = true;
  }
}

// ── UTILITIES ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id)?.classList.remove('hidden');
const hide = id => $(id)?.classList.add('hidden');
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('el-GR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function formatEur(val) {
  if (val === null || val === undefined || val === 0) return '—';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── SORTING & FILTERING ───────────────────────────────────────
const sortState = {};   // { tableId: { col, dir } }
const filterState = {}; // { tableId: { col: value } }

function initSortableTable(tableId, getData, renderFn) {
  const table = document.getElementById(tableId);
  if (!table) return;

  sortState[tableId]  = { col: null, dir: 'asc' };
  filterState[tableId] = {};

  // Sort on header click
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortState[tableId].col === col) {
        sortState[tableId].dir = sortState[tableId].dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState[tableId].col = col;
        sortState[tableId].dir = 'asc';
      }
      updateSortIcons(table, col, sortState[tableId].dir);
      applySortFilter(tableId, getData, renderFn);
    });
  });

  // Filter on input/select change
  table.querySelectorAll('.filter-input').forEach(input => {
    input.addEventListener('input', () => {
      filterState[tableId][input.dataset.col] = input.value;
      applySortFilter(tableId, getData, renderFn);
    });
    input.addEventListener('change', () => {
      filterState[tableId][input.dataset.col] = input.value;
      applySortFilter(tableId, getData, renderFn);
    });
    // Stop header sort from firing when clicking filter row
    input.addEventListener('click', e => e.stopPropagation());
  });
}

function updateSortIcons(table, activeCol, dir) {
  table.querySelectorAll('thead th[data-col] .sort-icon').forEach(icon => {
    const col = icon.closest('th').dataset.col;
    icon.textContent = col === activeCol ? (dir === 'asc' ? '↑' : '↓') : '⇅';
  });
}

function applySortFilter(tableId, getData, renderFn) {
  let rows = [...getData()];

  // Apply filters
  const filters = filterState[tableId] || {};
  for (const [col, val] of Object.entries(filters)) {
    if (!val) continue;
    rows = rows.filter(row => {
      const cellVal = getNestedVal(row, col);
      if (cellVal === null || cellVal === undefined) return false;
      return String(cellVal).toLowerCase().includes(String(val).toLowerCase());
    });
  }

  // Apply sort
  const { col, dir } = sortState[tableId] || {};
  if (col) {
    rows.sort((a, b) => {
      let va = getNestedVal(a, col) ?? '';
      let vb = getNestedVal(b, col) ?? '';
      // numeric
      if (!isNaN(va) && !isNaN(vb) && va !== '' && vb !== '') {
        va = Number(va); vb = Number(vb);
      } else {
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
      }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  renderFn(rows);
}

function getNestedVal(obj, col) {
  // Support customer nested fields like last_name from customers join
  if (col === 'last_name' && obj.customers) return obj.customers.last_name;
  if (col === 'first_name' && obj.customers) return obj.customers.first_name;
  return obj[col];
}

// Wrap render functions to support sort/filter
function renderParticipantsRows(rows) {
  const tbody = document.getElementById('participants-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν συμμετέχοντες.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td>${p.customers ? esc(p.customers.last_name) : '—'}</td>
      <td>${p.customers ? esc(p.customers.first_name) : '—'}</td>
      <td>${p.solo_couple || '—'}</td>
      <td>${p.room_type || '—'}</td>
      <td>${formatEur(p.deposit_amount)}</td>
      <td>${formatEur(p.installment2_amount)}</td>
      <td>${formatEur(p.installment3_amount)}</td>
      <td>${formatEur(p.installment4_amount)}</td>
      <td><span class="${p.balance > 0 ? 'badge badge-yellow' : 'badge badge-green'}">${formatEur(p.balance)}</span></td>
      <td>${formatEur(p.final_payment)}</td>
      <td>
        <button class="btn-icon" onclick="editParticipant('${p.id}')">✏️</button>
        <button class="btn-icon danger" onclick="deleteParticipant('${p.id}')">🗑</button>
      </td>
    </tr>
  `).join('');
}

function renderWaitlistRows(rows) {
  const tbody = document.getElementById('waitlist-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν εφεδρικοί ακόμα.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td>${p.customers ? esc(p.customers.last_name) : '—'}</td>
      <td>${p.customers ? esc(p.customers.first_name) : '—'}</td>
      <td>${p.solo_couple || '—'}</td>
      <td>${p.room_type || '—'}</td>
      <td>${formatEur(p.deposit_amount)}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="promoteFromWaitlist('${p.id}')">→ Μεταφορά</button>
        <button class="btn-icon danger" onclick="deleteParticipant('${p.id}', true)" style="margin-left:.3rem">🗑</button>
      </td>
    </tr>
  `).join('');
}

function renderCostsRows(rows) {
  const tbody = document.getElementById('costs-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν έξοδα ακόμα.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(c => `
    <tr>
      <td>${esc(c.booking_ref || '—')}</td>
      <td>${c.expense_type || '—'}</td>
      <td>${formatEur(c.cost)}</td>
      <td>${formatEur(c.amount_eur)}</td>
      <td>${c.payment_method || '—'}</td>
      <td>${c.entry_date ? formatDate(c.entry_date) : '—'}</td>
      <td><span class="badge ${c.is_paid ? 'badge-green' : 'badge-gray'}">${c.is_paid ? 'Ναι' : 'Όχι'}</span></td>
      <td><span class="badge ${c.has_invoice ? 'badge-green' : 'badge-gray'}">${c.has_invoice ? 'Ναι' : 'Όχι'}</span></td>
      <td>
        <button class="btn-icon" onclick="editCost('${c.id}')">✏️</button>
        <button class="btn-icon danger" onclick="deleteCost('${c.id}')">🗑</button>
      </td>
    </tr>
  `).join('');
}

function renderCustomersRows(rows) {
  const tbody = document.getElementById('customers-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν βρέθηκαν πελάτες.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(c => `
    <tr>
      <td>${esc(c.last_name)}</td>
      <td>${esc(c.first_name)}</td>
      <td>${esc(c.telephone || '—')}</td>
      <td>${esc(c.email || '—')}</td>
      <td>${esc(c.passport_number || '—')}</td>
      <td>${c.expiry_date ? formatDate(c.expiry_date) : '—'}</td>
      <td>
        <button class="btn-icon" onclick="editCustomer('${c.id}')">✏️</button>
        <button class="btn-icon danger" onclick="deleteCustomer('${c.id}')">🗑</button>
      </td>
    </tr>
  `).join('');
}
