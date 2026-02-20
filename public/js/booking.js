// public/js/booking.js

const state = {
  step: 1,
  restaurantData: {},  // step 1
  selectedSlot: null,  // step 2
  contactData: {},     // step 3
  allSlots: {},
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Lima',
  currentWeekOffset: 0,
  booking: null,
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tzDisplay').textContent = state.timezone;
  document.getElementById('restaurantForm').addEventListener('submit', handleRestaurantSubmit);
  document.getElementById('contactForm').addEventListener('submit', handleContactSubmit);
});

// ── Navigation ──────────────────────────────────────────────
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

// ── Step 1: Restaurant info ──────────────────────────────────
function handleRestaurantSubmit(e) {
  e.preventDefault();
  const restaurantName = document.getElementById('restaurantName').value.trim();
  const category = document.getElementById('category').value;
  const locations = document.getElementById('locations').value;

  let valid = true;
  const clear = id => { document.getElementById(id+'-err').textContent=''; document.getElementById(id).classList.remove('invalid'); };
  const err = (id, msg) => { document.getElementById(id+'-err').textContent=msg; document.getElementById(id).classList.add('invalid'); valid=false; };

  clear('restaurantName'); clear('category'); clear('locations');

  if (restaurantName.length < 2) err('restaurantName', 'Ingresa el nombre de tu restaurante');
  if (!category) err('category', 'Selecciona una categoría');
  if (!locations) err('locations', 'Selecciona la cantidad de locales');

  if (!valid) return;

  state.restaurantData = { restaurantName, category, locations };
  goToStep(2);
  loadSlots();
}

// ── Step 2: Slot Picker ──────────────────────────────────────
async function loadSlots() {
  const container = document.getElementById('slotsContainer');
  container.innerHTML = '<div class="loading">Cargando horarios disponibles...</div>';

  try {
    const res = await fetch(`/api/availability?timezone=${encodeURIComponent(state.timezone)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Error cargando horarios');
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

  document.getElementById('prevWeek').disabled = state.currentWeekOffset <= 0;
  document.getElementById('weekRange').textContent = `${fmt(start)} — ${fmt(end)}`;

  // Filter: only Mon-Fri slots for this week
  const weekSlots = {};
  for (const [date, slots] of Object.entries(state.allSlots)) {
    const d = new Date(date + 'T12:00:00');
    const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
    if (d >= start && d <= end && dayOfWeek >= 1 && dayOfWeek <= 5) {
      // Only 9:00-18:00 in prospect's timezone
      const filtered = slots.filter(s => {
        const hour = parseInt(s.startLocal.split(':')[0], 10);
        return hour >= 9 && hour < 18;
      });
      if (filtered.length) weekSlots[date] = filtered;
    }
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

function prevWeek() { if (state.currentWeekOffset <= 0) return; state.currentWeekOffset--; renderWeek(); }
function nextWeek() { state.currentWeekOffset++; renderWeek(); }
function fmt(d) { return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }

function selectSlot(btn, startUtc, endUtc, startLocal, endLocal) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.selectedSlot = { startUtc, endUtc, startLocal, endLocal };

  // Show selected slot in step 3 header
  const dateStr = new Date(startUtc).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: state.timezone
  });
  document.getElementById('selectedSlotDisplay').textContent = dateStr;

  goToStep(3);
}

// ── Step 3: Contact form ──────────────────────────────────────
function handleContactSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const city = document.getElementById('city').value.trim();
  const country = document.getElementById('country').value;

  let valid = true;
  const clear = id => { document.getElementById(id+'-err').textContent=''; document.getElementById(id).classList.remove('invalid'); };
  const err = (id, msg) => { document.getElementById(id+'-err').textContent=msg; document.getElementById(id).classList.add('invalid'); valid=false; };

  ['name','email','phone','city','country'].forEach(clear);

  if (name.length < 2) err('name', 'Ingresa tu nombre');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('email', 'Ingresa un email válido');
  if (phone.length < 6) err('phone', 'Ingresa tu teléfono');
  if (city.length < 2) err('city', 'Ingresa tu ciudad');
  if (!country) err('country', 'Selecciona tu país');

  if (!valid) return;

  state.contactData = { name, email, phone, city, country };
  confirmBooking();
}

async function confirmBooking() {
  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Confirmando...';

  const payload = {
    name: state.contactData.name,
    email: state.contactData.email,
    phone: state.contactData.phone,
    restaurantName: state.restaurantData.restaurantName,
    city: state.contactData.city,
    country: state.contactData.country,
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
      btn.textContent = 'Confirmar demo →';
      return;
    }

    state.booking = data.meeting;
    renderConfirmation(data.meeting);
    goToStep(4);

  } catch (err) {
    showToast('Error de conexión. Intenta de nuevo.', 'error');
    btn.disabled = false;
    btn.textContent = 'Confirmar demo →';
  }
}

function renderConfirmation(meeting) {
  const opts = { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', timeZone: state.timezone };
  const start = new Date(meeting.startUtc).toLocaleString('es-ES', opts);

  document.getElementById('confirmDetails').innerHTML = `
    <p>📅 <strong>Fecha y hora:</strong> ${start}</p>
    <p>🏪 <strong>Restaurante:</strong> ${state.restaurantData.restaurantName}</p>
    <p>👤 <strong>Vendedor asignado:</strong> ${meeting.seller?.name || 'Equipo Justo'}</p>
    <p>📧 <strong>Confirmación enviada a:</strong> ${state.contactData.email}</p>
  `;

  if (meeting.calendarLink) {
    const calLink = document.getElementById('calLink');
    calLink.href = meeting.calendarLink;
    calLink.classList.remove('hidden');
  }
}

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
