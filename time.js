"use strict";

// Time helpers for consistent timestamps (e.g., Brazil/São Paulo) across VPS/local.
// Priority: TZ (Node standard) > TIMEZONE > BOT_TIMEZONE > default.

function getTimeZone() {
  return (
    process.env.TZ ||
    process.env.TIMEZONE ||
    process.env.BOT_TIMEZONE ||
    "America/Sao_Paulo"
  );
}

function nowParts(date = new Date()) {
  const tz = getTimeZone();
  // Use Intl timeZone to avoid relying on server OS timezone.
  const data = date.toLocaleDateString("pt-BR", { timeZone: tz });
  const hora = date.toLocaleTimeString("pt-BR", { timeZone: tz });
  return { data, hora, timeZone: tz };
}

module.exports = {
  getTimeZone,
  nowParts
};
