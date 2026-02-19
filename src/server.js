// src/server.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { prisma } = require('./db/client');
const availabilityRoutes = require('./routes/availability');
const bookingRoutes = require('./routes/booking');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ── Security ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for inline scripts in MVP
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ──────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Static Files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ─────────────────────────────────────────────────
app.use('/api/availability', availabilityRoutes);
app.use('/api/booking',      bookingRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/admin',        adminRoutes);

// ── Frontend catch-all ─────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Error Handler ──────────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function startServer() {
  // Run migrations on startup
  try {
    const { execSync } = require('child_process');
    console.log('🔄 Running database migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('✅ Migrations complete');
  } catch (err) {
    console.error('⚠️ Migration warning:', err.message);
  }

  app.listen(PORT, async () => {
    console.log(`✅ Justo Booking running on port ${PORT}`);
    try {
      await prisma.$connect();
      console.log('✅ Database connected');
    } catch (err) {
      console.error('❌ Database connection failed:', err.message);
    }
  });
}

startServer();

module.exports = app;
