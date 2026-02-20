// src/services/emailService.js
const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send booking confirmation to prospect and seller.
 */
async function sendConfirmation(meeting, seller) {
  const localTime = dayjs(meeting.startUtc)
    .tz(meeting.timezone)
    .format('dddd, MMMM D YYYY [at] h:mm A z');

  const sellerLocalTime = dayjs(meeting.startUtc)
    .tz(seller.timezone)
    .format('dddd, MMMM D YYYY [at] h:mm A z');

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
      <img src="${process.env.BASE_URL}/logo.png" alt="Justo" style="height:40px;margin-bottom:24px" />
      <h2 style="color:#1a1a2e">¡Tu demo está confirmada! 🎉</h2>
      <p>Hola <strong>${meeting.prospectName}</strong>,</p>
      <p>Tu demo con el equipo de <strong>Justo</strong> ha sido programada exitosamente.</p>

      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
        <p><strong>📅 Fecha y Hora:</strong> ${localTime}</p>
        <p><strong>🏪 Restaurante:</strong> ${meeting.restaurantName}</p>
        <p><strong>👤 Vendedor:</strong> ${seller.name}</p>
        ${meeting.calendarLink ? `<p><strong>🔗 <a href="${meeting.calendarLink}">Ver en Google Calendar</a></strong></p>` : ''}
      </div>

      <p>Si necesitas cancelar o reagendar, responde a este email.</p>
      <p>¡Nos vemos pronto!</p>
      <p>— El equipo de Justo</p>
    </div>
  `;

  const sellerHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2>Nueva Demo Asignada 🚀</h2>
      <p>Hola <strong>${seller.name}</strong>, tienes una nueva demo asignada.</p>
      <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
        <p><strong>Fecha (tu zona horaria):</strong> ${sellerLocalTime}</p>
        <p><strong>Prospecto:</strong> ${meeting.prospectName}</p>
        <p><strong>Email:</strong> ${meeting.prospectEmail}</p>
        <p><strong>Teléfono:</strong> ${meeting.prospectPhone}</p>
        <p><strong>Restaurante:</strong> ${meeting.restaurantName}</p>
        <p><strong>Ciudad:</strong> ${meeting.city}, ${meeting.country}</p>
        ${meeting.pipedriveDealUrl ? `<p><strong>Deal Pipedrive:</strong> <a href="${meeting.pipedriveDealUrl}">${meeting.pipedriveDealUrl}</a></p>` : ''}
      </div>
    </div>
  `;

  const results = await Promise.allSettled([
    transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: meeting.prospectEmail,
      subject: `Confirmación: Tu demo con Justo — ${localTime}`,
      html,
    }),
    transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: seller.email,
      subject: `Nueva Demo: ${meeting.restaurantName} — ${sellerLocalTime}`,
      html: sellerHtml,
    }),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Email ${i === 0 ? 'prospect' : 'seller'} failed:`, r.reason?.message);
    }
  });
}

/**
 * Send calendar sync invitation email to a seller.
 */
async function sendCalendarSyncEmail(seller, authUrl) {
  await transporter.sendMail({
    from: `"Justo Booking" <${process.env.SMTP_USER}>`,
    to: seller.email,
    subject: '📅 Conecta tu Google Calendar con Justo Booking',
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
        <h2 style="margin: 0 0 8px">Hola ${seller.name} 👋</h2>
        <p style="color: #555; margin: 0 0 24px">Para que el sistema de agendado funcione correctamente, necesitás conectar tu Google Calendar. Solo tarda 30 segundos.</p>
        
        <a href="${authUrl}" style="display:inline-block; background:#2563eb; color:#fff; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:600; font-size:16px;">
          📅 Conectar Google Calendar
        </a>

        <p style="margin: 24px 0 0; color: #888; font-size: 13px;">
          Si el botón no funciona, copia este link en tu navegador:<br>
          <a href="${authUrl}" style="color:#2563eb; word-break:break-all;">${authUrl}</a>
        </p>
        <hr style="border:none; border-top:1px solid #eee; margin:32px 0">
        <p style="color:#aaa; font-size:12px; margin:0">Justo Booking · Este email fue generado automáticamente</p>
      </div>
    `,
  });
}

module.exports = { sendConfirmation, sendCalendarSyncEmail };
