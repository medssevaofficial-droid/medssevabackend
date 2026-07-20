import rateLimit from 'express-rate-limit';

// Global rate limiter for most requests
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes',
  },
});

// Stricter rate limiter for sensitive routes like auth, booking creation, etc.
export const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Limit each IP to 30 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many sensitive actions from this IP, please try again after an hour',
  },
});
