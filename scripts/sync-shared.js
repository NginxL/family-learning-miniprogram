'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { artifacts } = require('./typescript-build');
const root = path.resolve(__dirname, '..');
for (const [name, content] of artifacts()) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
// Native mini-programs register JS modules, not Node JSON modules.
for (const name of ['knowledge-data', 'resources']) fs.rmSync(path.join(root, `miniprogram/lib/learning/${name}.json`), { force: true });
console.log('TypeScript sources and knowledge compiled to the existing mini-program and cloud entry points.');
