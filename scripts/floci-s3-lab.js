'use strict';

const { createInterface } = require('node:readline/promises');
const { databasePath, openStore } = require('../server/auth/store');
const { openLab } = require('../server/floci-lab');

async function main() {
  const [command, name, ...extra] = process.argv.slice(2);
  if (extra.length || (command === 'list' ? name : !name || !['inspect', 'public', 'secure'].includes(command))) {
    throw new Error('Usage: npm run lab:s3 -- list | inspect BUCKET | public BUCKET | secure BUCKET');
  }
  if (process.env.FLOCI_LAB_ENABLED !== '1') throw new Error('Enable the disposable Floci S3 Lab first.');
  const store = openStore(databasePath(process.env));
  try {
    const lab = openLab(store, process.env.FLOCI_ENDPOINT);
    try {
      if (command === 'list') return console.log(JSON.stringify(await lab.list(), null, 2));
      const current = await lab.inspect(name);
      if (command === 'inspect') return console.log(JSON.stringify(current, null, 2));
      if (!current.managed) throw new Error('This bucket is outside the approved disposable lab resources.');
      if (!process.stdin.isTTY) throw new Error('Run from an interactive terminal to confirm the exact bucket name.');
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      let confirm;
      try { confirm = await readline.question('Type ' + name + ' to apply the ' + command + ' template: '); }
      finally { readline.close(); }
      const result = await lab.mutate({ bucket: name, confirm, template: command }, { channel: 'terminal' });
      console.log(JSON.stringify(result, null, 2));
    } finally { lab.close(); }
  } finally { store.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
