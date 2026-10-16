'use strict';

// Repeated source/edition strings dominate the native package. Intern strings at
// build time; exported values remain ordinary JSON-compatible objects and arrays.
function dataModule(value) {
  const data = JSON.parse(JSON.stringify(value));
  const counts = new Map();
  function visit(item) {
    if (typeof item === 'string') counts.set(item, (counts.get(item) || 0) + 1);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  }
  visit(data);
  const strings = [...counts].filter(([text, count]) => text.length >= 32 && count > 1).map(([text]) => text);
  const index = new Map(strings.map((text, i) => [text, i]));
  function serialize(item) {
    if (typeof item === 'string' && index.has(item)) return `s[${index.get(item)}]`;
    if (Array.isArray(item)) return `[${item.map(serialize).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.entries(item).map(([key, entry]) => `${key === '__proto__' ? `[${JSON.stringify(key)}]` : JSON.stringify(key)}:${serialize(entry)}`).join(',')}}`;
    return JSON.stringify(item);
  }
  return `const s=${JSON.stringify(strings)};\nmodule.exports=${serialize(data)};\n`;
}

module.exports = { dataModule };
