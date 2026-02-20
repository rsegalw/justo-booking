// src/services/googleCalendarService.js
const { google } = require('googleapis');
const { prisma } = require('../db/client');

/**
 * Build an authenticated OAuth2 client for a given seller.
 * Automatically refreshes tokens when expired.
 */
async function getOAuthClient(seller) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    (process.env.GOOGLE_REDIRECT_URI || "https://justo-booking-production.up.railway.app/api/auth/google/callback")
  );

  oauth2Client.setCredentials({
    access_token: seller.accessToken,
    refresh_token: seller.refreshToken,
    expiry_date: seller.tokenExpiry ? seller.tokenExpiry.getTime() : null,
  });

  // Auto-refresh listener — persist new tokens to DB
  oauth2Client.on('tokens', async (tokens) => {
    const update = {};
    if (tokens.access_token) update.accessToken = tokens.access_token;
    if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date) update.tokenExpiry = new Date(tokens.expiry_date);
    if (Object.keys(update).length) {
      await prisma.seller.update({ where: { id: seller.id }, data: update });
    }
  });

  return oauth2Client;
}

/**
 * Get free/busy data for a seller between two UTC dates.
 * @returns {Array<{start: string, end: string}>} busy intervals in UTC ISO
 */
async function getFreeBusy(seller, timeMinUtc, timeMaxUtc) {
  const auth = await getOAuthClient(seller);
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinUtc,
      timeMax: timeMaxUtc,
      timeZone: 'UTC',
      items: [{ id: seller.calendarId }],
    },
  });

  return (res.data.calendars[seller.calendarId]?.busy || []);
}

/**
 * Create a Google Calendar event for a confirmed meeting.
 * @returns {{ eventId: string, htmlLink: string }}
 */
async function createEvent(seller, meeting) {
  const auth = await getOAuthClient(seller);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: `Demo Justo — ${meeting.restaurantName} (${meeting.prospectName})`,
    description: [
      `Restaurante: ${meeting.restaurantName}`,
      `Contacto: ${meeting.prospectName}`,
      `Email: ${meeting.prospectEmail}`,
      `Teléfono: ${meeting.prospectPhone}`,
      `Ciudad: ${meeting.city}, ${meeting.country}`,
      '',
      `Deal Pipedrive: ${meeting.pipedriveDealUrl || 'Pendiente'}`,
    ].join('\n'),
    start: {
      dateTime: meeting.startUtc.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: meeting.endUtc.toISOString(),
      timeZone: 'UTC',
    },
    attendees: [
      { email: seller.email, displayName: seller.name },
      { email: meeting.prospectEmail, displayName: meeting.prospectName },
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
    conferenceData: {
      createRequest: {
        requestId: meeting.id,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const res = await calendar.events.insert({
    calendarId: seller.calendarId,
    resource: event,
    conferenceDataVersion: 1,
    sendUpdates: 'all', // send invites to attendees
  });

  return {
    eventId: res.data.id,
    htmlLink: res.data.htmlLink,
    meetLink: res.data.conferenceData?.entryPoints?.[0]?.uri || null,
  };
}

/**
 * Generate Google OAuth URL for a seller to connect their calendar.
 */
function getAuthUrl(sellerId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    (process.env.GOOGLE_REDIRECT_URI || "https://justo-booking-production.up.railway.app/api/auth/google/callback")
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    state: sellerId, // passed back in callback to identify seller
  });
}

/**
 * Exchange authorization code for tokens and save to seller record.
 */
async function handleAuthCallback(code, sellerId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    (process.env.GOOGLE_REDIRECT_URI || "https://justo-booking-production.up.railway.app/api/auth/google/callback")
  );

  const { tokens } = await oauth2Client.getToken(code);

  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });

  return tokens;
}

module.exports = { getFreeBusy, createEvent, getAuthUrl, handleAuthCallback };
