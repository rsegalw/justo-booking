# Justo Smart Meeting Routing System
## Complete Setup, Architecture & Deployment Guide

---

## 1. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                     PROSPECT (Browser)                      │
│         Qualification Form → Slot Picker → Confirmation     │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────┐
│                    Express.js API (Node 20)                  │
│  /api/availability  /api/booking  /api/auth  /api/admin     │
└──────┬─────────────────┬──────────────┬─────────────────────┘
       │                 │              │
┌──────▼──────┐  ┌───────▼──────┐  ┌───▼────────────────────┐
│  PostgreSQL  │  │    Redis     │  │  External Services     │
│  (Prisma)   │  │  (Locks)     │  │  - Google Calendar API │
│             │  │              │  │  - Pipedrive API       │
│ - Sellers   │  │  Slot locks  │  │  - SMTP / Email        │
│ - Meetings  │  │  TTL: 120s   │  └────────────────────────┘
│ - Metrics   │  └──────────────┘
│ - Routing   │
└─────────────┘
```

### Request Flow (Booking)
```
1. Prospect fills qualification form
2. Browser detects timezone automatically
3. GET /api/availability → fetches free/busy from all seller calendars in parallel
4. Prospect selects a slot
5. POST /api/booking:
   a. Validate inputs
   b. Re-check availability for each active seller
   c. Run routing algorithm (Round Robin) → assign seller
   d. Acquire Redis lock on slot (120s TTL)
   e. Create DB record (status: CONFIRMED)
   f. Create Google Calendar event (with Google Meet link)
   g. Create Pipedrive Deal + Activity
   h. Update seller metrics
   i. Send confirmation emails (prospect + seller)
   j. Release lock
   k. Return success
```

---

## 2. DATABASE DESIGN

### Tables

**sellers** — One row per seller
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | String | |
| email | String UNIQUE | |
| country | String | ISO 3166-1 alpha-2 |
| region | String? | e.g. "Lima Norte" |
| timezone | String | IANA (e.g. "America/Lima") |
| isActive | Boolean | Enable/disable without deleting |
| calendarId | String | Usually equals email |
| accessToken | String | Google OAuth (encrypted) |
| refreshToken | String | Google OAuth |
| tokenExpiry | DateTime | Auto-refresh when expired |
| lastAssigned | DateTime | Used by routing engine |
| totalMeetings | Int | Denormalized counter |

**meetings** — One row per booked demo
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| sellerId | FK → sellers | |
| prospectName/Email/Phone | String | |
| restaurantName | String | |
| city, country | String | |
| startUtc, endUtc | DateTime | Always UTC |
| timezone | String | Prospect's timezone |
| googleEventId | String? | |
| pipedriveId | String? | |
| status | Enum | CONFIRMED/CANCELLED/COMPLETED/NO_SHOW |
| routingStrategy | String | Strategy used at booking time |

**routingState** — Single row (id='global')
| Column | Type | Notes |
|--------|------|-------|
| id | String | Always 'global' |
| lastSellerId | String? | For round robin cursor |

**sellerMetrics** — Daily aggregates per seller+country
| Column | Type | Notes |
|--------|------|-------|
| sellerId + country + date | UNIQUE | Composite key |
| meetingCount | Int | Daily count |

**slotLocks** — Backup lock table (if Redis down)
| Column | Type | Notes |
|--------|------|-------|
| id | String PK | "{sellerId}:{slot ISO}" |
| expiresAt | DateTime | TTL enforced in app |

---

## 3. CODEBASE STRUCTURE

```
justo-booking/
├── src/
│   ├── server.js                  # Express app entry point
│   ├── db/
│   │   ├── client.js              # Prisma singleton
│   │   └── seed.js                # Seed sellers
│   ├── routes/
│   │   ├── availability.js        # GET /api/availability
│   │   ├── booking.js             # POST /api/booking
│   │   ├── auth.js                # Google OAuth flow
│   │   └── admin.js               # Admin API
│   ├── services/
│   │   ├── availabilityService.js # Slot computation
│   │   ├── routingService.js      # Seller assignment strategies
│   │   ├── lockService.js         # Redis distributed locks
│   │   ├── googleCalendarService.js  # Calendar API
│   │   ├── pipedriveService.js    # CRM integration
│   │   └── emailService.js        # SMTP emails
│   └── middleware/
│       └── errorHandler.js
├── prisma/
│   └── schema.prisma              # Full DB schema
├── public/
│   ├── index.html                 # Booking UI
│   ├── admin.html                 # Admin panel
│   ├── css/booking.css
│   └── js/booking.js
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── package.json
```

---

## 4. SETUP GUIDE

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Redis 7+ (optional but recommended)
- Google Cloud Console account
- Pipedrive account with API key

---

### 4.1 Google OAuth Setup

1. Go to https://console.cloud.google.com/
2. Create a new project (e.g., "Justo Booking")
3. Enable APIs:
   - Google Calendar API
   - Google+ API (for user info)
4. Go to **Credentials** → Create OAuth 2.0 Client ID
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback` (dev)
     - `https://yourdomain.com/api/auth/google/callback` (prod)
5. Copy **Client ID** and **Client Secret** → set in `.env`
6. Go to **OAuth consent screen**:
   - User type: Internal (for company use) or External
   - Add scopes: `calendar`, `calendar.events`

**Connect each seller's calendar:**
```
Visit: https://yourdomain.com/api/auth/google/{SELLER_ID}
```
Or use the Admin panel → "Conectar" button next to each seller.

---

### 4.2 Pipedrive API Setup

1. Log into Pipedrive
2. Go to **Settings** → **Personal Preferences** → **API**
3. Copy your API Token → set as `PIPEDRIVE_API_KEY`
4. Set `PIPEDRIVE_COMPANY_DOMAIN` to your subdomain
   - e.g., if your URL is `justo.pipedrive.com` → use `justo`

**Optional - Custom Fields:**
To attach structured data to deals, create custom fields in Pipedrive:
- Settings → Data Fields → Deals → Add Field
- Note the field key (e.g., `abc1234`) and use it in `pipedriveService.js`

---

### 4.3 Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
nano .env
```

Required variables:
```
DATABASE_URL          PostgreSQL connection string
REDIS_URL             Redis connection string
GOOGLE_CLIENT_ID      From Google Console
GOOGLE_CLIENT_SECRET  From Google Console
GOOGLE_REDIRECT_URI   Your callback URL
PIPEDRIVE_API_KEY     From Pipedrive settings
PIPEDRIVE_COMPANY_DOMAIN  Your Pipedrive subdomain
SMTP_HOST/PORT/USER/PASS  SMTP for emails
ADMIN_API_KEY         Random secret for /api/admin/* routes
BASE_URL              Your public URL
```

---

### 4.4 Local Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run migrations (creates tables)
npm run db:push

# Seed database with example sellers
npm run db:seed

# Start development server
npm run dev
```

Access:
- Booking page: http://localhost:3000
- Admin panel: http://localhost:3000/admin.html

---

## 5. DEPLOYMENT GUIDE

### Option A: Docker Compose (Recommended for VPS)

```bash
# Clone repo
git clone https://github.com/yourorg/justo-booking.git
cd justo-booking

# Configure environment
cp .env.example .env
# Edit .env with production values

# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f app
```

**Nginx reverse proxy config:**
```nginx
server {
    listen 80;
    server_name booking.justo.pe;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Add SSL with Certbot:
```bash
certbot --nginx -d booking.justo.pe
```

---

### Option B: Railway.app (Zero-config PaaS)

1. Push code to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add services: PostgreSQL, Redis
4. Set environment variables in Railway dashboard
5. Railway auto-deploys on push

---

### Option C: Render.com

1. Connect GitHub repo
2. Create Web Service (Node.js)
3. Create PostgreSQL database
4. Create Redis instance
5. Set env vars → Deploy

---

### Post-Deploy Checklist

- [ ] Database migrated: `npx prisma migrate deploy`
- [ ] Sellers seeded and calendars connected
- [ ] Google OAuth redirect URI updated to production URL
- [ ] Confirm test booking end-to-end
- [ ] Pipedrive deal created correctly
- [ ] Both emails received (prospect + seller)
- [ ] Admin panel accessible

---

## 6. FUTURE EXTENSION NOTES

### 6.1 AI-Powered Routing

Replace the `assignSeller()` strategy with an LLM or ML model:

```javascript
// src/services/routing/aiStrategy.js
async function aiRouting(sellers, context) {
  // Call OpenAI / Claude API with seller profiles + context
  // Return optimal seller based on:
  // - Historical conversion rate by seller+country
  // - Prospect's restaurant type vs seller experience
  // - Current seller workload
  // - Time zone overlap quality
}
```

Data already collected in `SellerMetric` table for training.

### 6.2 Performance-Based Assignment

```javascript
// Already scaffolded as lowestLoad() strategy
// Extend with:
// - Win rate per seller (add wonDeals field to Seller)
// - Average response time
// - Customer satisfaction scores
// Weights: totalScore = winRate * 0.5 + loadFactor * 0.3 + tzFit * 0.2
```

### 6.3 Country-Based Routing

Already scaffolded as `byCountry()` strategy. Extend with:
- Seller language capabilities
- Country-specific business hours
- Regional expertise scores
- Multiple sellers per country with load balancing

### 6.4 Per-Seller Booking Links

Add `slug` field to Seller table:
```
/book/maria-garcia → forces assignment to that seller
/book/team → global round-robin (current behavior)
/book/pe → country-based routing for Peru
```

Implement as middleware that pre-fills `sellerId` before routing.

### 6.5 Availability Caching

Add Redis cache for availability responses:
```javascript
// Cache availability for 5 minutes to reduce Google API calls
const cacheKey = `avail:${timezone}:${roundedToHour}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);
// ... fetch and cache for 300s
```

### 6.6 Webhooks & Real-Time Updates

- Listen to Google Calendar push notifications for instant availability updates
- Pipedrive webhooks to sync deal status back to meetings table
- WebSocket to update slot availability in real-time during booking

### 6.7 Analytics Dashboard

Use the `SellerMetric` table (already populated) to build:
- Conversion funnel (form views → slot selections → confirmed)
- Revenue attribution per seller
- Best performing time slots
- Country-level demand heat maps

---

## 7. CONCURRENCY & DOUBLE-BOOKING PREVENTION

The system uses **three layers** of protection:

1. **Redis Lock (primary)** — `SET NX EX 120` on `slot:{sellerId}:{startUtc}`
   - Atomic, distributed, 120-second TTL
   - Prevents simultaneous bookings of the same slot

2. **Database Conflict Check** — Before booking, queries `meetings` table
   - Checks for overlapping confirmed meetings
   - Source of truth even if Redis data is stale

3. **Google Calendar** — Final authoritative check via FreeBusy API
   - Catches conflicts from meetings created outside this system

This ensures correctness even with multiple app instances running.

---

## 8. SECURITY NOTES

- **Tokens**: Google OAuth tokens stored in DB — encrypt at rest using `pgcrypto` or application-level encryption for production
- **API Keys**: All secrets in environment variables, never in code
- **Admin Routes**: Protected by `x-admin-key` header — use a long random string
- **Rate Limiting**: 100 requests/15min per IP on all `/api/` routes
- **Input Validation**: All inputs validated with `express-validator`
- **Helmet**: HTTP security headers enabled
- **SQL Injection**: Prevented by Prisma's parameterized queries
- **Recommended**: Add IP allowlisting for `/api/admin/` in production
