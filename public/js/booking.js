// public/js/booking.js

// ── State ──────────────────────────────────────────────────
const state = {
  step: 1,
  formData: {},
  allSlots: {},       // { "2024-03-01": [{startUtc, endUtc, startLocal, endLocal}] }
  selectedSlot: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Lima',
  currentWeekOffset: 0, // 0 = current week
  booking: null,
};

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tzDisplay').textContent = state.timezone;
  document.getElementById('qualForm').addEventListener('submit', handleFormSubmit);
});

// ── Navigation ─────────────────────────────────────────────
function goToStep(n) {
  document.querySelectorAll('[id^="step-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById(`step-${n}`).classList.remove('hidden');

  document.querySelectorAll('.step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s === n);
    el.classList.toggle('completed', s < n);
  });

  state.step = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Step 1: Form ───────────────────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  state.formData = {
    name: v('name'),
    email: v('email'),
    phone: v('phone'),
    restaurantName: v('restaurantName'),
    city: v('city'),
    country: document.getElementById('country').value,
  };

  goToStep(2);
  loadSlots();
}

function v(id) {
  return document.getElementById(id).value.trim();
}

function validateForm() {
  let valid = true;

  const rules = {
    name: { min: 2, label: 'nombre' },
    email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, label: 'email válido' },
    phone: { min: 6, label: 'teléfono' },
    restaurantName: { min: 2, label: 'nombre del restaurante' },
    city: { min: 2, label: 'ciudad' },
    country: { required: true, label: 'país' },
  };

  for (const [id, rule] of Object.entries(rules)) {
    const el = document.getElementById(id);
    const errEl = document.getElementById(`${id}-err`);
    const val = el.value.trim();
    let err = '';

    if (rule.required && !val) {
      err = `Selecciona tu ${rule.label}`;
    } else if (rule.min && val.length < rule.min) {
      err = `Ingresa un ${rule.label} válido`;
    } else if (rule.pattern && !rule.pattern.test(val)) {
      err = `Ingresa un ${rule.label}`;
    }

    el.classList.toggle('invalid', !!err);
    if (errEl) errEl.textContent = err;
    if (err) valid = false;
  }

  return valid;
}

// ── Step 2: Slots ──────────────────────────────────────────
async function loadSlots() {
  const container = document.getElementById('slotsContainer');
  container.innerHTML = '<div class="loading">Cargando horarios disponibles...</div>';

  try {
    const res = await fetch(`/api/availability?timezone=${encodeURIComponent(state.timezone)}`);
    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Error loading slots');

    state.allSlots = data.dates || {};
    renderWeek();
  } catch (err) {
    container.innerHTML = `<div class="no-slots"><p>❌ Error al cargar horarios: ${err.message}</p></div>`;
  }
}

function getWeekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() + state.currentWeekOffset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function renderWeek() {
  const { start, end } = getWeekDates();
  const container = document.getElementById('slotsContainer');

  // Update nav
  document.getElementById('prevWeek').disabled = state.currentWeekOffset <= 0;
  document.getElementById('weekRange').textContent =
    `${fmt(start)} — ${fmt(end)}`;

  // Filter slots for this week
  const weekSlots = {};
  for (const [date, slots] of Object.entries(state.allSlots)) {
    const d = new Date(date + 'T00:00:00');
    if (d >= start && d <= end) weekSlots[date] = slots;
  }

  if (!Object.keys(weekSlots).length) {
    container.innerHTML = `
      <div class="no-slots">
        <div style="font-size:2rem">📅</div>
        <p>No hay horarios disponibles esta semana.</p>
        <p>Prueba la semana siguiente.</p>
      </div>`;
    return;
  }

  let html = '';
  for (const [date, slots] of Object.entries(weekSlots).sort()) {
    const label = new Date(date + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    html += `<div class="date-group">
      <div class="date-label">${label}</div>
      <div class="slot-grid">`;
    for (const slot of slots) {
      html += `<button class="slot-btn" onclick="selectSlot(this, '${slot.startUtc}', '${slot.endUtc}', '${slot.startLocal}', '${slot.endLocal}')">
        ${slot.startLocal}
      </button>`;
    }
    html += `</div></div>`;
  }
  container.innerHTML = html;
}

function prevWeek() {
  if (state.currentWeekOffset <= 0) return;
  state.currentWeekOffset--;
  renderWeek();
}
function nextWeek() {
  state.currentWeekOffset++;
  renderWeek();
}

function fmt(d) {
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

async function selectSlot(btn, startUtc, endUtc, startLocal, endLocal) {
  // Visual feedback
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  btn.disabled = true;
  btn.textContent = '⏳';

  state.selectedSlot = { startUtc, endUtc, startLocal, endLocal };

  await confirmBooking(btn);
}

// ── Step 3: Book ───────────────────────────────────────────
async function confirmBooking(btn) {
  const payload = {
    ...state.formData,
    startUtc: state.selectedSlot.startUtc,
    timezone: state.timezone,
  };

  try {
    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.errors?.[0]?.msg || data.error || 'Error al confirmar';
      showToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = `${state.selectedSlot.startLocal}`;
      btn.classList.remove('selected');
      return;
    }

    state.booking = data.meeting;
    renderConfirmation(data.meeting);
    goToStep(3);

  } catch (err) {
    showToast('Error de conexión. Intenta de nuevo.', 'error');
    btn.disabled = false;
    btn.textContent = `${state.selectedSlot.startLocal}`;
    btn.classList.remove('selected');
  }
}

function renderConfirmation(meeting) {
  const { start, end } = formatMeetingTime(meeting.startUtc, meeting.endUtc);

  document.getElementById('confirmDetails').innerHTML = `
    <p>📅 <strong>Fecha y hora:</strong> ${start} – ${end}</p>
    <p>🏪 <strong>Restaurante:</strong> ${state.formData.restaurantName}</p>
    <p>👤 <strong>Vendedor asignado:</strong> ${meeting.seller?.name || 'Equipo Justo'}</p>
    <p>📧 <strong>Confirmación enviada a:</strong> ${state.formData.email}</p>
  `;

  if (meeting.calendarLink) {
    const calLink = document.getElementById('calLink');
    calLink.href = meeting.calendarLink;
    calLink.classList.remove('hidden');
  }
}

function formatMeetingTime(startUtc, endUtc) {
  const opts = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: state.timezone };
  const start = new Date(startUtc).toLocaleString('es-ES', opts);
  const end = new Date(endUtc).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: state.timezone });
  return { start, end };
}

// ── Toast ──────────────────────────────────────────────────
function showToast(message, type = '') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), 3500);
}
