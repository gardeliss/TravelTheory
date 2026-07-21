// ============================================================
// TRAVEL AGENCY APP — app.js
// ============================================================

const SUPABASE_URL = 'https://cduyifjlnmwdvulrwozj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdXlpZmpsbm13ZHZ1bHJ3b3pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzgxMzQsImV4cCI6MjA5ODMxNDEzNH0.ekh3MjqZH1QvZMFBKahYAxmTOxITqL2n6b6ExpyzGVw';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ────────────────────────────────────────────────────
const state = {
  user: null,
  userProfile: null,   // { role, custom_permissions }
  users: [],           // for admin user management
  trips: [],
  customers: [],
  currentTrip: null,
  currentParticipants: [],
  currentWaitlist: [],
  currentWaitlist2: [],
  currentCosts: [],
  currentTasks: [],
  currentRooms: [],
  currentLeads: [],
  editingId: null,
  selectedCustomerId: null,
  addingToWaitlist: false,
};

// ── PERMISSIONS ───────────────────────────────────────────────
const DEFAULT_WRITE = {
  admin:  { participants:true, costs:true, financials:true, pricing:true, tasks:true, rooms:true, receipts:true, customers:true, waitlist:true },
  leader: { participants:false, costs:false, financials:false, pricing:false, tasks:true, rooms:false, receipts:false, customers:true, waitlist:false },
  user:   { participants:false, costs:false, financials:false, pricing:false, tasks:false, rooms:false, receipts:false, customers:true, waitlist:false },
};

function canWrite(tab) {
  const profile = state.userProfile;
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const defaults = DEFAULT_WRITE[profile.role] || {};
  const custom   = profile.custom_permissions  || {};
  return !!(defaults[tab] || custom[tab]);
}

function isAdmin() { return state.userProfile?.role === 'admin'; }

async function loadUserProfile() {
  const { data, error } = await db
    .from('user_profiles')
    .select('role, custom_permissions')
    .eq('id', state.user.id)
    .single();

  if (error || !data) {
    console.warn('Profile not found, creating default admin profile...');
    // Auto-create profile as admin if missing (first user scenario)
    const { data: inserted, error: insertError } = await db
      .from('user_profiles')
      .upsert({ id: state.user.id, email: state.user.email, role: 'admin' })
      .select('role, custom_permissions')
      .single();

    if (insertError) {
      console.error('Profile create error:', insertError);
      // Last resort fallback — treat as admin so app is usable
      state.userProfile = { role: 'admin', custom_permissions: {} };
    } else {
      state.userProfile = inserted;
    }
    return;
  }
  state.userProfile = data;
}

// Εισπράξεις (trip_participants)
const INCOME_BANK_METHODS = ['ALPHA','EUROBANK','ΕΘΝΙΚΗ','REVOLUT','E-POS'];
const INCOME_CASH_METHODS = ['ΜΕΤΡΗΤΑ','ΜΕΤΡΗΤΑ (ΑΠΟΔΕΙΞΗ)'];

// Έξοδα (trip_costs)
const EXPENSE_BANK_METHODS = [
  'ALPHA (ΕΜΒΑΣΜΑ)','ALPHA (ΚΑΡΤΑ)',
  'EUROBANK (ΕΜΒΑΣΜΑ)','EUROBANK (ΚΑΡΤΑ)',
  'ΕΘΝΙΚΗ (ΕΜΒΑΣΜΑ)','ΕΘΝΙΚΗ (ΚΑΡΤΑ)',
  'REVOLUT (ΕΜΒΑΣΜΑ)','REVOLUT (ΚΑΡΤΑ)'
];
const EXPENSE_CASH_METHODS = ['ΜΕΤΡΗΤΑ'];

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

async function enterApp() {
  await loadUserProfile();
  setText('user-email-display', state.user.email);

  // Show/hide admin-only nav items
  const usersNav = document.getElementById('nav-users');
  if (usersNav) usersNav.style.display = isAdmin() ? '' : 'none';

  showScreen('app');
  navigateTo('trips');
}

// ── NAVIGATION ───────────────────────────────────────────────
function navigateTo(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  if (view === 'trips') {
    show('view-trips');
    document.querySelector('[data-view="trips"]')?.classList.add('active');
    loadTrips();
  } else if (view === 'customers') {
    show('view-customers');
    document.querySelector('[data-view="customers"]')?.classList.add('active');
    // Hide write actions if no permission
    const btnNew = document.getElementById('btn-new-customer');
    if (btnNew) btnNew.style.display = canWrite('customers') ? '' : 'none';
    loadCustomers();
    initSortableTable('customers-table', () => state.customers, renderCustomersRows);
  } else if (view === 'trip-detail') {
    show('view-trip-detail');
  } else if (view === 'users') {
    if (!isAdmin()) return toast('Δεν έχετε πρόσβαση', 'error');
    show('view-users');
    document.querySelector('[data-view="users"]')?.classList.add('active');
    loadUsers();
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
      <div class="trip-card-header-row">
        <div class="trip-card-title">${esc(t.title)}</div>
        <button class="trip-card-delete" onclick="deleteTrip('${t.id}', event)" title="Διαγραφή ταξιδιού">🗑</button>
      </div>
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
  loadAllTabCounts();
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

// ── DELETE TRIP ──────────────────────────────────────────────
async function deleteTrip(id, e) {
  e.stopPropagation(); // prevent opening the trip

  // Check if trip has any data in any tab
  const [parts, costs, leads, waitlist, tasks] = await Promise.all([
    db.from('trip_participants').select('id', { count:'exact', head:true }).eq('trip_id', id),
    db.from('trip_costs').select('id', { count:'exact', head:true }).eq('trip_id', id),
    db.from('trip_leads').select('id', { count:'exact', head:true }).eq('trip_id', id),
    db.from('trip_waitlist').select('id', { count:'exact', head:true }).eq('trip_id', id),
    db.from('trip_tasks').select('id').eq('trip_id', id).eq('is_done', true),
  ]);

  const totalData = (parts.count||0) + (costs.count||0) + (leads.count||0) + (waitlist.count||0) + (tasks.data?.length||0);

  if (totalData > 0) {
    alert('Το ταξίδι περιέχει δεδομένα και δεν μπορεί να διαγραφεί. Διαγράψτε πρώτα όλες τις εγγραφές από τα tabs (Συμμετέχοντες, Έξοδα, Ενδιαφερόμενοι, Λίστα Αναμονής) για να μπορέσετε να διαγράψετε το ταξίδι.');
    return;
  }

  if (!confirm('Διαγραφή ταξιδιού; Η ενέργεια δεν αναιρείται.')) return;

  const { error } = await db.from('trips').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  toast('Το ταξίδι διαγράφηκε', 'success');
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
    date_of_birth:   $('cust-dob').value || null,
    passport_number: $('cust-passport').value.trim(),
    nationality:     $('cust-nationality').value,
    issue_date:      $('cust-issue-date').value || null,
    expiry_date:     $('cust-expiry-date').value || null,
    telephone:       $('cust-telephone').value.trim(),
    email:           $('cust-email').value.trim(),
    afm:             $('cust-afm').value.trim()          || null,
    address:         $('cust-address').value.trim()      || null,
    postal_code:     $('cust-postal-code').value.trim()  || null,
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
  $('cust-afm').value          = c.afm         || '';
  $('cust-address').value      = c.address     || '';
  $('cust-postal-code').value  = c.postal_code || '';
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
    .select('*, customers(first_name, last_name, date_of_birth, passport_number, nationality, issue_date, expiry_date, telephone)')
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', false)
    .order('sort_order', { ascending: true, nullsFirst: true })
    .order('group_id',   { ascending: true, nullsFirst: false })
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης συμμετεχόντων', 'error');
  state.currentParticipants = data || [];
  renderParticipants();
  updateParticipantCount();
  updateTabCount('participants', state.currentParticipants.length);
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
  renderParticipantsGrouped(state.currentParticipants);
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

  // final_payment defaults to price_full
  const finalPaymentRaw = document.getElementById('part-final-payment').value;
  const final_payment = finalPaymentRaw !== ''
    ? parseInt(finalPaymentRaw)
    : (state.currentTrip?.price_full || 0);

  // balance = final_payment - total paid
  const balance = Math.max(0, final_payment - totalPaid);

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
    final_payment,
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
    .order('sort_order', { ascending: true, nullsFirst: true })
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης εξόδων', 'error');
  state.currentCosts = data || [];
  renderCosts();
}

function renderCosts() {
  renderCostsInline(state.currentCosts);
  renderCostsSummary();
}

async function renderCostsSummary() {
  const el = document.getElementById('costs-summary');
  if (!el) return;

  const trip  = state.currentTrip;
  const costs = state.currentCosts;

  const totalBudget   = costs.reduce((s, c) => s + (c.cost       || 0), 0);
  const totalActualExp = costs.reduce((s, c) => s + (c.amount_eur || 0), 0);

  // Count participants from DB
  const { count } = await db
    .from('trip_participants')
    .select('*', { count: 'exact', head: true })
    .eq('trip_id', trip.id)
    .eq('is_waitlist', false);
  const numParticipants = count || 0;

  const pricePerPerson = trip.price_full || 0;
  const estRevenue     = pricePerPerson * numParticipants;
  const estProfit      = estRevenue - totalBudget;

  // Actual revenue = sum of installments
  let actualRevenue = 0;
  if (state.currentParticipants.length > 0) {
    actualRevenue = state.currentParticipants.reduce((s, p) =>
      s + (p.deposit_amount||0) + (p.installment2_amount||0) +
          (p.installment3_amount||0) + (p.installment4_amount||0), 0);
  } else {
    const { data: parts } = await db.from('trip_participants')
      .select('deposit_amount,installment2_amount,installment3_amount,installment4_amount')
      .eq('trip_id', trip.id).eq('is_waitlist', false);
    if (parts) actualRevenue = parts.reduce((s, p) =>
      s + (p.deposit_amount||0) + (p.installment2_amount||0) +
          (p.installment3_amount||0) + (p.installment4_amount||0), 0);
  }

  const actualProfit = actualRevenue - totalActualExp;
  const fmt = v => new Intl.NumberFormat('el-GR', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v);
  const col = v => v >= 0 ? '#15803d' : '#dc2626';

  el.innerHTML = `
    <div class="costs-summary-grid">
      <div class="costs-summary-card">
        <div class="costs-summary-label">Σύνολο Budget (ΚΟΣΤΟΣ)</div>
        <div class="costs-summary-value">${fmt(totalBudget)}</div>
        <div class="costs-summary-divider"></div>
        <div class="costs-summary-label">Estimated Revenue</div>
        <div class="costs-summary-sub">${fmt(pricePerPerson)} × ${numParticipants} άτομα</div>
        <div class="costs-summary-value">${fmt(estRevenue)}</div>
        <div class="costs-summary-divider"></div>
        <div class="costs-summary-label">Estimated Profit</div>
        <div class="costs-summary-value" style="color:${col(estProfit)};font-size:1.3rem">${fmt(estProfit)}</div>
      </div>
      <div class="costs-summary-spacer"></div>
      <div class="costs-summary-card">
        <div class="costs-summary-label">Σύνολο Actual Expenses (€)</div>
        <div class="costs-summary-value">${fmt(totalActualExp)}</div>
        <div class="costs-summary-divider"></div>
        <div class="costs-summary-label">Actual Revenue (Σύνολο Δόσεων)</div>
        <div class="costs-summary-value">${fmt(actualRevenue)}</div>
        <div class="costs-summary-divider"></div>
        <div class="costs-summary-label">Actual Profit (Μικτό Κέρδος)</div>
        <div class="costs-summary-value" style="color:${col(actualProfit)};font-size:1.3rem">${fmt(actualProfit)}</div>
      </div>
    </div>
  `;
}

async function saveCost() {
  const payload = {
    trip_id:        state.currentTrip.id,
    sort_order:     state.currentCosts.length,
    booking_ref:    $('cost-booking-ref').value.trim()    || null,
    payment_date:   $('cost-payment-date').value          || null,
    comments:       $('cost-comments').value.trim()       || null,
    cost:           parseInt($('cost-cost').value)        || 0,
    expense_type:   $('cost-expense-type').value.trim()   || null,
    local_currency: $('cost-local-currency').value.trim() || null,
    amount_eur:     parseInt($('cost-amount-eur').value)  || 0,
    payment_method: $('cost-payment-method').value        || null,
    entry_date:     $('cost-entry-date').value            || null,
    is_paid:        $('cost-is-paid').value               || null,
    has_invoice:    $('cost-has-invoice').checked,
    invoice_name:   $('cost-invoice-name').value.trim()   || null,
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
  $('cost-payment-date').value    = c.payment_date   || '';
  $('cost-comments').value        = c.comments       || '';
  $('cost-cost').value            = c.cost           || '';
  $('cost-expense-type').value    = c.expense_type   || '';
  $('cost-local-currency').value  = c.local_currency || '';
  $('cost-amount-eur').value      = c.amount_eur     || '';
  $('cost-payment-method').value  = c.payment_method || '';
  $('cost-entry-date').value      = c.entry_date     || '';
  $('cost-is-paid').value         = c.is_paid        || '';
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
  const pricingW = canWrite('pricing');
  $('pricing-content').innerHTML = `
    <div class="pricing-card">
      <label>Full Price</label>
      <input type="number" id="price-full" value="${t.price_full || ''}" min="0" placeholder="0" ${!pricingW ? 'disabled' : ''} />
    </div>
    <div class="pricing-card">
      <label>No Flight</label>
      <input type="number" id="price-no-flight" value="${t.price_no_flight || ''}" min="0" placeholder="0" ${!pricingW ? 'disabled' : ''} />
    </div>
    <div class="pricing-card">
      <label>Single Supplement</label>
      <input type="number" id="price-single-supp" value="${t.price_single_supp || ''}" min="0" placeholder="0" ${!pricingW ? 'disabled' : ''} />
    </div>
    ${pricingW ? `<div style="grid-column:1/-1">
      <button class="btn btn-primary pricing-save-btn" onclick="savePricing()">Αποθήκευση Τιμών</button>
    </div>` : ''}
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
  const w = canWrite('tasks');
  container.innerHTML = state.currentTasks.map(t => `
    <div class="task-item ${t.is_done ? 'done' : ''}" id="task-row-${t.id}">
      <input class="task-checkbox" type="checkbox" ${t.is_done ? 'checked' : ''}
             ${w ? `onchange="updateTask('${t.id}', 'is_done', this.checked)"` : 'disabled'} />
      <span class="task-label">${esc(t.task_label)}</span>
      <div class="task-date">
        <input type="date" value="${t.task_date || ''}"
               ${w ? `onchange="updateTask('${t.id}', 'task_date', this.value)"` : 'disabled'}
               ${!w ? 'style="pointer-events:none;opacity:.6"' : ''} />
      </div>
      <div class="task-comments">
        <input type="text" value="${esc(t.comments || '')}" placeholder="Σημειώσεις..."
               ${w ? `onblur="updateTask('${t.id}', 'comments', this.value)"` : 'disabled readonly'}
               ${!w ? 'style="opacity:.6"' : ''} />
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



// ── USER MANAGEMENT ───────────────────────────────────────────
const TABS_LIST = [
  { key: 'participants', label: 'Συμμετέχοντες' },
  { key: 'costs',        label: 'Έξοδα' },
  { key: 'financials',   label: 'Λογιστική' },
  { key: 'pricing',      label: 'Τιμές' },
  { key: 'tasks',        label: 'Tasks' },
  { key: 'rooms',        label: 'Room Plan' },
  { key: 'receipts',     label: 'Αποδείξεις/Τιμολόγια' },
  { key: 'waitlist',     label: 'Εφεδρικοί' },
  { key: 'customers',    label: 'Πελατολόγιο' },
];

const ROLE_LABELS = { admin: 'Admin', leader: 'Leader', user: 'User' };
const ROLE_BADGE  = { admin: 'badge-danger', leader: 'badge-blue', user: 'badge-gray' };

async function loadUsers() {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, email, full_name, role, custom_permissions, created_at')
    .order('full_name');
  if (error) return toast('Σφάλμα φόρτωσης χρηστών', 'error');
  state.users = data || [];
  renderUsers();
}

function renderUsers() {
  const container = document.getElementById('users-list');
  if (!container) return;
  if (!state.users.length) {
    container.innerHTML = '<p style="color:var(--text3);padding:1rem">Δεν βρέθηκαν χρήστες.</p>';
    return;
  }
  container.innerHTML = state.users.map(u => {
    const isSelf = u.id === state.user.id;
    const cp = u.custom_permissions || {};
    const extraTabs = TABS_LIST.filter(t => cp[t.key]).map(t => t.label).join(', ');
    return `
      <div class="user-card">
        <div class="user-card-avatar">${esc(u.full_name || u.email).charAt(0).toUpperCase()}</div>
        <div class="user-card-info">
          <div class="user-card-name">${esc(u.full_name || '—')}</div>
          <div class="user-card-email">${esc(u.email)}</div>
          ${extraTabs ? `<div class="user-card-extra">+Write: ${extraTabs}</div>` : ''}
        </div>
        <div class="user-card-right">
          <span class="badge ${ROLE_BADGE[u.role] || 'badge-gray'}">${ROLE_LABELS[u.role] || u.role}</span>
          <div class="user-card-actions">
            ${!isSelf ? `
              <button class="btn btn-sm btn-secondary" onclick="openEditUser('${u.id}')">Επεξ.</button>
              <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">Διαγ.</button>
            ` : '<span class="user-self-badge">Εσείς</span>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openNewUser() {
  state.editingId = null;
  setText('modal-user-title', 'Νέος Χρήστης');
  document.getElementById('user-full-name').value = '';
  document.getElementById('user-email').value     = '';
  document.getElementById('user-password').value  = '';
  document.getElementById('user-role').value      = 'user';
  document.getElementById('user-email').disabled  = false;
  document.getElementById('user-password-row').style.display = '';
  renderPermissionCheckboxes({});
  openModal('modal-user');
}

function openEditUser(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  state.editingId = id;
  setText('modal-user-title', 'Επεξεργασία Χρήστη');
  document.getElementById('user-full-name').value = u.full_name || '';
  document.getElementById('user-email').value     = u.email;
  document.getElementById('user-role').value      = u.role;
  document.getElementById('user-email').disabled  = true;
  document.getElementById('user-password-row').style.display = 'none';
  renderPermissionCheckboxes(u.custom_permissions || {});
  openModal('modal-user');
}

function renderPermissionCheckboxes(current) {
  const role     = document.getElementById('user-role').value;
  const defaults = DEFAULT_WRITE[role] || {};
  const container = document.getElementById('permissions-grid');
  if (!container) return;

  container.innerHTML = TABS_LIST.map(t => {
    const isDefault  = !!defaults[t.key];
    const isCustom   = !!current[t.key];
    const isChecked  = isDefault || isCustom;
    const isDisabled = isDefault || role === 'admin';
    return `
      <label class="perm-checkbox ${isDisabled ? 'perm-default' : ''}">
        <input type="checkbox" data-tab="${t.key}"
               ${isChecked  ? 'checked'  : ''}
               ${isDisabled ? 'disabled' : ''} />
        <span>${t.label}</span>
        ${isDefault ? '<span class="perm-tag">default</span>' : ''}
      </label>
    `;
  }).join('');
}

async function saveUser() {
  const role      = document.getElementById('user-role').value;
  const email     = document.getElementById('user-email').value.trim();
  const full_name = document.getElementById('user-full-name').value.trim();

  const defaults = DEFAULT_WRITE[role] || {};
  const custom   = {};
  document.querySelectorAll('#permissions-grid input[type="checkbox"]').forEach(cb => {
    const tab = cb.dataset.tab;
    if (cb.checked && !defaults[tab]) custom[tab] = true;
  });

  if (state.editingId) {
    const { error } = await db.from('user_profiles')
      .update({ full_name, role, custom_permissions: custom })
      .eq('id', state.editingId);
    if (error) return toast('Σφάλμα αποθήκευσης', 'error');
    toast('Χρήστης ενημερώθηκε', 'success');

  } else {
    if (!email)     return toast('Εισάγετε email', 'error');
    if (!full_name) return toast('Εισάγετε ονοματεπώνυμο', 'error');
    const password = document.getElementById('user-password').value;
    if (!password || password.length < 6) return toast('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες', 'error');

    const { data: { session } } = await db.auth.getSession();
    const accessToken = session?.access_token;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify({ email, password, full_name, role, custom_permissions: custom }),
    });

    const result = await res.json();
    if (!res.ok || result.error) {
      toast('Σφάλμα: ' + (result.error || 'Άγνωστο σφάλμα'), 'error');
      return;
    }
    toast('Χρήστης δημιουργήθηκε', 'success');
  }

  closeModal('modal-user');
  loadUsers();
}

async function deleteUser(id) {
  if (!confirm('Διαγραφή χρήστη; Η ενέργεια δεν αναιρείται.')) return;
  const { error } = await db.from('user_profiles').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  toast('Χρήστης διαγράφηκε', 'success');
  loadUsers();
}

// ── ROOMS ─────────────────────────────────────────────────────
async function loadRooms() {
  const { data, error } = await db
    .from('room_plan')
    .select('*')
    .eq('trip_id', state.currentTrip.id)
    .order('room_number');

  if (error) return toast('Σφάλμα φόρτωσης δωματίων', 'error');
  state.currentRooms = data || [];

  // Also load full participant list per room
  await loadRoomsWithParticipants();
}

async function loadRoomsWithParticipants() {
  const { data: participants, error } = await db
    .from('trip_participants')
    .select('id, room_id, customers(first_name, last_name), solo_couple')
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', false);

  if (error) return toast('Σφάλμα φόρτωσης', 'error');

  renderRooms(participants || []);
}

function renderRooms(participants) {
  const container = document.getElementById('rooms-content');
  if (!container) return;

  if (!state.currentRooms.length) {
    container.innerHTML = `
      <div class="rooms-empty">
        <p>Δεν υπάρχουν δωμάτια ακόμα.</p>
        <p style="color:var(--text3);font-size:.85rem;margin-top:.3rem">Πατήστε "+ Νέο Δωμάτιο" για να ξεκινήσετε.</p>
      </div>`;
    return;
  }

  const ROOM_ICONS = { SINGLE: '🛏', TWIN: '🛏🛏', DOUBLE: '💑', TRIPLE: '👨‍👩‍👦' };
  const STATUS_CLASS = { 'ΠΛΗΡΕΣ': 'badge-green', 'ΜΕΡΙΚΩΣ': 'badge-yellow', 'ΑΔΕΙΟ': 'badge-gray', 'ΥΠΕΡΑΡΙΘΜΟ': 'badge-danger' };

  // Summary bar
  const total    = state.currentRooms.length;
  const full     = state.currentRooms.filter(r => r.status === 'ΠΛΗΡΕΣ').length;
  const partial  = state.currentRooms.filter(r => r.status === 'ΜΕΡΙΚΩΣ').length;
  const empty    = state.currentRooms.filter(r => r.status === 'ΑΔΕΙΟ').length;
  const totalOcc = state.currentRooms.reduce((s, r) => s + Number(r.current_occupancy), 0);

  container.innerHTML = `
    <div class="rooms-summary">
      <div class="rooms-summary-item"><span class="rooms-summary-label">Σύνολο Δωματίων</span><span class="rooms-summary-value">${total}</span></div>
      <div class="rooms-summary-item"><span class="rooms-summary-label">Πλήρη</span><span class="rooms-summary-value" style="color:var(--success)">${full}</span></div>
      <div class="rooms-summary-item"><span class="rooms-summary-label">Μερικώς</span><span class="rooms-summary-value" style="color:var(--warning)">${partial}</span></div>
      <div class="rooms-summary-item"><span class="rooms-summary-label">Άδεια</span><span class="rooms-summary-value" style="color:var(--text3)">${empty}</span></div>
      <div class="rooms-summary-item"><span class="rooms-summary-label">Σύνολο Ατόμων</span><span class="rooms-summary-value">${totalOcc}</span></div>
    </div>
    <div class="rooms-grid">
      ${state.currentRooms.map(room => {
        const roomParticipants = participants.filter(p => p.room_id === room.room_id);
        const spotsLeft = Number(room.available_spots);
        const icon = ROOM_ICONS[room.room_type] || '🛏';
        const statusClass = STATUS_CLASS[room.status] || 'badge-gray';

        return `
          <div class="room-card">
            <div class="room-card-header">
              <div class="room-card-title">
                <span class="room-icon">${icon}</span>
                <span>Δωμάτιο ${esc(room.room_number)}</span>
                <span class="badge ${statusClass}" style="margin-left:.5rem">${room.status}</span>
              </div>
              <div class="room-card-actions">
                <button class="btn-icon" onclick="editRoom('${room.room_id}')">✏️</button>
                <button class="btn-icon danger" onclick="deleteRoom('${room.room_id}')">🗑</button>
              </div>
            </div>
            <div class="room-card-type">${room.room_type} — ${room.current_occupancy}/${room.max_occupancy} άτομα</div>
            ${room.notes ? `<div class="room-card-notes">${esc(room.notes)}</div>` : ''}
            <div class="room-participants">
              ${roomParticipants.length
                ? roomParticipants.map(p => `
                    <div class="room-participant-row">
                      <span class="room-participant-name">
                        ${p.customers ? esc(p.customers.last_name) + ' ' + esc(p.customers.first_name) : '—'}
                      </span>
                      <span class="badge badge-gray" style="font-size:.72rem">${p.solo_couple || ''}</span>
                      <button class="btn-icon danger" style="margin-left:auto" onclick="removeFromRoom('${p.id}')" title="Αφαίρεση από δωμάτιο">✕</button>
                    </div>`).join('')
                : '<div class="room-participant-empty">Κανένας συμμετέχων ακόμα</div>'
              }
              ${spotsLeft > 0
                ? `<button class="room-add-btn" onclick="openAddToRoom('${room.room_id}')">+ Προσθήκη ατόμου (${spotsLeft} θέσεις)</button>`
                : ''
              }
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function saveRoom() {
  const number = document.getElementById('room-number').value.trim();
  const type   = document.getElementById('room-type').value;
  const notes  = document.getElementById('room-notes').value.trim();

  if (!number || !type) return toast('Συμπληρώστε αριθμό και τύπο δωματίου', 'error');

  const payload = { trip_id: state.currentTrip.id, room_number: number, room_type: type, notes: notes || null };

  let error;
  if (state.editingId) {
    ({ error } = await db.from('trip_rooms').update(payload).eq('id', state.editingId));
  } else {
    ({ error } = await db.from('trip_rooms').insert(payload));
  }

  if (error) return toast('Σφάλμα' + (error.message?.includes('unique') ? ': Υπάρχει ήδη δωμάτιο με αυτόν τον αριθμό' : ''), 'error');
  toast(state.editingId ? 'Δωμάτιο ενημερώθηκε' : 'Δωμάτιο δημιουργήθηκε', 'success');
  closeModal('modal-room');
  loadRooms();
}

async function editRoom(id) {
  const room = state.currentRooms.find(r => r.room_id === id);
  if (!room) return;
  state.editingId = id;
  setText('modal-room-title', 'Επεξεργασία Δωματίου');
  document.getElementById('room-number').value = room.room_number || '';
  document.getElementById('room-type').value   = room.room_type   || '';
  document.getElementById('room-notes').value  = room.notes       || '';
  openModal('modal-room');
}

async function deleteRoom(id) {
  if (!confirm('Διαγραφή δωματίου; Οι συμμετέχοντες δεν θα διαγραφούν, απλώς θα αποσυνδεθούν.')) return;
  const { error } = await db.from('trip_rooms').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  toast('Δωμάτιο διαγράφηκε', 'success');
  loadRooms();
}

async function removeFromRoom(participantId) {
  const { error } = await db.from('trip_participants').update({ room_id: null }).eq('id', participantId);
  if (error) return toast('Σφάλμα', 'error');
  loadRooms();
}

// Open modal to assign an unassigned participant to a room
async function openAddToRoom(roomId) {
  // Get unassigned participants for this trip
  const { data, error } = await db
    .from('trip_participants')
    .select('id, customers(first_name, last_name)')
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', false)
    .is('room_id', null);

  if (error) return toast('Σφάλμα', 'error');

  const select = document.getElementById('assign-participant-select');
  if (!data.length) {
    toast('Δεν υπάρχουν αδιάθετοι συμμετέχοντες', 'error');
    return;
  }

  select.innerHTML = '<option value="">— Επιλογή —</option>' +
    data.map(p => `<option value="${p.id}">${p.customers ? esc(p.customers.last_name) + ' ' + esc(p.customers.first_name) : p.id}</option>`).join('');

  document.getElementById('assign-room-id').value = roomId;
  openModal('modal-assign-room');
}

async function saveRoomAssignment() {
  const participantId = document.getElementById('assign-participant-select').value;
  const roomId        = document.getElementById('assign-room-id').value;
  if (!participantId) return toast('Επιλέξτε συμμετέχοντα', 'error');

  const { error } = await db.from('trip_participants').update({ room_id: roomId }).eq('id', participantId);
  if (error) return toast('Σφάλμα ανάθεσης', 'error');
  toast('Ανατέθηκε', 'success');
  closeModal('modal-assign-room');
  loadRooms();
}

function resetRoomForm() {
  ['room-number','room-type','room-notes'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  setText('modal-room-title', 'Νέο Δωμάτιο');
  state.editingId = null;
}

// Populate room dropdown in participant modal
async function populateRoomDropdown() {
  const select = document.getElementById('part-room-id');
  if (!select) return;
  const { data } = await db.from('trip_rooms').select('id, room_number, room_type').eq('trip_id', state.currentTrip.id).order('room_number');
  select.innerHTML = '<option value="">— Χωρίς δωμάτιο —</option>' +
    (data || []).map(r => `<option value="${r.id}">${r.room_number} (${r.room_type})</option>`).join('');
}


// ── RECEIPTS ──────────────────────────────────────────────────
async function loadReceipts() {
  const { data, error } = await db
    .from('trip_participants')
    .select(`
      id, receipt_address, receipt_postal_code,
      receipt_amount, receipt_type, receipt_number,
      customers(first_name, last_name, afm, address, postal_code)
    `)
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', false)
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης', 'error');
  renderReceipts(data || []);
}

function renderReceipts(rows) {
  const tbody = document.getElementById('receipts-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν συμμετέχοντες.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((p, idx) => {
    const c = p.customers || {};
    // Use override if set, else fall back to customer data
    const addr       = p.receipt_address     || c.address     || '';
    const postalCode = p.receipt_postal_code || c.postal_code || '';

    return `
      <tr>
        <td style="text-align:center;color:var(--text3);font-size:.8rem">${idx + 1}</td>
        <td>${esc(c.first_name || '—')}</td>
        <td>${esc(c.last_name  || '—')}</td>
        <td>${esc(c.afm        || '—')}</td>
        <td>${esc(addr         || '—')}</td>
        <td>${esc(postalCode   || '—')}</td>
        <td>${p.receipt_amount ? formatEur(p.receipt_amount) : '—'}</td>
        <td>
          ${p.receipt_type
            ? `<span class="badge ${p.receipt_type === 'ΤΙΜΟΛΟΓΙΟ' ? 'badge-blue' : 'badge-gray'}">${p.receipt_type}</span>`
            : '—'}
        </td>
        <td>${esc(p.receipt_number || '—')}</td>
        <td>
          ${canWrite('receipts') ? `<button class="btn-icon" onclick="editReceipt('${p.id}')">✏️</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

async function editReceipt(participantId) {
  // Load participant + customer data
  const { data, error } = await db
    .from('trip_participants')
    .select(`
      id, receipt_address, receipt_postal_code,
      receipt_amount, receipt_type, receipt_number,
      customers(first_name, last_name, afm, address, postal_code)
    `)
    .eq('id', participantId)
    .single();

  if (error) return toast('Σφάλμα φόρτωσης', 'error');

  const c = data.customers || {};
  state.editingId = participantId;

  // Header with name
  setText('modal-receipt-name', `${c.last_name || ''} ${c.first_name || ''}`);

  // Pre-fill from customer, allow override
  document.getElementById('receipt-afm').value          = c.afm          || '';
  document.getElementById('receipt-address').value      = data.receipt_address     || c.address     || '';
  document.getElementById('receipt-postal-code').value  = data.receipt_postal_code || c.postal_code || '';
  document.getElementById('receipt-amount').value       = data.receipt_amount      || '';
  document.getElementById('receipt-type').value         = data.receipt_type        || '';
  document.getElementById('receipt-number').value       = data.receipt_number      || '';

  // Store original customer values for reset
  document.getElementById('receipt-address').dataset.original     = c.address     || '';
  document.getElementById('receipt-postal-code').dataset.original = c.postal_code || '';

  openModal('modal-receipt');
}

async function saveReceipt() {
  const participantId = state.editingId;
  if (!participantId) return;

  const address    = document.getElementById('receipt-address').value.trim();
  const postalCode = document.getElementById('receipt-postal-code').value.trim();

  // Only save override if different from customer original
  const origAddress = document.getElementById('receipt-address').dataset.original     || '';
  const origPostal  = document.getElementById('receipt-postal-code').dataset.original || '';

  const payload = {
    receipt_address:     address    !== origAddress ? address    : null,
    receipt_postal_code: postalCode !== origPostal  ? postalCode : null,
    receipt_amount:      parseInt(document.getElementById('receipt-amount').value) || 0,
    receipt_type:        document.getElementById('receipt-type').value   || null,
    receipt_number:      document.getElementById('receipt-number').value.trim() || null,
  };

  const { error } = await db.from('trip_participants').update(payload).eq('id', participantId);
  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  toast('Αποθηκεύτηκε', 'success');
  closeModal('modal-receipt');
  loadReceipts();
}


// ── LEADS (Ενδιαφερόμενοι) ────────────────────────────────────
async function loadLeads() {
  const { data, error } = await db
    .from('trip_leads')
    .select('*')
    .eq('trip_id', state.currentTrip.id)
    .order('sort_order', { ascending: true, nullsFirst: true })
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης ενδιαφερομένων', 'error');
  state.currentLeads = data || [];
  renderLeads();
  updateTabCount('leads', state.currentLeads.length);
}

function renderLeads() {
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;
  const w = canWrite('participants');

  if (!state.currentLeads.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν ενδιαφερόμενοι ακόμα.</td></tr>';
    return;
  }

  function cell(lead, field, type) {
    const val = lead[field] ?? '';
    if (!w) {
      if (type === 'date') return `<td>${val ? formatDate(val) : '—'}</td>`;
      if (type === 'num')  return `<td>${val || '—'}</td>`;
      return `<td>${esc(val || '—')}</td>`;
    }
    if (type === 'date') {
      return `<td><input type="date" class="inline-input" value="${val}"
        onchange="inlineSaveLead('${lead.id}','${field}',this.value)" /></td>`;
    }
    if (type === 'time') {
      return `<td><input type="time" class="inline-input" value="${val}"
        onchange="inlineSaveLead('${lead.id}','${field}',this.value)" /></td>`;
    }
    if (type === 'num') {
      return `<td><input type="number" class="inline-input inline-num" value="${val||''}" placeholder="1"
        onblur="inlineSaveLead('${lead.id}','${field}',this.value)" /></td>`;
    }
    return `<td><input type="text" class="inline-input" value="${esc(val)}"
      style="min-width:90px"
      onblur="inlineSaveLead('${lead.id}','${field}',this.value)" /></td>`;
  }

  tbody.innerHTML = state.currentLeads.map((lead, idx) => `
    <tr data-id="${lead.id}" data-sort="${lead.sort_order??idx}" class="lead-row">
      <td class="drag-handle lead-drag">⠿</td>
      ${cell(lead,'last_name','text')}
      ${cell(lead,'first_name','text')}
      ${cell(lead,'email','text')}
      ${cell(lead,'telephone','text')}
      ${cell(lead,'date_of_birth','date')}
      ${cell(lead,'num_persons','num')}
      ${cell(lead,'deadline','date')}
      ${cell(lead,'deadline_time','time')}
      ${cell(lead,'comments','text')}
      <td style="white-space:nowrap">
        ${w ? `
          <button class="btn btn-sm btn-primary" onclick="promoteLeadToParticipant('${lead.id}')" title="Μεταφορά στη λίστα">→</button>
          <button class="btn-icon danger" onclick="deleteLead('${lead.id}')">🗑</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  if (w) initLeadsDragAndDrop();
}

async function inlineSaveLead(id, field, value) {
  const numFields = ['num_persons'];
  const parsed = numFields.includes(field)
    ? (parseInt(value)||1)
    : (value === '' ? null : value);

  const { error } = await db.from('trip_leads').update({ [field]: parsed }).eq('id', id);
  if (error) toast('Σφάλμα αποθήκευσης', 'error');

  const lead = state.currentLeads.find(x => x.id === id);
  if (lead) lead[field] = parsed;
}

function openLeadModal() {
  // Reset form
  ['lead-first-name','lead-last-name','lead-email','lead-telephone','lead-dob']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  // Reset search
  const si = document.getElementById('lead-customer-search');
  if (si) si.value = '';
  const sr = document.getElementById('lead-customer-results');
  if (sr) { sr.innerHTML = ''; sr.classList.add('hidden'); }
  document.getElementById('modal-lead').classList.remove('hidden');
}

async function saveLeadModal() {
  const firstName = document.getElementById('lead-first-name').value.trim();
  const lastName  = document.getElementById('lead-last-name').value.trim();
  const email     = document.getElementById('lead-email').value.trim();
  const telephone = document.getElementById('lead-telephone').value.trim();

  // Load current participants with customer data to check for duplicates
  const { data: parts } = await db
    .from('trip_participants')
    .select('customers(first_name, last_name, email, telephone)')
    .eq('trip_id', state.currentTrip.id)
    .eq('is_waitlist', false);

  if (parts) {
    for (const p of parts) {
      const c = p.customers;
      if (!c) continue;

      // Check if selected from customer list (email match)
      if (email && c.email && c.email.toLowerCase() === email.toLowerCase()) {
        return toast(`Ο πελάτης "${c.last_name} ${c.first_name}" βρίσκεται ήδη στο ταξίδι.`, 'error');
      }

      // Check name + telephone match
      const nameMatch = lastName && firstName &&
        c.last_name?.toLowerCase() === lastName.toLowerCase() &&
        c.first_name?.toLowerCase() === firstName.toLowerCase();
      const telMatch = telephone && c.telephone &&
        c.telephone.replace(/\s/g,'') === telephone.replace(/\s/g,'');

      if (nameMatch && telMatch) {
        return toast(`Ο πελάτης "${lastName} ${firstName}" βρίσκεται ήδη στο ταξίδι.`, 'error');
      }
    }
  }

  const payload = {
    trip_id:       state.currentTrip.id,
    first_name:    firstName || null,
    last_name:     lastName  || null,
    email:         email     || null,
    telephone:     telephone || null,
    date_of_birth: document.getElementById('lead-dob').value || null,
    num_persons:   1,
    sort_order:    state.currentLeads.length,
  };

  const { data, error } = await db.from('trip_leads').insert(payload).select().single();
  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  document.getElementById('modal-lead').classList.add('hidden');
  state.currentLeads.push(data);
  renderLeads();
  toast('Αποθηκεύτηκε', 'success');
}

async function searchCustomersForLead(query) {
  if (query.length < 2) {
    document.getElementById('lead-customer-results').classList.add('hidden');
    return;
  }
  const { data } = await db.from('customers')
    .select('id, first_name, last_name, email, telephone, date_of_birth')
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .limit(8);

  const results = document.getElementById('lead-customer-results');
  if (!data || !data.length) {
    results.innerHTML = '<div class="search-dropdown-item" style="color:var(--text3)">Δεν βρέθηκαν</div>';
    results.classList.remove('hidden');
    return;
  }
  results.innerHTML = data.map(c => `
    <div class="search-dropdown-item" onclick="fillLeadFromCustomer(${JSON.stringify(c).replace(/"/g,'&quot;')})">
      <strong>${esc(c.last_name)} ${esc(c.first_name)}</strong>
      ${c.email ? `<span style="color:var(--text3);margin-left:.5rem;font-size:.78rem">${esc(c.email)}</span>` : ''}
    </div>
  `).join('');
  results.classList.remove('hidden');
}

function fillLeadFromCustomer(c) {
  document.getElementById('lead-first-name').value = c.first_name || '';
  document.getElementById('lead-last-name').value  = c.last_name  || '';
  document.getElementById('lead-email').value      = c.email      || '';
  document.getElementById('lead-telephone').value  = c.telephone  || '';
  document.getElementById('lead-dob').value        = c.date_of_birth || '';
  document.getElementById('lead-customer-search').value = `${c.last_name} ${c.first_name}`;
  document.getElementById('lead-customer-results').classList.add('hidden');
}

async function deleteLead(id) {
  if (!confirm('Διαγραφή ενδιαφερόμενου;')) return;
  const { error } = await db.from('trip_leads').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  state.currentLeads = state.currentLeads.filter(l => l.id !== id);
  renderLeads();
  toast('Διαγράφηκε', 'success');
}

async function promoteLeadToParticipant(leadId) {
  const lead = state.currentLeads.find(l => l.id === leadId);
  if (!lead) return;

  const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Άγνωστος';
  if (!confirm(`Μεταφορά του "${name}" στη λίστα συμμετεχόντων;`)) return;

  // Check if customer exists with same email or create new one
  let customerId = null;

  if (lead.email) {
    const { data: existing } = await db.from('customers')
      .select('id').eq('email', lead.email).single();
    if (existing) customerId = existing.id;
  }

  if (!customerId) {
    // Create new customer from lead data
    const { data: newCust, error: custErr } = await db.from('customers').insert({
      first_name:    lead.first_name || '',
      last_name:     lead.last_name  || '',
      email:         lead.email      || null,
      telephone:     lead.telephone  || null,
      date_of_birth: lead.date_of_birth || null,
    }).select().single();

    if (custErr) return toast('Σφάλμα δημιουργίας πελάτη: ' + custErr.message, 'error');
    customerId = newCust.id;
  }

  // Check capacity
  const max = state.currentTrip.num_persons || 0;
  const isWaitlist = max > 0 && state.currentParticipants.length >= max;

  // Add to participants
  const { error: partErr } = await db.from('trip_participants').insert({
    trip_id:     state.currentTrip.id,
    customer_id: customerId,
    is_waitlist: isWaitlist,
    sort_order:  state.currentParticipants.length,
  });

  if (partErr) {
    if (partErr.message?.includes('unique')) {
      toast('Ο πελάτης συμμετέχει ήδη στο ταξίδι', 'error');
    } else {
      toast('Σφάλμα προσθήκης: ' + partErr.message, 'error');
    }
    return;
  }

  // Delete from leads
  await db.from('trip_leads').delete().eq('id', leadId);
  state.currentLeads = state.currentLeads.filter(l => l.id !== leadId);

  toast(isWaitlist
    ? 'Μεταφέρθηκε στους Εφεδρικούς (πλήρης λίστα)'
    : 'Μεταφέρθηκε στη λίστα συμμετεχόντων', 'success');

  renderLeads();
  loadParticipants();
}

function initLeadsDragAndDrop() {
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;
  let dragSrc = null;

  tbody.querySelectorAll('.lead-row').forEach(row => {
    const handle = row.querySelector('.lead-drag');
    if (!handle) return;

    handle.addEventListener('mousedown', () => { row.draggable = true; });
    handle.addEventListener('mouseup',   () => { row.draggable = false; });

    row.addEventListener('dragstart', e => {
      dragSrc = row;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      tbody.querySelectorAll('.lead-row').forEach(r => r.classList.remove('drag-over'));
      saveLeadsSortOrder();
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (row === dragSrc) return;
      tbody.querySelectorAll('.lead-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;
      tbody.insertBefore(dragSrc, row);
      row.classList.remove('drag-over');
    });
  });
}

async function saveLeadsSortOrder() {
  const rows = [...document.querySelectorAll('#leads-tbody .lead-row')];
  await Promise.all(rows.map((row, idx) =>
    db.from('trip_leads').update({ sort_order: idx }).eq('id', row.dataset.id)
  ));
  const idOrder = rows.map(r => r.dataset.id);
  state.currentLeads.sort((a,b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id));
}


// ── ΛΙΣΤΑ ΑΝΑΜΟΝΗΣ (trip_waitlist) ───────────────────────────
async function loadWaitlist2() {
  const { data, error } = await db
    .from('trip_waitlist')
    .select('*')
    .eq('trip_id', state.currentTrip.id)
    .order('sort_order', { ascending: true, nullsFirst: true })
    .order('created_at');

  if (error) return toast('Σφάλμα φόρτωσης λίστας αναμονής', 'error');
  state.currentWaitlist2 = data || [];
  renderWaitlist2();
  updateTabCount('waitlist2', state.currentWaitlist2.length);
}

function renderWaitlist2() {
  const tbody = document.getElementById('waitlist2-tbody');
  if (!tbody) return;
  const w = canWrite('participants');

  if (!state.currentWaitlist2.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν εγγραφές ακόμα.</td></tr>';
    return;
  }

  function cell(r, field, type) {
    const val = r[field] ?? '';
    if (!w) {
      if (type === 'date') return `<td>${val ? formatDate(val) : '—'}</td>`;
      if (type === 'num')  return `<td>${val || '—'}</td>`;
      return `<td>${esc(val || '—')}</td>`;
    }
    if (type === 'date') return `<td><input type="date" class="inline-input" style="width:108px" value="${val}" onchange="inlineSaveWaitlist2('${r.id}','${field}',this.value)" /></td>`;
    if (type === 'time') return `<td><input type="time" class="inline-input" value="${val}" onchange="inlineSaveWaitlist2('${r.id}','${field}',this.value)" /></td>`;
    if (type === 'num')  return `<td><input type="number" class="inline-input inline-num" value="${val||''}" placeholder="1" onblur="inlineSaveWaitlist2('${r.id}','${field}',this.value)" /></td>`;
    return `<td><input type="text" class="inline-input" value="${esc(val)}" onblur="inlineSaveWaitlist2('${r.id}','${field}',this.value)" /></td>`;
  }

  tbody.innerHTML = state.currentWaitlist2.map((r, idx) => `
    <tr data-id="${r.id}" data-sort="${r.sort_order??idx}" class="waitlist2-row">
      <td class="drag-handle waitlist2-drag">⠿</td>
      ${cell(r,'last_name','text')}
      ${cell(r,'first_name','text')}
      ${cell(r,'email','text')}
      ${cell(r,'telephone','text')}
      ${cell(r,'date_of_birth','date')}
      ${cell(r,'num_persons','num')}
      ${cell(r,'deadline','date')}
      ${cell(r,'deadline_time','time')}
      ${cell(r,'comments','text')}
      <td style="white-space:nowrap">
        ${w ? `
          <button class="btn btn-sm btn-primary" onclick="promoteWaitlist2ToLead('${r.id}')" title="Μεταφορά στους Ενδιαφερόμενους">→</button>
          <button class="btn-icon danger" onclick="deleteWaitlist2('${r.id}')">🗑</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  if (w) initWaitlist2DragAndDrop();
}

async function inlineSaveWaitlist2(id, field, value) {
  const numFields = ['num_persons'];
  const parsed = numFields.includes(field) ? (parseInt(value)||1) : (value === '' ? null : value);
  const { error } = await db.from('trip_waitlist').update({ [field]: parsed }).eq('id', id);
  if (error) toast('Σφάλμα αποθήκευσης', 'error');
  const r = state.currentWaitlist2.find(x => x.id === id);
  if (r) r[field] = parsed;
}

async function deleteWaitlist2(id) {
  if (!confirm('Διαγραφή από τη λίστα αναμονής;')) return;
  const { error } = await db.from('trip_waitlist').delete().eq('id', id);
  if (error) return toast('Σφάλμα διαγραφής', 'error');
  state.currentWaitlist2 = state.currentWaitlist2.filter(r => r.id !== id);
  renderWaitlist2();
  toast('Διαγράφηκε', 'success');
}

async function promoteWaitlist2ToLead(id) {
  const r = state.currentWaitlist2.find(x => x.id === id);
  if (!r) return;
  const name = `${r.last_name || ''} ${r.first_name || ''}`.trim() || 'Άγνωστος';
  if (!confirm(`Μεταφορά του "${name}" στους Ενδιαφερόμενους;`)) return;

  const { error: insErr } = await db.from('trip_leads').insert({
    trip_id:       r.trip_id,
    first_name:    r.first_name,
    last_name:     r.last_name,
    email:         r.email,
    telephone:     r.telephone,
    date_of_birth: r.date_of_birth,
    num_persons:   r.num_persons,
    deadline:      r.deadline,
    deadline_time: r.deadline_time,
    comments:      r.comments,
    sort_order:    state.currentLeads.length,
  });

  if (insErr) return toast('Σφάλμα μεταφοράς', 'error');

  await db.from('trip_waitlist').delete().eq('id', id);
  state.currentWaitlist2 = state.currentWaitlist2.filter(x => x.id !== id);
  renderWaitlist2();
  updateTabCount('waitlist2', state.currentWaitlist2.length);
  // Refresh leads count
  const { data: leadsData } = await db.from('trip_leads').select('*').eq('trip_id', state.currentTrip.id).order('sort_order');
  if (leadsData) { state.currentLeads = leadsData; updateTabCount('leads', leadsData.length); }
  toast(`Ο "${name}" μεταφέρθηκε στους Ενδιαφερόμενους`, 'success');
}

function fillWl2FromCustomer(c) {
  document.getElementById('wl2-last-name').value  = c.last_name       || '';
  document.getElementById('wl2-first-name').value = c.first_name      || '';
  document.getElementById('wl2-email').value      = c.email           || '';
  document.getElementById('wl2-telephone').value  = c.telephone       || '';
  document.getElementById('wl2-dob').value        = c.date_of_birth   || '';
  document.getElementById('wl2-customer-search').value = `${c.last_name} ${c.first_name}`;
  document.getElementById('wl2-customer-results').classList.add('hidden');
}

function openWaitlist2Modal() {
  ['wl2-last-name','wl2-first-name','wl2-email','wl2-telephone','wl2-dob']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const si = document.getElementById('wl2-customer-search');
  if (si) si.value = '';
  const sr = document.getElementById('wl2-customer-results');
  if (sr) { sr.innerHTML = ''; sr.classList.add('hidden'); }
  document.getElementById('modal-waitlist2').classList.remove('hidden');
}

async function saveWaitlist2Modal() {
  const payload = {
    trip_id:       state.currentTrip.id,
    last_name:     document.getElementById('wl2-last-name').value.trim()  || null,
    first_name:    document.getElementById('wl2-first-name').value.trim() || null,
    email:         document.getElementById('wl2-email').value.trim()      || null,
    telephone:     document.getElementById('wl2-telephone').value.trim()  || null,
    date_of_birth: document.getElementById('wl2-dob').value               || null,
    num_persons:   1,
    sort_order:    state.currentWaitlist2.length,
  };

  const { data, error } = await db.from('trip_waitlist').insert(payload).select().single();
  if (error) return toast('Σφάλμα αποθήκευσης', 'error');

  document.getElementById('modal-waitlist2').classList.add('hidden');
  state.currentWaitlist2.push(data);
  renderWaitlist2();
  toast('Αποθηκεύτηκε', 'success');
}

function initWaitlist2DragAndDrop() {
  const tbody = document.getElementById('waitlist2-tbody');
  if (!tbody) return;
  let dragSrc = null;

  tbody.querySelectorAll('.waitlist2-row').forEach(row => {
    const handle = row.querySelector('.waitlist2-drag');
    if (!handle) return;
    handle.addEventListener('mousedown', () => { row.draggable = true; });
    handle.addEventListener('mouseup',   () => { row.draggable = false; });
    row.addEventListener('dragstart', e => { dragSrc = row; e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend',   () => { row.draggable = false; row.classList.remove('dragging'); tbody.querySelectorAll('.waitlist2-row').forEach(r => r.classList.remove('drag-over')); saveWaitlist2SortOrder(); });
    row.addEventListener('dragover',  e => { e.preventDefault(); if (row === dragSrc) return; tbody.querySelectorAll('.waitlist2-row').forEach(r => r.classList.remove('drag-over')); row.classList.add('drag-over'); });
    row.addEventListener('drop',      e => { e.preventDefault(); if (!dragSrc || dragSrc === row) return; tbody.insertBefore(dragSrc, row); row.classList.remove('drag-over'); });
  });
}

async function saveWaitlist2SortOrder() {
  const rows = [...document.querySelectorAll('#waitlist2-tbody .waitlist2-row')];
  await Promise.all(rows.map((row, idx) =>
    db.from('trip_waitlist').update({ sort_order: idx }).eq('id', row.dataset.id)
  ));
}

// ── TAB COUNTS ───────────────────────────────────────────────
function updateTabCount(tabName, count) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (!tab) return;
  const base = tab.dataset.label || tab.textContent.replace(/\s*\(\d+\)/, '').trim();
  tab.dataset.label = base;
  tab.textContent = `${base} (${count})`;
}

async function loadAllTabCounts() {
  if (!state.currentTrip) return;
  const tripId = state.currentTrip.id;
  const [p, l, w] = await Promise.all([
    db.from('trip_participants').select('*', { count:'exact', head:true }).eq('trip_id', tripId).eq('is_waitlist', false),
    db.from('trip_leads').select('*', { count:'exact', head:true }).eq('trip_id', tripId),
    db.from('trip_waitlist').select('*', { count:'exact', head:true }).eq('trip_id', tripId),
  ]);
  updateTabCount('participants', p.count || 0);
  updateTabCount('leads',        l.count || 0);
  updateTabCount('waitlist2',    w.count || 0);
}

// ── TABS ─────────────────────────────────────────────────────
function applyTabPermissions(tabName) {
  const w = canWrite(tabName);
  // Map tab → write action button IDs
  const writeButtons = {
    participants: ['btn-add-participant'],
    costs:        ['btn-add-cost'],
    waitlist:     ['btn-add-waitlist'],
    rooms:        ['btn-add-room'],
    pricing:      ['pricing-save-btn-id'],  // handled inside loadPricing
    tasks:        [],  // tasks always show checkboxes but fields disabled if no write
    receipts:     [],  // edit buttons handled in render
  };
  (writeButtons[tabName] || []).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = w ? '' : 'none';
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  show(`tab-${tabName}`);
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
  applyTabPermissions(tabName);

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

  if (tabName === 'leads')     loadLeads();
  if (tabName === 'waitlist2') loadWaitlist2();
  if (tabName === 'receipts') loadReceipts();
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
   'cust-expiry-date','cust-telephone','cust-email','cust-afm','cust-address',
   'cust-postal-code','cust-notes'].forEach(id => { $(id).value = ''; });
  $('cust-nationality').value = '';
  setText('modal-customer-title', 'Νέος Πελάτης');
  state.editingId = null;
}

function resetParticipantForm() {
  ['part-solo-couple','part-room-type','part-room-id',
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
  ['cost-booking-ref','cost-payment-date','cost-comments','cost-cost',
   'cost-expense-type','cost-local-currency','cost-amount-eur',
   'cost-payment-method','cost-entry-date','cost-invoice-name'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('cost-is-paid').value       = '';
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
    populateRoomDropdown();
    openModal('modal-participant');
  });

  // Add to waitlist
  document.getElementById('btn-add-waitlist')?.addEventListener('click', () => {
    resetParticipantForm();
    state.addingToWaitlist = true;
    populateRoomDropdown();
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

  // New room
  document.getElementById('btn-add-room')?.addEventListener('click', () => {
    resetRoomForm();
    openModal('modal-room');
  });

  document.getElementById('btn-save-room')?.addEventListener('click', saveRoom);
  document.getElementById('btn-save-room-assignment')?.addEventListener('click', saveRoomAssignment);
  document.getElementById('btn-save-receipt')?.addEventListener('click', saveReceipt);

  // ESC key closes all modals
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => {
      closeModal(modal.id);
    });
    ['modal-lead','modal-waitlist2'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
    });
  });
  document.getElementById('btn-save-lead')?.addEventListener('click', saveLeadModal);
  document.getElementById('btn-cancel-lead')?.addEventListener('click', () => {
    document.getElementById('modal-lead').classList.add('hidden');
  });
  document.getElementById('btn-cancel-lead-footer')?.addEventListener('click', () => {
    document.getElementById('modal-lead').classList.add('hidden');
  });
  let leadSearchTimeout;
  document.getElementById('lead-customer-search')?.addEventListener('input', e => {
    clearTimeout(leadSearchTimeout);
    leadSearchTimeout = setTimeout(() => searchCustomersForLead(e.target.value), 250);
  });
  document.getElementById('btn-add-lead')?.addEventListener('click', openLeadModal);
  document.getElementById('btn-add-waitlist2')?.addEventListener('click', openWaitlist2Modal);
  document.getElementById('btn-save-waitlist2')?.addEventListener('click', saveWaitlist2Modal);
  document.getElementById('btn-cancel-waitlist2')?.addEventListener('click', () => {
    document.getElementById('modal-waitlist2').classList.add('hidden');
  });
  document.getElementById('btn-cancel-waitlist2-footer')?.addEventListener('click', () => {
    document.getElementById('modal-waitlist2').classList.add('hidden');
  });

  let wl2SearchTimeout;
  document.getElementById('wl2-customer-search')?.addEventListener('input', e => {
    clearTimeout(wl2SearchTimeout);
    wl2SearchTimeout = setTimeout(async () => {
      const query = e.target.value;
      const results = document.getElementById('wl2-customer-results');
      if (query.length < 2) { results.classList.add('hidden'); return; }
      const { data } = await db.from('customers')
        .select('id, first_name, last_name, email, telephone, date_of_birth')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .limit(8);
      if (!data?.length) {
        results.innerHTML = '<div class="search-dropdown-item" style="color:var(--text3)">Δεν βρέθηκαν</div>';
        results.classList.remove('hidden');
        return;
      }
      results.innerHTML = data.map(c => `
        <div class="search-dropdown-item" onclick="fillWl2FromCustomer(${JSON.stringify(c).replace(/"/g,'&quot;')})">
          <strong>${esc(c.last_name)} ${esc(c.first_name)}</strong>
          ${c.email ? `<span style="color:var(--text3);margin-left:.5rem;font-size:.78rem">${esc(c.email)}</span>` : ''}
        </div>`).join('');
      results.classList.remove('hidden');
    }, 250);
  });

  // User management
  document.getElementById('btn-new-user')?.addEventListener('click', openNewUser);
  document.getElementById('btn-save-user')?.addEventListener('click', saveUser);
  document.getElementById('user-role')?.addEventListener('change', () => {
    const current = {};
    document.querySelectorAll('#permissions-grid input[type="checkbox"]:checked').forEach(cb => {
      current[cb.dataset.tab] = true;
    });
    renderPermissionCheckboxes(current);
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
  return formatDateDisplay(dateStr);
}

function formatEur(val) {
  if (val === null || val === undefined) return '—';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
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
// GROUP COLORS for visual grouping
const GROUP_COLORS = [
  '#93c5fd','#86efac','#fde68a','#f9a8d4','#c4b5fd',
  '#fdba74','#67e8f9','#6ee7b7','#fca5a5','#a5f3fc'
];

function renderParticipantsRows(rows) {
  renderParticipantsGrouped(rows);
}

function editableFinalPayment(p) {
  const w = canWrite('participants');
  // Default to trip's price_full if not set
  // Always use price_full as default if final_payment not explicitly set
  const defaultPrice = state.currentTrip?.price_full || 0;
  const val = p.final_payment != null ? p.final_payment : defaultPrice;
  if (!w) return `<td style="font-weight:500">${formatEur(val)}</td>`;
  return `<td><input type="number" class="inline-input inline-num" value="${val}"
    onblur="inlineSave('${p.id}','final_payment',this.value)"
    oninput="previewBalance('${p.id}',this.value)" /></td>`;
}

function renderParticipantsGrouped(rows) {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="13" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν συμμετέχοντες ακόμα.</td></tr>';
    return;
  }

  const w = canWrite('participants');

  // Build group map: group_id → [participants]
  const groupMap = {};
  const ungrouped = [];
  rows.forEach(p => {
    if (p.group_id !== null && p.group_id !== undefined) {
      if (!groupMap[p.group_id]) groupMap[p.group_id] = [];
      groupMap[p.group_id].push(p);
    } else {
      ungrouped.push(p);
    }
  });

  // Assign color per group_id
  const groupIds = Object.keys(groupMap);
  const groupColorMap = {};
  groupIds.forEach((gid, i) => {
    groupColorMap[gid] = GROUP_COLORS[i % GROUP_COLORS.length];
  });

  // Inline edit cell renderer
  function editableCell(p, field, type, options = null) {
    if (!w) {
      // Read-only
      if (type === 'eur') return `<td>${formatEur(p[field])}</td>`;
      return `<td>${esc(p[field] || '—')}</td>`;
    }

    const val = p[field] ?? '';

    if (type === 'select') {
      const opts = options.map(o =>
        `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`
      ).join('');
      return `<td><select class="inline-select" onchange="inlineSave('${p.id}','${field}',this.value)">
        <option value="">—</option>${opts}
      </select></td>`;
    }

    if (type === 'select-grouped') {
      return `<td><select class="inline-select" onchange="inlineSave('${p.id}','${field}',this.value)">
        <option value="">—</option>
        <optgroup label="Τράπεζα">
          <option ${val==='ALPHA'?'selected':''}>ALPHA</option>
          <option ${val==='EUROBANK'?'selected':''}>EUROBANK</option>
          <option ${val==='ΕΘΝΙΚΗ'?'selected':''}>ΕΘΝΙΚΗ</option>
          <option ${val==='REVOLUT'?'selected':''}>REVOLUT</option>
          <option ${val==='E-POS'?'selected':''}>E-POS</option>
        </optgroup>
        <optgroup label="Μετρητά">
          <option ${val==='ΜΕΤΡΗΤΑ'?'selected':''}>ΜΕΤΡΗΤΑ</option>
          <option value="ΜΕΤΡΗΤΑ (ΑΠΟΔΕΙΞΗ)" ${val==='ΜΕΤΡΗΤΑ (ΑΠΟΔΕΙΞΗ)'?'selected':''}>ΜΕΤΡΗΤΑ (ΑΠΟΔΕΙΞΗ)</option>
        </optgroup>
      </select></td>`;
    }

    if (type === 'date') {
      return `<td><input type="date" class="inline-input" value="${val}"
        onchange="inlineSave('${p.id}','${field}',this.value)" /></td>`;
    }

    if (type === 'num' || type === 'eur') {
      const isInstallment = ['deposit_amount','installment2_amount','installment3_amount','installment4_amount'].includes(field);
      const inputExtra = isInstallment ? `oninput="liveBalanceUpdate('${p.id}','${field}',this.value)"` : '';
      return `<td><input type="number" class="inline-input inline-num" value="${val || ''}"
        placeholder="0" ${inputExtra}
        onblur="inlineSave('${p.id}','${field}',this.value)" /></td>`;
    }

    return `<td><input type="text" class="inline-input" value="${esc(val)}"
      onblur="inlineSave('${p.id}','${field}',this.value)" /></td>`;
  }

  // Build rows
  let html = '';
  const renderedGroups = new Set();

  rows.forEach((p, idx) => {
    const gid = p.group_id;
    const isGrouped = gid !== null && gid !== undefined;
    const bgColor   = isGrouped ? groupColorMap[gid] : '';
    const style     = bgColor
      ? `style="background:${bgColor}55;border-left:4px solid ${bgColor}"`
      : 'style="border-left:4px solid transparent"';

    // Tipo cell — merged for group, normal for solo
    let tipoCell = '';
    if (isGrouped && !renderedGroups.has(gid)) {
      const groupSize = groupMap[gid].length;
      renderedGroups.add(gid);
      const tipoVal = p.solo_couple || '';
      const tipoOpts = ['ΦΙΛΟΙ','ΖΕΥΓΑΡΙ','SOLO','ΠΑΡΕΑ','ΑΔΕΡΦΙΑ','ΓΟΝΕΑΣ - ΠΑΙΔΙ','LEADER'];
      const tipoSelect = w
        ? `<select class="inline-select" style="font-weight:600"
             onchange="inlineSaveGroup(${gid},'solo_couple',this.value)">
             <option value="">—</option>
             ${tipoOpts.map(o => `<option value="${o}" ${tipoVal===o?'selected':''}>${o}</option>`).join('')}
           </select>`
        : `<strong>${esc(tipoVal||'—')}</strong>`;

      tipoCell = `
        <td rowspan="${groupSize}" class="group-tipo-cell"
            style="background:${bgColor}99;border-left:4px solid ${bgColor};vertical-align:middle;text-align:center">
          ${tipoSelect}
          ${w ? `<div style="margin-top:.3rem">
            <button class="btn-icon danger" title="Διάλυση ομάδας"
              onclick="dissolveGroup(${gid})" style="font-size:.7rem">✕ Διάλυση</button>
          </div>` : ''}
        </td>`;
    } else if (isGrouped) {
      tipoCell = ''; // rowspan handles it
    } else {
      // Not in a group — editable solo_couple
      tipoCell = editableCell(p, 'solo_couple', 'select',
        ['ΦΙΛΟΙ','ΖΕΥΓΑΡΙ','SOLO','ΠΑΡΕΑ','ΑΔΕΡΦΙΑ','ΓΟΝΕΑΣ - ΠΑΙΔΙ','LEADER']);
    }

    const dragHandle = w ? `<td class="drag-handle" draggable="false">⠿</td>` : '<td></td>';
    const checkbox   = w ? `<td><input type="checkbox" class="participant-checkbox" data-id="${p.id}" data-group="${gid ?? ''}" /></td>` : '<td></td>';

    html += `
      <tr data-id="${p.id}" data-group="${gid ?? ''}" data-sort="${p.sort_order ?? idx}" ${style} class="participant-row">
        ${dragHandle}
        ${checkbox}
        <td>${p.customers ? esc(p.customers.last_name) : '—'}</td>
        <td>${p.customers ? esc(p.customers.first_name) : '—'}</td>
        <td>${p.customers?.date_of_birth ? formatDateDisplay(p.customers.date_of_birth) : '—'}</td>
        <td>${esc(p.customers?.passport_number || '—')}</td>
        <td>${esc(p.customers?.nationality || '—')}</td>
        <td>${p.customers?.issue_date ? formatDateDisplay(p.customers.issue_date) : '—'}</td>
        <td>${p.customers?.expiry_date ? formatDateDisplay(p.customers.expiry_date) : '—'}</td>
        <td>${esc(p.customers?.telephone || '—')}</td>
        ${tipoCell}
        ${editableCell(p, 'room_type',   'select', ['SINGLE','TWIN','DOUBLE','TRIPLE'])}
        ${editableCell(p, 'deposit_amount',  'eur')}
        ${editableCell(p, 'deposit_method',  'select-grouped')}
        ${editableCell(p, 'deposit_date',    'date')}
        ${editableCell(p, 'installment2_amount', 'eur')}
        ${editableCell(p, 'installment2_method', 'select-grouped')}
        ${editableCell(p, 'installment2_date',   'date')}
        ${editableCell(p, 'installment3_amount', 'eur')}
        ${editableCell(p, 'installment3_method', 'select-grouped')}
        ${editableCell(p, 'installment3_date',   'date')}
        ${editableCell(p, 'installment4_amount', 'eur')}
        ${editableCell(p, 'installment4_method', 'select-grouped')}
        ${editableCell(p, 'installment4_date',   'date')}
        <td class="balance-cell" style="font-weight:600;color:${calcBalance(p)>0?'#b45309':'#15803d'};text-align:right">${calcBalance(p) === 0 ? '0 €' : formatEur(calcBalance(p))}</td>
        ${editableFinalPayment(p)}
        <td>
          ${w ? `<button class="btn-icon danger" onclick="deleteParticipant('${p.id}')" title="Διαγραφή">🗑</button>` : ''}
        </td>
      </tr>`;
  });

  tbody.innerHTML = html;
  if (w) initDragAndDrop();
  applyStickyBackground();
}

function applyStickyBackground() {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach(row => {
    // Get the row's background color (from inline style or default white)
    const rowBg = row.style.backgroundColor || '#ffffff';
    // Apply to sticky cells (3rd and 4th child)
    const cells = row.querySelectorAll('td:nth-child(3), td:nth-child(4)');
    cells.forEach(cell => {
      cell.style.backgroundColor = rowBg;
    });
  });
}

// ── INLINE SAVE ───────────────────────────────────────────────
async function inlineSave(id, field, value) {
  const numFields = ['deposit_amount','installment2_amount','installment3_amount',
    'installment4_amount','final_payment'];
  const parsed = numFields.includes(field)
    ? (parseInt(value) || 0) : (value || null);

  // Update local state first
  const p = state.currentParticipants.find(x => x.id === id);
  if (p) p[field] = parsed;

  // Auto-recalculate balance
  const updatePayload = { [field]: parsed };
  if (numFields.includes(field)) {
    const balance = calcBalance(p);
    updatePayload.balance = balance;
    if (p) p.balance = balance;
    // Update balance cell in DOM immediately
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) {
      const balCell = row.querySelector('.balance-cell');
      if (balCell) {
        balCell.textContent = formatEur(balance);
        balCell.style.color = balance > 0 ? '#b45309' : '#15803d';
      }
    }
  }

  const { error } = await db.from('trip_participants').update(updatePayload).eq('id', id);
  if (error) { toast('Σφάλμα αποθήκευσης', 'error'); return; }

  updateParticipantCount();
}

// Live balance update while typing installment amounts
function liveBalanceUpdate(participantId, changedField, newValue) {
  const p = state.currentParticipants.find(x => x.id === participantId);
  if (!p) return;
  // Temporarily use new value for calculation
  const temp = { ...p, [changedField]: parseInt(newValue)||0 };
  const balance = calcBalance(temp);
  const row = document.querySelector(`tr[data-id="${participantId}"]`);
  if (row) {
    const balCell = row.querySelector('.balance-cell');
    if (balCell) {
      balCell.textContent = formatEur(balance);
      balCell.style.color = balance > 0 ? '#b45309' : '#15803d';
    }
  }
}

// Live preview balance while typing (before save)
function previewBalance(participantId, newFinalPayment) {
  const p = state.currentParticipants.find(x => x.id === participantId);
  if (!p) return;
  const fp = parseInt(newFinalPayment) || 0;
  const paid = (p.deposit_amount||0)+(p.installment2_amount||0)+(p.installment3_amount||0)+(p.installment4_amount||0);
  const balance = Math.max(0, fp - paid);
  const row = document.querySelector(`tr[data-id="${participantId}"]`);
  if (row) {
    const balCell = row.querySelector('.balance-cell');
    if (balCell) {
      balCell.textContent = formatEur(balance);
      balCell.style.color = balance > 0 ? '#b45309' : '#15803d';
    }
  }
}

function calcBalance(p) {
  if (!p) return 0;
  const total = (p.final_payment || 0);
  const paid  = (p.deposit_amount || 0) +
                (p.installment2_amount || 0) +
                (p.installment3_amount || 0) +
                (p.installment4_amount || 0);
  return Math.max(0, total - paid);
}

// ── INLINE SAVE GROUP ────────────────────────────────────────
async function inlineSaveGroup(groupId, field, value) {
  const members = state.currentParticipants.filter(p => p.group_id === groupId);
  const ids = members.map(p => p.id);

  const { error } = await db.from('trip_participants')
    .update({ [field]: value || null })
    .in('id', ids);

  if (error) { toast('Σφάλμα αποθήκευσης', 'error'); return; }

  // Update local state
  members.forEach(p => { p[field] = value || null; });
}

// ── GROUPING ──────────────────────────────────────────────────
function getCheckedParticipantIds() {
  return [...document.querySelectorAll('.participant-checkbox:checked')].map(cb => cb.dataset.id);
}

async function groupSelected() {
  const ids = getCheckedParticipantIds();
  if (ids.length < 2) return toast('Επιλέξτε τουλάχιστον 2 συμμετέχοντες', 'error');

  // Find next available group_id
  const usedGroups = state.currentParticipants
    .map(p => p.group_id).filter(g => g !== null && g !== undefined);
  const nextGroup = usedGroups.length ? Math.max(...usedGroups) + 1 : 1;

  const { error } = await db.from('trip_participants')
    .update({ group_id: nextGroup })
    .in('id', ids);

  if (error) return toast('Σφάλμα ομαδοποίησης', 'error');
  toast('Ομαδοποίηση ολοκληρώθηκε', 'success');
  loadParticipants();
}

async function dissolveGroup(groupId) {
  if (!confirm(`Διάλυση ομάδας ${groupId};`)) return;
  const ids = state.currentParticipants
    .filter(p => p.group_id === groupId).map(p => p.id);

  const { error } = await db.from('trip_participants')
    .update({ group_id: null })
    .in('id', ids);

  if (error) return toast('Σφάλμα διάλυσης ομάδας', 'error');
  toast('Ομάδα διαλύθηκε', 'success');
  loadParticipants();
}

// ── DRAG & DROP ───────────────────────────────────────────────
function initDragAndDrop() {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) return;

  let dragSrc = null;

  tbody.querySelectorAll('.participant-row').forEach(row => {
    const handle = row.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', () => { row.draggable = true; });
    handle.addEventListener('mouseup',   () => { row.draggable = false; });

    row.addEventListener('dragstart', e => {
      dragSrc = row;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });

    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      tbody.querySelectorAll('.participant-row').forEach(r => r.classList.remove('drag-over'));
      saveSortOrder();
    });

    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (row === dragSrc) return;
      tbody.querySelectorAll('.participant-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });

    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;
      const targetGroup = row.dataset.group;
      const srcGroup    = dragSrc.dataset.group;
      if (targetGroup && targetGroup !== '' && targetGroup !== srcGroup) {
        row.classList.remove('drag-over');
        toast('Δεν μπορείς να βάλεις εγγραφή μέσα σε ομάδα', 'error');
        return;
      }
      tbody.insertBefore(dragSrc, row);
      row.classList.remove('drag-over');
    });
  });
}

async function saveSortOrder() {
  const rows = [...document.querySelectorAll('#participants-tbody .participant-row')];
  const updates = rows.map((row, idx) => ({
    id: row.dataset.id,
    sort_order: idx,
  }));

  // Update each row's sort_order
  await Promise.all(updates.map(u =>
    db.from('trip_participants').update({ sort_order: u.sort_order }).eq('id', u.id)
  ));

  // Update local state order
  const idOrder = updates.map(u => u.id);
  state.currentParticipants.sort((a, b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id));
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
        ${canWrite('waitlist') ? `
          <button class="btn btn-sm btn-primary" onclick="promoteFromWaitlist('${p.id}')">→ Μεταφορά</button>
          <button class="btn-icon danger" onclick="deleteParticipant('${p.id}', true)" style="margin-left:.3rem">🗑</button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function renderCostsRows(rows) {
  renderCostsInline(rows);
}

function renderCostsInline(rows) {
  const tbody = document.getElementById('costs-tbody');
  if (!tbody) return;
  const w = canWrite('costs');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="color:var(--text3);text-align:center;padding:1.5rem">Δεν υπάρχουν έξοδα ακόμα.</td></tr>`;
    return;
  }

  const EXPENSE_METHODS = [
    'ALPHA (ΕΜΒΑΣΜΑ)','ALPHA (ΚΑΡΤΑ)',
    'EUROBANK (ΕΜΒΑΣΜΑ)','EUROBANK (ΚΑΡΤΑ)',
    'ΕΘΝΙΚΗ (ΕΜΒΑΣΜΑ)','ΕΘΝΙΚΗ (ΚΑΡΤΑ)',
    'REVOLUT (ΕΜΒΑΣΜΑ)','REVOLUT (ΚΑΡΤΑ)',
    'ΜΕΤΡΗΤΑ'
  ];

  function cell(c, field, type, opts, extraStyle='') {
    const val = c[field] ?? '';
    if (!w) {
      if (type === 'bool') return `<td><span class="badge ${val ? 'badge-green':'badge-gray'}">${val?'Ναι':'Όχι'}</span></td>`;
      if (type === 'eur')  return `<td>${formatEur(val)}</td>`;
      if (type === 'date') return `<td>${val ? formatDate(val) : '—'}</td>`;
      return `<td>${esc(val||'—')}</td>`;
    }
    if (type === 'paid-select') {
      const paidBg    = val==='ΝΑΙ' ? '#dcfce7' : val==='STAND BY' ? '#fef9c3' : '';
      const paidColor = val==='ΝΑΙ' ? '#15803d' : val==='STAND BY' ? '#854d0e' : '';
      return `<td><select class="inline-select" onchange="inlineSaveCost('${c.id}','${field}',this.value)"
        style="background:${paidBg};color:${paidColor};font-weight:${paidBg?'600':'400'}">
        <option value="">—</option>
        <option value="ΝΑΙ" ${val==='ΝΑΙ'?'selected':''}>ΝΑΙ</option>
        <option value="STAND BY" ${val==='STAND BY'?'selected':''}>STAND BY</option>
      </select></td>`;
    }
    if (type === 'bool') {
      return `<td style="text-align:center"><input type="checkbox" class="inline-checkbox" ${val?'checked':''}
        onchange="inlineSaveCost('${c.id}','${field}',this.checked)" /></td>`;
    }
    if (type === 'select') {
      const options = opts.map(o => `<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('');
      return `<td><select class="inline-select" onchange="inlineSaveCost('${c.id}','${field}',this.value)">
        <option value="">—</option>${options}</select></td>`;
    }
    if (type === 'date') {
      return `<td><input type="date" class="inline-input" style="width:108px" value="${val}"
        onchange="inlineSaveCost('${c.id}','${field}',this.value)" /></td>`;
    }
    if (type === 'num') {
      return `<td><input type="number" class="inline-input inline-num" value="${val||''}" placeholder="0"
        onblur="inlineSaveCost('${c.id}','${field}',this.value)" /></td>`;
    }
    return `<td><input type="text" class="inline-input" style="${extraStyle}" value="${esc(val)}"
      onblur="inlineSaveCost('${c.id}','${field}',this.value)" /></td>`;
  }

  // Build group map
  const groupMap = {};
  rows.forEach(c => {
    if (c.group_id !== null && c.group_id !== undefined) {
      if (!groupMap[c.group_id]) groupMap[c.group_id] = [];
      groupMap[c.group_id].push(c);
    }
  });

  const COST_GROUP_COLORS = [
    '#93c5fd','#86efac','#fde68a','#f9a8d4','#c4b5fd',
    '#fdba74','#67e8f9','#6ee7b7','#fca5a5','#a5f3fc'
  ];
  const groupIds = Object.keys(groupMap);
  const groupColorMap = {};
  groupIds.forEach((gid, i) => { groupColorMap[gid] = COST_GROUP_COLORS[i % COST_GROUP_COLORS.length]; });

  const renderedGroups = new Set();
  let html = '';

  rows.forEach((c, idx) => {
    const gid = c.group_id;
    const isGrouped = gid !== null && gid !== undefined;
    const bgColor = isGrouped ? groupColorMap[gid] : '';
    const rowStyle = bgColor
      ? `style="background:${bgColor}55;border-left:4px solid ${bgColor}"`
      : 'style="border-left:4px solid transparent"';

    let catCell = '';
    if (isGrouped && !renderedGroups.has(gid)) {
      const groupSize = groupMap[gid].length;
      renderedGroups.add(gid);
      const catVal = c.expense_type || '';
      catCell = `
        <td rowspan="${groupSize}" class="group-tipo-cell"
            style="background:${bgColor}99;border-left:4px solid ${bgColor};vertical-align:middle;text-align:center">
          ${w ? `<input type="text" class="inline-input" style="font-weight:600;text-align:center" value="${esc(catVal)}"
              onblur="inlineSaveCostGroup(${gid},'expense_type',this.value)" />`
              : `<strong>${esc(catVal||'—')}</strong>`}
          ${w ? `<div style="margin-top:.3rem">
            <button class="btn-icon danger" onclick="dissolveCostGroup(${gid})" style="font-size:.7rem">✕ Διάλυση</button>
          </div>` : ''}
        </td>`;
    } else if (isGrouped) {
      catCell = '';
    } else {
      catCell = `<td><input type="text" class="inline-input" value="${esc(c.expense_type||'')}"
        onblur="inlineSaveCost('${c.id}','expense_type',this.value)" /></td>`;
    }

    html += `
      <tr data-id="${c.id}" data-group="${gid??''}" data-sort="${c.sort_order??idx}" class="cost-row" ${rowStyle}>
        <td class="drag-handle cost-drag">⠿</td>
        ${w ? `<td><input type="checkbox" class="cost-checkbox" data-id="${c.id}" /></td>` : '<td></td>'}
        ${cell(c,'booking_ref','text')}
        ${cell(c,'payment_date','date')}
        ${cell(c,'comments','text','','min-width:150px')}
        ${cell(c,'cost','num')}
        ${catCell}
        ${cell(c,'local_currency','text')}
        ${cell(c,'amount_eur','num')}
        ${cell(c,'payment_method','select',EXPENSE_METHODS)}
        ${cell(c,'entry_date','date')}
        ${cell(c,'is_paid','paid-select')}
        ${cell(c,'has_invoice','bool')}
        ${cell(c,'invoice_name','text')}
        <td>${w?`<button class="btn-icon danger" onclick="deleteCost('${c.id}')">🗑</button>`:''}</td>
      </tr>`;
  });

  tbody.innerHTML = html;
  if (w) initCostsDragAndDrop();
  renderCostsSummary();
}

async function inlineSaveCost(id, field, value) {
  const numFields = ['cost','amount_eur'];
  const parsed = numFields.includes(field)
    ? (parseInt(value)||0)
    : (value === '' || value === null ? null : value);

  const { error } = await db.from('trip_costs').update({ [field]: parsed }).eq('id', id);
  if (error) { toast('Σφάλμα αποθήκευσης', 'error'); return; }

  const c = state.currentCosts.find(x => x.id === id);
  if (c) c[field] = parsed;
  renderCostsSummary();
}

async function inlineSaveCostGroup(groupId, field, value) {
  const members = state.currentCosts.filter(c => c.group_id === groupId);
  const ids = members.map(c => c.id);
  const { error } = await db.from('trip_costs').update({ [field]: value||null }).in('id', ids);
  if (error) { toast('Σφάλμα αποθήκευσης', 'error'); return; }
  members.forEach(c => { c[field] = value||null; });
}

async function dissolveCostGroup(groupId) {
  if (!confirm('Διάλυση ομάδας;')) return;
  const ids = state.currentCosts.filter(c => c.group_id === groupId).map(c => c.id);
  const { error } = await db.from('trip_costs').update({ group_id: null }).in('id', ids);
  if (error) return toast('Σφάλμα διάλυσης', 'error');
  state.currentCosts.forEach(c => { if (c.group_id === groupId) c.group_id = null; });
  toast('Ομάδα διαλύθηκε', 'success');
  renderCosts();
}

async function groupCostsSelected() {
  const ids = [...document.querySelectorAll('.cost-checkbox:checked')].map(cb => cb.dataset.id);
  if (ids.length < 2) return toast('Επιλέξτε τουλάχιστον 2 έξοδα', 'error');
  const usedGroups = state.currentCosts.map(c => c.group_id).filter(g => g !== null && g !== undefined);
  const nextGroup  = usedGroups.length ? Math.max(...usedGroups) + 1 : 1;
  const { error } = await db.from('trip_costs').update({ group_id: nextGroup }).in('id', ids);
  if (error) return toast('Σφάλμα ομαδοποίησης', 'error');
  toast('Ομαδοποίηση ολοκληρώθηκε', 'success');
  loadCosts();
}

function initCostsDragAndDrop() {
  const tbody = document.getElementById('costs-tbody');
  if (!tbody) return;
  let dragSrc = null;

  tbody.querySelectorAll('.cost-row').forEach(row => {
    const handle = row.querySelector('.cost-drag');
    if (!handle) return;

    handle.addEventListener('mousedown', () => { row.draggable = true; });
    handle.addEventListener('mouseup',   () => { row.draggable = false; });

    row.addEventListener('dragstart', e => {
      dragSrc = row;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      tbody.querySelectorAll('.cost-row').forEach(r => r.classList.remove('drag-over'));
      saveCostsSortOrder();
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (row === dragSrc) return;
      tbody.querySelectorAll('.cost-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;
      const targetGroup = row.dataset.group;
      const srcGroup    = dragSrc.dataset.group;
      if (targetGroup && targetGroup !== '' && targetGroup !== srcGroup) {
        row.classList.remove('drag-over');
        toast('Δεν μπορείς να βάλεις εγγραφή μέσα σε ομάδα', 'error');
        return;
      }
      tbody.insertBefore(dragSrc, row);
      row.classList.remove('drag-over');
    });
  });
}

async function saveCostsSortOrder() {
  const rows = [...document.querySelectorAll('#costs-tbody .cost-row')];
  await Promise.all(rows.map((row, idx) =>
    db.from('trip_costs').update({ sort_order: idx }).eq('id', row.dataset.id)
  ));
  const idOrder = rows.map(r => r.dataset.id);
  state.currentCosts.sort((a,b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id));
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
        ${canWrite('customers') ? `
          <button class="btn-icon" onclick="editCustomer('${c.id}')">✏️</button>
          <button class="btn-icon danger" onclick="deleteCustomer('${c.id}')">🗑</button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}
