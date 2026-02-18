// src/db/seed.js
require('dotenv').config();
const { prisma } = require('./client');

async function main() {
  console.log('🌱 Seeding database...');

  // Initialize routing state
  await prisma.routingState.upsert({
    where: { id: 'global' },
    update: {},
    create: { id: 'global' },
  });

  // Example sellers — replace with real data
  const sellers = [
    {
      name: 'Maria García',
      email: 'maria@justo.pe',
      country: 'PE',
      region: 'Lima',
      timezone: 'America/Lima',
      calendarId: 'maria@justo.pe',
      isActive: true,
    },
    {
      name: 'Carlos López',
      email: 'carlos@justo.mx',
      country: 'MX',
      region: 'CDMX',
      timezone: 'America/Mexico_City',
      calendarId: 'carlos@justo.mx',
      isActive: true,
    },
    {
      name: 'Ana Martínez',
      email: 'ana@justo.co',
      country: 'CO',
      region: 'Bogotá',
      timezone: 'America/Bogota',
      calendarId: 'ana@justo.co',
      isActive: true,
    },
  ];

  for (const seller of sellers) {
    await prisma.seller.upsert({
      where: { email: seller.email },
      update: seller,
      create: seller,
    });
    console.log(`  ✅ Seller: ${seller.name}`);
  }

  console.log('✅ Seed complete');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
