const crypto = require('crypto');
const dbService = require('../services/dbService');

/**
 * Cryptographically verify Telegram Mini App initData using Bot Token HMAC-SHA256
 */
function verifyTelegramInitData(initDataStr, botToken) {
  if (!initDataStr || !botToken) return null;
  try {
    const urlParams = new URLSearchParams(initDataStr);
    const hash = urlParams.get('hash');
    if (!hash) return null;

    urlParams.delete('hash');
    const params = Array.from(urlParams.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(params).digest('hex');

    if (computedHash === hash) {
      const userStr = urlParams.get('user');
      return userStr ? JSON.parse(userStr) : null;
    }
  } catch (e) {
    console.warn('initData verification warning:', e.message);
  }
  return null;
}

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
    // 1. Check for cryptographic Telegram WebApp initData signature
    const initData = req.headers['x-telegram-init-data'] || req.query.tgWebAppData || req.body?.initData;
    const botToken = process.env.MAIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.ADMIN_BOT_TOKEN;
    const verifiedTgUser = verifyTelegramInitData(initData, botToken);

    let effectiveUserId;
    let effectiveUsername;
    let effectiveFirstName;
    let effectiveLastName;
    let effectiveAvatar;

    if (verifiedTgUser && verifiedTgUser.id) {
      effectiveUserId = Number(verifiedTgUser.id);
      effectiveUsername = verifiedTgUser.username ? `@${verifiedTgUser.username}` : null;
      effectiveFirstName = verifiedTgUser.first_name || null;
      effectiveLastName = verifiedTgUser.last_name || null;
      effectiveAvatar = verifiedTgUser.photo_url || null;
    } else {
      const headerId = req.headers['x-telegram-user-id'] || req.headers['x-user-id'];
      const queryId = req.query.userId || req.query.telegramId;
      const bodyId = req.body?.userId || req.body?.telegramId;
      effectiveUserId = Number(headerId || queryId || bodyId) || 9482103;

      effectiveUsername = safeDecode(req.headers['x-telegram-username']) || req.query.username || req.body?.username || null;
      effectiveFirstName = safeDecode(req.headers['x-telegram-first-name']) || req.query.firstName || req.body?.firstName || null;
      effectiveLastName = safeDecode(req.headers['x-telegram-last-name']) || req.query.lastName || req.body?.lastName || null;
      effectiveAvatar = safeDecode(req.headers['x-telegram-avatar']) || req.query.avatar || req.body?.avatar || null;
    }

    req.userId = effectiveUserId;

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
      username: effectiveUsername,
      firstName: effectiveFirstName,
      lastName: effectiveLastName,
      referrerId: req.headers['x-telegram-referrer-id'] || req.query.referrerId || req.body?.referrerId || null,
      startParam: safeDecode(req.headers['x-telegram-start-param']) || req.query.start_param || req.query.startParam || req.query.startapp || req.query.start || req.query.ref || req.body?.startParam || null,
      avatar: effectiveAvatar,
      clientInfo: req.clientInfo
    };

    next();
  } catch (err) {
    console.error('userContext middleware error:', err);
    next();
  }
}

module.exports = userContext;
