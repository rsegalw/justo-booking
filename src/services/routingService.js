// src/services/routingService.js
/**
 * Modular routing engine.
 *
 * Strategy interface:
 *   assignSeller(availableSellers: Seller[], context: RoutingContext) → Seller
 *
 * Context shape:
 *   { prospectCountry, prospectCity, slotStartUtc, currentRouteState }
 *
 * To add a new strategy:
 *   1. Create a function matching the interface below
 *   2. Add it to STRATEGIES map
 *   3. Change ACTIVE_STRATEGY env var or call selectStrategy()
 */

const { prisma } = require('../db/client');

// ── Strategy: Round Robin ──────────────────────────────────
async function roundRobin(availableSellers, _context, routingState) {
  if (!availableSellers.length) return null;

  const lastId = routingState?.lastSellerId;
  const idx = availableSellers.findIndex((s) => s.id === lastId);

  // Pick next seller after the last assigned one, wrapping around
  const nextSeller = availableSellers[(idx + 1) % availableSellers.length];
  return nextSeller;
}

// ── Strategy: Lowest Load ──────────────────────────────────
// Placeholder — picks seller with fewest total meetings this month
async function lowestLoad(availableSellers, _context) {
  return availableSellers.reduce((min, s) =>
    s.totalMeetings < min.totalMeetings ? s : min
  );
}

// ── Strategy: By Country ───────────────────────────────────
async function byCountry(availableSellers, context) {
  const countryMatch = availableSellers.filter(
    (s) => s.country === context.prospectCountry
  );
  // Fall back to round robin if no country match
  if (countryMatch.length) return countryMatch[0];
  return roundRobin(availableSellers, context);
}

// ── Strategy: By Timezone ──────────────────────────────────
async function byTimezone(availableSellers, context) {
  // Prefer sellers whose timezone offset is closest to prospect's
  // (Requires dayjs/timezone — simplified here as placeholder)
  return roundRobin(availableSellers, context);
}

// ── Registry ───────────────────────────────────────────────
const STRATEGIES = {
  round_robin: roundRobin,
  lowest_load: lowestLoad,
  by_country: byCountry,
  by_timezone: byTimezone,
};

const ACTIVE_STRATEGY = process.env.ROUTING_STRATEGY || 'round_robin';

/**
 * Main entrypoint: assign a seller to a slot.
 * Returns { seller, strategy } or null if no seller available.
 */
async function assignSeller(availableSellerIds, context = {}) {
  const sellers = await prisma.seller.findMany({
    where: {
      id: { in: availableSellerIds },
      isActive: true,
    },
  });

  if (!sellers.length) return null;

  const routingState = await prisma.routingState.findUnique({
    where: { id: 'global' },
  });

  const strategy = STRATEGIES[ACTIVE_STRATEGY] || roundRobin;
  const selected = await strategy(sellers, context, routingState);

  if (!selected) return null;

  // Update routing state
  await prisma.routingState.upsert({
    where: { id: 'global' },
    update: { lastSellerId: selected.id },
    create: { id: 'global', lastSellerId: selected.id },
  });

  return { seller: selected, strategy: ACTIVE_STRATEGY };
}

module.exports = { assignSeller };
