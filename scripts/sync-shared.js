'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { knowledge, resources } = require('./knowledge');
for (const [name, value] of [['knowledge-data.json', knowledge()], ['resources.json', resources]]) {
  const source = JSON.stringify(value) + '\n';
  for (const folder of ['shared', 'miniprogram/lib/learning', 'cloudfunctions/familyApi/learning']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, name), source);
  }
}
for (const name of ['catalog.js', 'learning.js']) {
  const source = '// Generated from shared/' + name + '. Run npm run build after editing the source.\n' + fs.readFileSync(path.join(root, 'shared', name), 'utf8');
  for (const folder of ['miniprogram/lib/learning', 'cloudfunctions/familyApi/learning']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, name), source);
  }
}
console.log('Knowledge, source records and learning rules copied to both deployable packages.');
