-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "timezone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "calendarId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "lastAssigned" TIMESTAMP(3),
    "totalMeetings" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "prospectName" TEXT NOT NULL,
    "prospectEmail" TEXT NOT NULL,
    "prospectPhone" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "startUtc" TIMESTAMP(3) NOT NULL,
    "endUtc" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "googleEventId" TEXT,
    "calendarLink" TEXT,
    "pipedriveId" TEXT,
    "pipedriveDealUrl" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "routingStrategy" TEXT NOT NULL DEFAULT 'round_robin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingState" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "lastSellerId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerMetric" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "meetingCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SellerMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotLock" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_email_key" ON "Seller"("email");
CREATE INDEX "Seller_isActive_country_idx" ON "Seller"("isActive", "country");
CREATE INDEX "Meeting_sellerId_startUtc_idx" ON "Meeting"("sellerId", "startUtc");
CREATE INDEX "Meeting_startUtc_status_idx" ON "Meeting"("startUtc", "status");
CREATE UNIQUE INDEX "SellerMetric_sellerId_country_date_key" ON "SellerMetric"("sellerId", "country", "date");
CREATE INDEX "SellerMetric_sellerId_date_idx" ON "SellerMetric"("sellerId", "date");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerMetric" ADD CONSTRAINT "SellerMetric_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
