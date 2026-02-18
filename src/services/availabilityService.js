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
const START_HOUR = parseInt(process.env.BOOKING_START_HOUR || '8', 10);
const END_HOUR = parseInt(process.env.BOOKING_END_HOUR || '18', 10);

/**
 * Generate candidate 30-min slots for a seller within a date range,
 * bounded by their business hours in their local timezone.
 *
 * @param {string} sellerTimezone  IANA timezone
 * @param {dayjs.Dayjs} fromUtc
 * @param {dayjs.Dayjs} toUtc
 * @returns {Array<{start: string, end: string}>} UTC ISO strings
 */
function generateCandidateSlots(sellerTimezone, fromUtc, toUtc) {
  const slots = [];
  let cursor = fromUtc.startOf('hour');

  while (cursor.isBefore(toUtc)) {
    const localHour = cursor.tz(sellerTimezone).hour();

    if (localHour >= START_HOUR && localHour < END_HOUR) {
      const end = cursor.add(SLOT_DURATION, 'minute');
      // Don't add slots that extend past END_HOUR
      if (end.tz(sellerTimezone).hour() <= END_HOUR) {
        slots.push({ start: cursor.toISOString(), end: end.toISOString() });
      }
    }
    cursor = cursor.add(SLOT_DURATION, 'minute');
  }

  return slots;
}

/**
 * Check if a candidate slot overlaps with any busy interval.
 */
function isSlotFree(slot, busyIntervals) {
  const slotStart = new Date(slot.start).getTime();
  const slotEnd = new Date(slot.end).getTime();

  return !busyIntervals.some((busy) => {
    const busyStart = new Date(busy.start).getTime();
    const busyEnd = new Date(busy.end).getTime();
    return slotStart < busyEnd && slotEnd > busyStart;
  });
}

/**
 * Get all available slots across all active sellers.
 * Returns slots grouped by date, with at least one available seller per slot.
 *
 * @param {string} prospectTimezone  IANA timezone for display
 * @returns {Object} { dates: { "2024-03-01": [{ startUtc, endUtc, startLocal, endLocal }] } }
 */
async function getAvailableSlots(prospectTimezone) {
  const sellers = await prisma.seller.findMany({
    where: { isActive: true, NOT: { refreshToken: null } },
  });

  if (!sellers.length) return { dates: {} };

  const nowUtc = dayjs.utc();
  const toUtc = nowUtc.add(DAYS_AHEAD, 'day').endOf('day');

  // Fetch free/busy for all sellers in parallel
  const sellerBusy = await Promise.all(
    sellers.map(async (seller) => {
      try {
        const busy = await getFreeBusy(
          seller,
          nowUtc.toISOString(),
          toUtc.toISOString()
        );
        return { seller, busy };
      } catch (err) {
        console.error(`⚠️  Could not fetch calendar for ${seller.email}:`, err.message);
        return { seller, busy: [] };
      }
    })
  );

  // Also get confirmed meetings from our DB (source of truth for double-booking check)
  const confirmedMeetings = await prisma.meeting.findMany({
    where: {
      status: 'CONFIRMED',
      startUtc: { gte: nowUtc.toDate() },
    },
    select: { sellerId: true, startUtc: true, endUtc: true },
  });

  // Build a map: sellerId → busy intervals (Google + our DB)
  const busyMap = {};
  for (const { seller, busy } of sellerBusy) {
    busyMap[seller.id] = [...busy];
  }
  for (const m of confirmedMeetings) {
    if (!busyMap[m.sellerId]) busyMap[m.sellerId] = [];
    busyMap[m.sellerId].push({ start: m.startUtc.toISOString(), end: m.endUtc.toISOString() });
  }

  // Collect all unique free slots across sellers
  const slotMap = new Map(); // key: startUtc ISO → { startUtc, endUtc, sellerCount }

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

  // Convert to prospect's timezone, group by local date
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

  // Sort slots within each date
  for (const date of Object.keys(dates)) {
    dates[date].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  return { dates, timezone: prospectTimezone };
}

module.exports = { getAvailableSlots };
