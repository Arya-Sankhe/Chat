// Drop camera GPS/EXIF/XMP. Pixel data stays; orientation in APP1 is discarded.

function asBuffer(bytes) {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function stripJpegMetadata(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const chunks = [bytes.subarray(0, 2)];
  let offset = 2;
  let changed = false;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      chunks.push(bytes.subarray(offset));
      break;
    }
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.subarray(offset));
      break;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) {
      chunks.push(bytes.subarray(offset));
      break;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const next = offset + 2 + length;
    if (length < 2 || next > bytes.length) {
      chunks.push(bytes.subarray(offset));
      break;
    }
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (drop) changed = true;
    else chunks.push(bytes.subarray(offset, next));
    offset = next;
  }
  if (!changed) return bytes;
  const cleaned = Buffer.concat(chunks);
  return cleaned.length >= 4 ? cleaned : bytes;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPngMetadata(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIG)) return bytes;
  const chunks = [bytes.subarray(0, 8)];
  let offset = 8;
  let changed = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (length > 0x7fffffff || next > bytes.length) {
      chunks.push(bytes.subarray(offset));
      break;
    }
    if (PNG_DROP.has(type)) changed = true;
    else chunks.push(bytes.subarray(offset, next));
    offset = next;
    if (type === "IEND") break;
  }
  return changed ? Buffer.concat(chunks) : bytes;
}

function stripWebpMetadata(bytes) {
  if (
    bytes.length < 12
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return bytes;
  }
  const parts = [];
  let offset = 12;
  let changed = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const pad = size % 2;
    const next = offset + 8 + size + pad;
    if (offset + 8 + size > bytes.length) {
      parts.push(bytes.subarray(offset));
      break;
    }
    if (type === "EXIF" || type === "XMP ") {
      changed = true;
    } else if (type === "VP8X" && size >= 1) {
      const copy = Buffer.from(bytes.subarray(offset, next));
      copy[8] &= ~0x0c;
      if (copy[8] !== bytes[offset + 8]) changed = true;
      parts.push(copy);
    } else {
      parts.push(bytes.subarray(offset, next));
    }
    offset = next;
  }
  if (!changed) return bytes;
  const payload = Buffer.concat(parts);
  const out = Buffer.alloc(12 + payload.length);
  out.write("RIFF", 0);
  out.writeUInt32LE(4 + payload.length, 4);
  out.write("WEBP", 8);
  payload.copy(out, 12);
  return out;
}

export function stripImageMetadata(bytes) {
  const buf = asBuffer(bytes);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return stripJpegMetadata(buf);
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    return stripPngMetadata(buf);
  }
  if (
    buf.length >= 12
    && buf.toString("ascii", 0, 4) === "RIFF"
    && buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return stripWebpMetadata(buf);
  }
  return buf;
}
