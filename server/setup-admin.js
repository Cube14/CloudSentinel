'use strict';

const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const { databasePath, openStore } = require('./auth/store');
const { normalizeEmail, acceptablePassword, hashPassword } = require('./auth/password');
const { recordAccount } = require('./auth');

async function readPassword() {
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 130) throw new Error('Password is too long.');
    }
    return input.replace(/\r?\n$/, '');
  }
  const silent = new Writable({ write(chunk, encoding, next) { next(); } });
  const readline = createInterface({ input: process.stdin, output: silent, terminal: true });
  try {
    process.stdout.write('New admin password (hidden): ');
    const password = await readline.question('');
    process.stdout.write('\nConfirm password (hidden): ');
    if (password !== await readline.question('')) throw new Error('Passwords do not match.');
    return password;
  } finally {
    readline.close();
    process.stdout.write('\n');
  }
}

async function main() {
  const email = normalizeEmail(process.argv[2]);
  if (!email || process.argv.length !== 3) throw new Error('Usage: npm run setup:admin -- admin@example.com');
  const password = await readPassword();
  if (!acceptablePassword(password)) throw new Error('Use a password with at least 15 and at most 128 characters.');
  const hash = await hashPassword(password);
  const store = openStore(databasePath(process.env));
  try {
    store.transaction(() => {
      if (store.byEmail(email)) throw new Error('That address is already registered. Use a new address for this admin account.');
      recordAccount(store, 'admin-provisioned', store.createUser(email, 'admin', hash));
    });
    console.log('Administrator created for ' + email + '.');
  } finally { store.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
