/**
 * High-performance In-Memory Rate Limiter Middleware
 * Protects APIs from brute-force, DDoS, and spam requests
 */
const rateLimitMap = new Map();

// Periodic cleanup of stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

function rateLimiter({ windowMs = 60 * 1000, max = 120, message = "Too many requests, please slow down." } = {}) {
  return (req, res, next) => {
    try {
      const clientIp = req.clientInfo?.ip || req.ip || req.socket?.remoteAddress || 'unknown';
      const key = `${clientIp}:${req.userId || 'guest'}`;
      const now = Date.now();

      let record = rateLimitMap.get(key);
      if (!record || now > record.resetTime) {
        record = {
          count: 1,
          resetTime: now + windowMs
        };
        rateLimitMap.set(key, record);
      } else {
        record.count++;
      }

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

      if (record.count > max) {
        return res.status(429).json({
          success: false,
          error: "RATE_LIMIT_EXCEEDED",
          message,
          retryAfterSeconds: Math.ceil((record.resetTime - now) / 1000)
        });
      }

      next();
    } catch (err) {
      next();
    }
  };
}

module.exports = rateLimiter;
