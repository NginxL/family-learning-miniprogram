'use strict';

// Source strings and repeated record keys dominate the native package. Share only
// immutable strings/key layouts; decoded records remain independent plain objects.
function dataModule(value) {
  const data = JSON.parse(JSON.stringify(value));
  const counts = new Map();
  function visit(item) {
    if (typeof item === 'string') counts.set(item, (counts.get(item) || 0) + 1);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  }
  visit(data);
  const strings = [...counts].filter(([text, count]) => count > 1
    && (Buffer.byteLength(JSON.stringify(text)) - 8) * count > Buffer.byteLength(JSON.stringify(text)) + 1).map(([text]) => text);
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
  return `const s=${JSON.stringify(strings)};\nconst k=${JSON.stringify(layouts)};\n`
    + 'function o(i,v){const r={};k[i].forEach((key,n)=>{if(key==="__proto__")Object.defineProperty(r,key,{value:v[n],writable:true,enumerable:true,configurable:true});else r[key]=v[n];});return r;}\n'
    + `module.exports=${body};\n`;
}

module.exports = { dataModule };
