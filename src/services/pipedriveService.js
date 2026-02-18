// src/services/pipedriveService.js
const axios = require('axios');

const BASE_URL = `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1`;
const API_KEY = process.env.PIPEDRIVE_API_KEY;

const client = axios.create({
  baseURL: BASE_URL,
  params: { api_token: API_KEY },
  timeout: 10000,
});

/**
 * Find or create a Person in Pipedrive by email.
 */
async function findOrCreatePerson(prospect) {
  // Search by email first
  try {
    const search = await client.get('/persons/search', {
      params: { term: prospect.email, fields: 'email', exact_match: true },
    });

    if (search.data?.data?.items?.length) {
      return search.data.data.items[0].item.id;
    }
  } catch {
    // ignore search errors, will create
  }

  const res = await client.post('/persons', {
    name: prospect.name,
    email: [{ value: prospect.email, primary: true }],
    phone: [{ value: prospect.phone, primary: true }],
  });

  return res.data.data.id;
}

/**
 * Find or create an Organization (restaurant) in Pipedrive.
 */
async function findOrCreateOrganization(prospect) {
  try {
    const search = await client.get('/organizations/search', {
      params: { term: prospect.restaurantName, exact_match: false },
    });
    if (search.data?.data?.items?.length) {
      return search.data.data.items[0].item.id;
    }
  } catch {
    // ignore
  }

  const res = await client.post('/organizations', {
    name: prospect.restaurantName,
    address: `${prospect.city}, ${prospect.country}`,
  });

  return res.data.data.id;
}

/**
 * Create a Deal tagged as "Inbound Demo".
 *
 * @param {Object} meeting  Full meeting object with seller and prospect info
 * @returns {{ dealId: string, dealUrl: string }}
 */
async function createDeal(meeting, seller) {
  let personId, orgId;

  try {
    personId = await findOrCreatePerson(meeting);
    orgId = await findOrCreateOrganization(meeting);
  } catch (err) {
    console.error('Pipedrive person/org creation failed:', err.message);
  }

  const meetingDate = new Date(meeting.startUtc).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const dealPayload = {
    title: `Demo Justo — ${meeting.restaurantName}`,
    person_id: personId,
    org_id: orgId,
    status: 'open',
    label: 'Inbound Demo',
    // Custom fields — map these to your Pipedrive custom field keys
    // e.g. "abc123": meeting.country  (get keys from Pipedrive field settings)
    note: [
      '=== Inbound Demo Booking ===',
      `Restaurante: ${meeting.restaurantName}`,
      `Contacto: ${meeting.prospectName}`,
      `Email: ${meeting.prospectEmail}`,
      `Teléfono: ${meeting.prospectPhone}`,
      `Ciudad: ${meeting.city}`,
      `País: ${meeting.country}`,
      '',
      `Vendedor asignado: ${seller.name} (${seller.email})`,
      `Fecha reunión (UTC): ${meetingDate}`,
      `Estrategia de ruteo: ${meeting.routingStrategy}`,
    ].join('\n'),
  };

  const dealRes = await client.post('/deals', dealPayload);
  const deal = dealRes.data.data;

  // Add activity (meeting) to the deal
  await client.post('/activities', {
    subject: `Demo Justo — ${meeting.restaurantName}`,
    type: 'meeting',
    deal_id: deal.id,
    person_id: personId,
    org_id: orgId,
    due_date: new Date(meeting.startUtc).toISOString().split('T')[0],
    due_time: new Date(meeting.startUtc).toISOString().split('T')[1].slice(0, 5),
    duration: '00:30',
    user_id: undefined, // Pipedrive will assign to default user
    note: `Google Calendar event created. Seller: ${seller.name}`,
    done: 0,
  }).catch((err) => console.warn('Activity creation failed (non-fatal):', err.message));

  return {
    dealId: String(deal.id),
    dealUrl: `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/deal/${deal.id}`,
  };
}

module.exports = { createDeal };
