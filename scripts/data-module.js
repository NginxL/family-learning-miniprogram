'use strict';
const { deflateRawSync } = require('node:zlib');
const { buildSync } = require('esbuild');
const path = require('node:path');
let decoder;

function compressedModule(data) {
  if (!decoder) decoder = buildSync({
    entryPoints: [path.join(__dirname, 'native-data-decoder.js')], bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'nativeData', target: 'es2018',
    minify: true, legalComments: 'inline'
  }).outputFiles[0].text;
  const payload = deflateRawSync(Buffer.from(JSON.stringify(data)), { level: 9 }).toString('base64');
  return '// fflate (MIT); see miniprogram/THIRD_PARTY_NOTICES.txt.\n' + decoder
    + `module.exports=nativeData.decodeData(${JSON.stringify(payload)});\n`;
}


// Source strings and repeated record keys dominate the native package. Share only
// immutable strings/key layouts; decoded records remain independent plain objects.
function encode(data, counts, usePrefixes) {
  const shared = (text, count) => count > 1
    && (Buffer.byteLength(JSON.stringify(text)) - 8) * count > Buffer.byteLength(JSON.stringify(text)) + 1;
  const strings = [...counts].filter(([text, count]) => shared(text, count)
    || (usePrefixes && text.length >= 20)).map(([text]) => text);
  if (usePrefixes) strings.sort();
  const packed = usePrefixes ? strings.map((text, i) => {
    const previous = strings[i - 1] || '';
    let prefix = 0;
    // Offsets use UTF-16 on both sides; even a split surrogate pair round-trips.
    while (prefix < text.length && prefix < previous.length && text[prefix] === previous[prefix]) prefix++;
    const delta = [prefix, text.slice(prefix)];
    return Buffer.byteLength(JSON.stringify(delta)) < Buffer.byteLength(JSON.stringify(text)) ? delta : text;
  }) : strings;
  const index = new Map(strings.map((text, i) => [text, i]));
  const layouts = [];
  const layoutIndexes = new Map();
  function serialize(item) {
    if (typeof item === 'string' && index.has(item)) return `s[${index.get(item)}]`;
    if (Array.isArray(item)) return `[${item.map(serialize).join(',')}]`;
    if (item && typeof item === 'object') {
      const keys = Object.keys(item), signature = JSON.stringify(keys);
      if (!layoutIndexes.has(signature)) { layoutIndexes.set(signature, layouts.length); layouts.push(keys); }
      return `o(${layoutIndexes.get(signature)},[${Object.values(item).map(serialize).join(',')}])`;
    }
    return JSON.stringify(item);
  }
  const body = serialize(data);
  return `const s=${JSON.stringify(packed)};\nconst k=${JSON.stringify(layouts)};\n`
    + (usePrefixes ? 's.forEach((v,i)=>{if(Array.isArray(v))s[i]=s[i-1].slice(0,v[0])+v[1];});\n' : '')
    + 'function o(i,v){const r={};k[i].forEach((key,n)=>{if(key==="__proto__")Object.defineProperty(r,key,{value:v[n],writable:true,enumerable:true,configurable:true});else r[key]=v[n];});return r;}\n'
    + `module.exports=${body};\n`;
}

function dataModule(value) {
  const data = JSON.parse(JSON.stringify(value));
  const counts = new Map();
  function visit(item) {
    if (typeof item === 'string') counts.set(item, (counts.get(item) || 0) + 1);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  }
  visit(data);
  const repeated = encode(data, counts, false);
  const prefixed = encode(data, counts, true);
  // Short or unrelated strings (for example pinyin) can be smaller without a
  // prefix table. Decide at build time; clients only execute the selected form.
  const compact = Buffer.byteLength(prefixed) < Buffer.byteLength(repeated) ? prefixed : repeated;
  if (Buffer.byteLength(compact) < 64 * 1024) return compact;
  const compressed = compressedModule(data);
  return Buffer.byteLength(compressed) < Buffer.byteLength(compact) ? compressed : compact;
}

module.exports = { dataModule };
