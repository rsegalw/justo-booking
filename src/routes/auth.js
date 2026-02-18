// src/routes/auth.js
const express = require('express');
const { getAuthUrl, handleAuthCallback } = require('../services/googleCalendarService');

const router = express.Router();

/**
 * GET /api/auth/google/:sellerId
 * Redirects the seller to Google's OAuth consent screen.
 */
router.get('/google/:sellerId', (req, res) => {
  const url = getAuthUrl(req.params.sellerId);
  res.redirect(url);
});

/**
 * GET /api/auth/google/callback
 * Google redirects here after the seller grants permissions.
 * state = sellerId
 */
router.get('/google/callback', async (req, res) => {
  const { code, state: sellerId, error } = req.query;

  if (error) {
    return res.redirect(`/admin?error=${encodeURIComponent(error)}`);
  }

  if (!code || !sellerId) {
    return res.status(400).send('Missing code or state parameter.');
  }

  try {
    await handleAuthCallback(code, sellerId);
    res.redirect('/admin?connected=true');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect(`/admin?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
