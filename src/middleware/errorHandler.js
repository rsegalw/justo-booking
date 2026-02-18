// src/middleware/errorHandler.js

function errorHandler(err, req, res, _next) {
  console.error('❌ Unhandled error:', err);

  // Prisma unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this value already exists.' });
  }

  // Prisma not found
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : err.message;

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
