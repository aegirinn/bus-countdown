// Tiny, dependency-free readers for the two formats GTFS uses: a .zip of .csv files.
import zlib from 'node:zlib';

/** Extract every file in a zip buffer. Returns Map(name -> Buffer). Supports stored and deflated entries. */
export function unzip(buf) {
  // Find the End Of Central Directory record (scan backwards past an optional comment)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, zlib.inflateRawSync(data));
    else throw new Error(`Unsupported zip compression (method ${method}) for ${name}`);
  }
  return files;
}

/**
 * Streams CSV rows without building them all in memory: calls onRow(fields[], colIndex) per data row,
 * where colIndex maps header name -> position. Fast path for the (common) unquoted lines.
 */
export function eachCsvRow(text, onRow) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let pos = 0;
  let colIndex = null;
  const len = text.length;
  while (pos < len) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = len;
    let line = text.slice(pos, end);
    pos = end + 1;
    if (line.includes('"')) {
      // quoted field may span lines; fall back to the full parser for this record
      while ((line.split('"').length - 1) % 2 === 1 && pos < len) {
        let e2 = text.indexOf('\n', pos);
        if (e2 === -1) e2 = len;
        line += '\n' + text.slice(pos, e2);
        pos = e2 + 1;
      }
      const parsed = parseCsvRaw(line)[0] || [];
      emit(parsed);
    } else {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.trim() === '') continue;
      emit(line.split(','));
    }
  }
  function emit(fields) {
    if (!colIndex) {
      colIndex = Object.fromEntries(fields.map((h, i) => [h.trim(), i]));
      return;
    }
    onRow(fields, colIndex);
  }
}

/** RFC 4180 CSV -> array of objects keyed by the header row. Handles quotes, escaped quotes, CRLF and a BOM. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseCsvRaw(text);
  const header = (rows.shift() || []).map((h) => h.trim());
  const out = [];
  for (const r of rows) {
    if (r.length === 1 && r[0].trim() === '') continue;
    const o = {};
    for (let k = 0; k < header.length; k++) o[header[k]] = (r[k] ?? '').trim();
    out.push(o);
  }
  return out;
}

function parseCsvRaw(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  const len = text.length;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
