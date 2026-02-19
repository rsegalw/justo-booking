#!/bin/sh
echo "Running Prisma migrations..."
npx prisma migrate deploy
echo "Starting server..."
node src/server.js
