'use strict';
/**
 * Rate limiters. Login endpoints get a strict limiter (brute-force guard);
 * the whole API gets a permissive general limiter.
 */
const rateLimit = require('express-rate-limit');
const config = require('../config/loader');

const loginLimiter = rateLimit({
  windowMs: (config.security && config.security.rateLimit && config.security.rateLimit.loginWindowMs) || 15 * 60 * 1000,
  limit: (config.security && config.security.rateLimit && config.security.rateLimit.loginMax) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: (config.security && config.security.rateLimit && config.security.rateLimit.generalWindowMs) || 60 * 1000,
  limit: (config.security && config.security.rateLimit && config.security.rateLimit.generalMax) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});

module.exports = { loginLimiter, apiLimiter };
