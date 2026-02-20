// src/routes/admin.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { prisma } = require('../db/client');

const router = express.Router();

// Simple API key auth for admin routes
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Apply admin auth to all routes in this router
router.use(adminAuth);

// ── Sellers ────────────────────────────────────────────────

/** GET /api/admin/sellers */
router.get('/sellers', async (req, res, next) => {
  try {
    const sellers = await prisma.seller.findMany({
      select: {
        id: true, name: true, email: true, country: true,
        region: true, timezone: true, isActive: true,
        calendarId: true, lastAssigned: true, totalMeetings: true,
        tokenExpiry: true,
        accessToken: false, // never expose tokens
        refreshToken: false,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, sellers });
  } catch (err) { next(err); }
});

/** POST /api/admin/sellers */
router.post('/sellers', [
  body('name').isString().trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('country').isString().trim().isLength({ min: 2, max: 2 }).toUpperCase(),
  body('timezone').isString().trim().notEmpty(),
  body('calendarId').isEmail(),
  body('region').optional().isString().trim(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const seller = await prisma.seller.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        country: req.body.country,
        timezone: req.body.timezone,
        calendarId: req.body.calendarId,
        region: req.body.region,
        isActive: req.body.isActive ?? true,
      },
    });
    res.status(201).json({ success: true, seller: { ...seller, accessToken: undefined, refreshToken: undefined } });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/sellers/:id */
router.patch('/sellers/:id', async (req, res, next) => {
  const allowed = ['name', 'country', 'region', 'timezone', 'calendarId', 'isActive'];
  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  try {
    const seller = await prisma.seller.update({ where: { id: req.params.id }, data });
    res.json({ success: true, seller: { ...seller, accessToken: undefined, refreshToken: undefined } });
  } catch (err) { next(err); }
});

/** GET /api/admin/sellers/:id/connect-calendar */
router.get('/sellers/:id/connect-calendar', (req, res) => {
  res.redirect(`/api/auth/google/${req.params.id}`);
});

// ── Meetings ───────────────────────────────────────────────

/** GET /api/admin/meetings */
router.get('/meetings', async (req, res, next) => {
  try {
    const meetings = await prisma.meeting.findMany({
      include: { seller: { select: { name: true, email: true } } },
      orderBy: { startUtc: 'desc' },
      take: 100,
    });
    res.json({ success: true, meetings });
  } catch (err) { next(err); }
});

// ── Metrics ────────────────────────────────────────────────

/** GET /api/admin/metrics */
router.get('/metrics', async (req, res, next) => {
  try {
    const [perSeller, perCountry, total] = await Promise.all([
      prisma.seller.findMany({
        select: { name: true, email: true, country: true, totalMeetings: true, lastAssigned: true },
        orderBy: { totalMeetings: 'desc' },
      }),
      prisma.meeting.groupBy({
        by: ['country'],
        _count: { id: true },
        where: { status: 'CONFIRMED' },
      }),
      prisma.meeting.count({ where: { status: 'CONFIRMED' } }),
    ]);

    res.json({
      success: true,
      metrics: {
        totalMeetings: total,
        perSeller,
        perCountry: perCountry.map((r) => ({ country: r.country, count: r._count.id })),
      },
    });
  } catch (err) { next(err); }
});



/** POST /api/admin/sellers/:id/send-calendar-invite */
router.post('/sellers/:id/send-calendar-invite', async (req, res, next) => {
  try {
    const seller = await prisma.seller.findUnique({ where: { id: req.params.id } });
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const { getAuthUrl } = require('../services/googleCalendarService');
    const { sendCalendarSyncEmail } = require('../services/emailService');

    const authUrl = getAuthUrl(seller.id);
    await sendCalendarSyncEmail(seller, authUrl);

    res.json({ success: true, message: `Email enviado a ${seller.email}` });
  } catch (err) { next(err); }
});
module.exports = router;
