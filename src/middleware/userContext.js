const dbService = require('../services/dbService');

/**
 * Middleware to extract Telegram User ID & metadata from headers/query/body
 * and enforce Ban checks from Neon PostgreSQL database
 */
function safeDecode(val) {
  if (!val) return null;
  try {
    return decodeURIComponent(String(val));
  } catch (e) {
    return String(val);
  }
}

async function userContext(req, res, next) {
  try {
    const headerId = req.headers['x-telegram-user-id'] || req.headers['x-user-id'];
    const queryId = req.query.userId || req.query.telegramId;
    const bodyId = req.body?.userId || req.body?.telegramId;

    req.userId = Number(headerId || queryId || bodyId) || 9482103;

    // Client IP & Device Fingerprinting extraction for anti-multi account security
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = (
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      (forwarded ? forwarded.split(',')[0].trim() : null) ||
      req.socket?.remoteAddress ||
      ''
    ).replace(/^::ffff:/, '').trim();

    const deviceFingerprint = req.headers['x-device-fingerprint'] || req.query.deviceFingerprint || req.body?.deviceFingerprint || null;
    const userAgent = req.headers['user-agent'] || '';

    req.clientInfo = {
      ip: clientIp,
      fingerprint: deviceFingerprint,
      userAgent: userAgent
    };

    req.userMeta = {
      username: safeDecode(req.headers['x-telegram-username']) || req.query.username || req.body?.username || null,
      firstName: safeDecode(req.headers['x-telegram-first-name']) || req.query.firstName || req.body?.firstName || null,
      lastName: safeDecode(req.headers['x-telegram-last-name']) || req.query.lastName || req.body?.lastName || null,
      referrerId: req.headers['x-telegram-referrer-id'] || req.query.referrerId || req.body?.referrerId || null,
      startParam: safeDecode(req.headers['x-telegram-start-param']) || req.query.start_param || req.query.startParam || req.query.startapp || req.query.start || req.query.ref || req.body?.startParam || null,
      avatar: safeDecode(req.headers['x-telegram-avatar']) || req.query.avatar || req.body?.avatar || null,
      clientInfo: req.clientInfo
    };

    // Check if user is banned in Neon PostgreSQL
    if (req.path !== '/health') {
      const isBanned = await dbService.isUserBanned(req.userId);
      if (isBanned) {
        return res.status(403).json({
          success: false,
          banned: true,
          error: "ACCOUNT_BANNED",
          message: "🚫 MULTIPLE ID / ACCOUNT BANNED! Multiple accounts from the same device / IP are prohibited. Contact Support: @CryptoMint_Support_bot",
          supportBot: "@CryptoMint_Support_bot",
          supportUrl: "https://t.me/CryptoMint_Support_bot"
        });
      }
    }

    next();
  } catch (err) {
    console.error('userContext middleware error:', err);
    next();
  }
}

module.exports = userContext;
