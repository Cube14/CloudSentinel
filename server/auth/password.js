'use strict';

const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummyHash = Buffer.alloc(16).toString('hex') + ':' + Buffer.alloc(64).toString('hex');

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) &&
    email.indexOf('@') <= 64 && !email.startsWith('.') && !email.includes('..') && !email.includes('.@') ? email : null;
}

function acceptablePassword(value) {
  return typeof value === 'string' && [...value].length >= 15 && value.length <= 128;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64, options);
  return salt.toString('hex') + ':' + key.toString('hex');
}

async function verifyPassword(password, hash) {
  const [salt, expected] = (hash || dummyHash).split(':').map(part => Buffer.from(part, 'hex'));
  const key = await derive(password, salt, expected.length, options);
  return timingSafeEqual(key, expected) && Boolean(hash);
}

module.exports = { normalizeEmail, acceptablePassword, hashPassword, verifyPassword };
