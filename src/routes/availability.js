// src/routes/availability.js
const express = require('express');
const { query, validationResult } = require('express-validator');
const { getAvailableSlots } = require('../services/availabilityService');

const router = express.Router();

/**
 * GET /api/availability?timezone=America/Lima
 * Returns available slots grouped by date in prospect's timezone.
 */
router.get(
  '/',
  [
    query('timezone')
      .optional()
      .isString()
      .trim()
      .default('America/Lima'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const tz = req.query.timezone || 'America/Lima';
      const data = await getAvailableSlots(tz);
      res.json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
