import { inflateSync, strFromU8 } from 'fflate';

// Pure synchronous JS for the mini-program runtime: no network, Buffer, atob,
// TextDecoder, Worker or execution of code stored in the data payload.
export function decodeData(base64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const end = base64.indexOf('=');
  const length = end < 0 ? base64.length : end;
  const bytes = new Uint8Array(Math.floor(length * 6 / 8));
  let bits = 0, count = 0, index = 0;
  for (let i = 0; i < length; i += 1) {
    const value = alphabet.indexOf(base64[i]);
    if (value < 0) throw Error('Invalid built-in data encoding');
    bits = (bits << 6) | value;
    count += 6;
    if (count >= 8) { count -= 8; bytes[index++] = (bits >>> count) & 255; }
  }
  return JSON.parse(strFromU8(inflateSync(bytes)));
}
