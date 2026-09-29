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

    req.userMeta = {
      username: safeDecode(req.headers['x-telegram-username']) || req.query.username || req.body?.username || null,
      firstName: safeDecode(req.headers['x-telegram-first-name']) || req.query.firstName || req.body?.firstName || null,
      lastName: safeDecode(req.headers['x-telegram-last-name']) || req.query.lastName || req.body?.lastName || null,
      referrerId: req.headers['x-telegram-referrer-id'] || req.query.referrerId || req.body?.referrerId || null,
      avatar: safeDecode(req.headers['x-telegram-avatar']) || req.query.avatar || req.body?.avatar || null
    };

    // Check if user is banned in Neon PostgreSQL
    if (req.path !== '/health') {
      const isBanned = await dbService.isUserBanned(req.userId);
      if (isBanned) {
        return res.status(403).json({
          success: false,
          banned: true,
          error: "ACCOUNT_BANNED",
          message: "🚫 Your account has been suspended by the administrator. You cannot perform any actions."
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
