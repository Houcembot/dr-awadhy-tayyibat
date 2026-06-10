const BOT_RE = /(googlebot|bingbot|ahrefsbot|semrushbot|mj12bot|duckduckbot|yandexbot|dotbot|petalbot|bytespider|gptbot|claudebot)/i;

export function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_RE.test(userAgent);
}
