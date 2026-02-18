// src/routes/booking.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const { prisma } = require('../db/client');
const { acquireLock, releaseLock, slotLockKey } = require('../services/lockService');
const { assignSeller } = require('../services/routingService');
const { getFreeBusy, createEvent } = require('../services/googleCalendarService');
const { createDeal } = require('../services/pipedriveService');
const { sendConfirmation } = require('../services/emailService');

const router = express.Router();

const SLOT_DURATION = parseInt(process.env.BOOKING_SLOT_DURATION_MIN || '30', 10);

// ── Validation rules ───────────────────────────────────────
const bookingValidation = [
  body('startUtc').isISO8601().withMessage('startUtc must be a valid ISO 8601 datetime'),
  body('timezone').isString().trim().notEmpty(),
  body('name').isString().trim().isLength({ min: 2, max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('phone').isString().trim().isLength({ min: 6, max: 30 }),
  body('restaurantName').isString().trim().isLength({ min: 2, max: 200 }),
  body('city').isString().trim().isLength({ min: 2, max: 100 }),
  body('country').isString().trim().isLength({ min: 2, max: 2 }).toUpperCase(),
];

/**
 * POST /api/booking
 * Books a meeting slot.
 */
router.post('/', bookingValidation, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { startUtc, timezone, name, email, phone, restaurantName, city, country } = req.body;

  const startDt = dayjs.utc(startUtc);
  const endDt = startDt.add(SLOT_DURATION, 'minute');

  if (startDt.isBefore(dayjs.utc())) {
    return res.status(400).json({ error: 'Cannot book a slot in the past.' });
  }

  // ── 1. Find available sellers for this slot ──────────────
  const allSellers = await prisma.seller.findMany({
    where: { isActive: true, NOT: { refreshToken: null } },
  });

  if (!allSellers.length) {
    return res.status(503).json({ error: 'No sellers available. Please try again later.' });
  }

  // Check each seller's availability
  const availableSellers = [];
  await Promise.all(
    allSellers.map(async (seller) => {
      try {
        const busy = await getFreeBusy(seller, startDt.toISOString(), endDt.toISOString());
        const hasConflict = busy.some((b) => {
          const bStart = new Date(b.start).getTime();
          const bEnd = new Date(b.end).getTime();
          return startDt.valueOf() < bEnd && endDt.valueOf() > bStart;
        });

        // Also check our DB
        const dbConflict = await prisma.meeting.findFirst({
          where: {
            sellerId: seller.id,
            status: 'CONFIRMED',
            OR: [
              { startUtc: { gte: startDt.toDate(), lt: endDt.toDate() } },
              { endUtc: { gt: startDt.toDate(), lte: endDt.toDate() } },
              { startUtc: { lte: startDt.toDate() }, endUtc: { gte: endDt.toDate() } },
            ],
          },
        });

        if (!hasConflict && !dbConflict) {
          availableSellers.push(seller);
        }
      } catch (err) {
        console.error(`Calendar check failed for ${seller.email}:`, err.message);
      }
    })
  );

  if (!availableSellers.length) {
    return res.status(409).json({ error: 'This slot is no longer available. Please choose another.' });
  }

  // ── 2. Assign seller via routing engine ──────────────────
  const routing = await assignSeller(
    availableSellers.map((s) => s.id),
    { prospectCountry: country, prospectCity: city, slotStartUtc: startDt.toISOString() }
  );

  if (!routing) {
    return res.status(503).json({ error: 'Could not assign a seller. Please try again.' });
  }

  const { seller, strategy } = routing;

  // ── 3. Acquire distributed lock ──────────────────────────
  const lockKey = slotLockKey(seller.id, startDt.toISOString());
  const locked = await acquireLock(lockKey);

  if (!locked) {
    return res.status(409).json({ error: 'Slot just taken. Please choose another.' });
  }

  let meetingId;
  try {
    // ── 4. Create meeting record (tentative) ───────────────
    const meeting = await prisma.meeting.create({
      data: {
        sellerId: seller.id,
        prospectName: name,
        prospectEmail: email,
        prospectPhone: phone,
        restaurantName,
        city,
        country,
        startUtc: startDt.toDate(),
        endUtc: endDt.toDate(),
        timezone,
        routingStrategy: strategy,
        status: 'CONFIRMED',
      },
    });
    meetingId = meeting.id;

    // ── 5. Create Google Calendar event ───────────────────
    let eventData;
    try {
      eventData = await createEvent(seller, { ...meeting, startUtc: startDt.toDate(), endUtc: endDt.toDate() });
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          googleEventId: eventData.eventId,
          calendarLink: eventData.htmlLink,
        },
      });
    } catch (err) {
      console.error('Google Calendar event creation failed:', err.message);
      // Non-fatal — meeting is still saved in our DB
    }

    // ── 6. Create Pipedrive Deal ───────────────────────────
    let dealData;
    try {
      dealData = await createDeal({ ...meeting, calendarLink: eventData?.htmlLink }, seller);
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          pipedriveId: dealData.dealId,
          pipedriveDealUrl: dealData.dealUrl,
        },
      });
    } catch (err) {
      console.error('Pipedrive deal creation failed:', err.message);
      // Non-fatal
    }

    // ── 7. Update seller metrics ───────────────────────────
    await prisma.seller.update({
      where: { id: seller.id },
      data: {
        lastAssigned: new Date(),
        totalMeetings: { increment: 1 },
      },
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.sellerMetric.upsert({
      where: { sellerId_country_date: { sellerId: seller.id, country, date: today } },
      update: { meetingCount: { increment: 1 } },
      create: { sellerId: seller.id, country, date: today, meetingCount: 1 },
    });

    // ── 8. Send confirmation emails ────────────────────────
    const fullMeeting = await prisma.meeting.findUnique({ where: { id: meeting.id } });
    sendConfirmation(fullMeeting, seller).catch((err) =>
      console.error('Email send failed (non-fatal):', err.message)
    );

    // ── Release lock ───────────────────────────────────────
    await releaseLock(lockKey);

    return res.status(201).json({
      success: true,
      meeting: {
        id: meeting.id,
        startUtc: startDt.toISOString(),
        endUtc: endDt.toISOString(),
        seller: { name: seller.name, email: seller.email },
        calendarLink: eventData?.htmlLink,
        pipedriveDealUrl: dealData?.dealUrl,
      },
    });
  } catch (err) {
    await releaseLock(lockKey);
    // Roll back meeting if created
    if (meetingId) {
      await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => {});
    }
    next(err);
  }
});

/**
 * GET /api/booking/:id — fetch a booking confirmation
 */
router.get('/:id', async (req, res, next) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.id },
      include: { seller: { select: { name: true, email: true, timezone: true } } },
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    res.json({ success: true, meeting });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
