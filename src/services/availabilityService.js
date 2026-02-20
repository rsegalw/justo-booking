// src/services/availabilityService.js
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const { prisma } = require('../db/client');
const { getFreeBusy } = require('./googleCalendarService');

const SLOT_DURATION = parseInt(process.env.BOOKING_SLOT_DURATION_MIN || '30', 10);
const DAYS_AHEAD = parseInt(process.env.BOOKING_DAYS_AHEAD || '14', 10);
const START_HOUR = 9;   // 9:00 AM seller local time
const END_HOUR = 18;    // 6:00 PM seller local time

function generateCandidateSlots(sellerTimezone, fromUtc, toUtc) {
  const slots = [];
  let cursor = fromUtc.startOf('hour');

  while (cursor.isBefore(toUtc)) {
    const local = cursor.tz(sellerTimezone);
    const dayOfWeek = local.day(); // 0=Sun, 6=Sat
    const hour = local.hour();

    // Only Mon-Fri (1-5), 9:00-18:00
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= START_HOUR && hour < END_HOUR) {
      const end = cursor.add(SLOT_DURATION, 'minute');
      if (end.tz(sellerTimezone).hour() <= END_HOUR) {
        slots.push({ start: cursor.toISOString(), end: end.toISOString() });
      }
    }
    cursor = cursor.add(SLOT_DURATION, 'minute');
  }

  return slots;
}

function isSlotFree(slot, busyIntervals) {
  const slotStart = new Date(slot.start).getTime();
  const slotEnd = new Date(slot.end).getTime();
  return !busyIntervals.some((busy) => {
    const busyStart = new Date(busy.start).getTime();
    const busyEnd = new Date(busy.end).getTime();
    return slotStart < busyEnd && slotEnd > busyStart;
  });
}

async function getAvailableSlots(prospectTimezone) {
  const sellers = await prisma.seller.findMany({
    where: { isActive: true, NOT: { refreshToken: null } },
  });

  if (!sellers.length) return { dates: {} };

  const nowUtc = dayjs.utc();
  const toUtc = nowUtc.add(DAYS_AHEAD, 'day').endOf('day');

  const sellerBusy = await Promise.all(
    sellers.map(async (seller) => {
      try {
        const busy = await getFreeBusy(seller, nowUtc.toISOString(), toUtc.toISOString());
        return { seller, busy };
      } catch (err) {
        console.error(`⚠️  Could not fetch calendar for ${seller.email}:`, err.message);
        return { seller, busy: [] };
      }
    })
  );

  const confirmedMeetings = await prisma.meeting.findMany({
    where: { status: 'CONFIRMED', startUtc: { gte: nowUtc.toDate() } },
    select: { sellerId: true, startUtc: true, endUtc: true },
  });

  const busyMap = {};
  for (const { seller, busy } of sellerBusy) {
    busyMap[seller.id] = [...busy];
  }
  for (const m of confirmedMeetings) {
    if (!busyMap[m.sellerId]) busyMap[m.sellerId] = [];
    busyMap[m.sellerId].push({ start: m.startUtc.toISOString(), end: m.endUtc.toISOString() });
  }

  const slotMap = new Map();

  for (const { seller } of sellerBusy) {
    const candidates = generateCandidateSlots(seller.timezone, nowUtc, toUtc);
    const busy = busyMap[seller.id] || [];

    for (const slot of candidates) {
      if (isSlotFree(slot, busy)) {
        if (!slotMap.has(slot.start)) {
          slotMap.set(slot.start, { startUtc: slot.start, endUtc: slot.end, sellerCount: 0 });
        }
        slotMap.get(slot.start).sellerCount++;
      }
    }
  }

  // Group by prospect's local date
  const dates = {};
  for (const slot of slotMap.values()) {
    const localStart = dayjs(slot.startUtc).tz(prospectTimezone);
    const localEnd = dayjs(slot.endUtc).tz(prospectTimezone);
    const dateKey = localStart.format('YYYY-MM-DD');

    if (!dates[dateKey]) dates[dateKey] = [];
    dates[dateKey].push({
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      startLocal: localStart.format('HH:mm'),
      endLocal: localEnd.format('HH:mm'),
      sellerCount: slot.sellerCount,
    });
  }

  for (const date of Object.keys(dates)) {
    dates[date].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  return { dates, timezone: prospectTimezone };
}

module.exports = { getAvailableSlots };
