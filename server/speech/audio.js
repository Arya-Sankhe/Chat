import { HttpError } from "../http/responses.js";

function wavDuration(audio) {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return 0;
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > audio.length - start) return 0;
    if (id === "fmt " && size >= 16) byteRate = audio.readUInt32LE(start + 8);
    if (id === "data") dataBytes += size;
    offset = start + size + (size % 2);
  }
  return byteRate > 0 ? dataBytes / byteRate : 0;
}

function readEbmlSize(audio, offset) {
  const first = audio[offset];
  if (!first) return null;
  let width = 1;
  let mask = 0x80;
  while (width <= 8 && !(first & mask)) { width += 1; mask >>= 1; }
  if (width > 8 || offset + width > audio.length) return null;
  let value = first & (mask - 1);
  for (let index = 1; index < width; index += 1) value = value * 256 + audio[offset + index];
  return { width, value };
}

function findBytes(audio, needle) {
  outer: for (let offset = 0; offset <= audio.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) if (audio[offset + index] !== needle[index]) continue outer;
    return offset;
  }
  return -1;
}

function webmDuration(audio) {
  const scaleOffset = findBytes(audio, [0x2a, 0xd7, 0xb1]);
  const durationOffset = findBytes(audio, [0x44, 0x89]);
  let scale = 1_000_000;
  if (scaleOffset >= 0) {
    const size = readEbmlSize(audio, scaleOffset + 3);
    if (size && size.value > 0 && size.value <= 8) {
      scale = 0;
      const start = scaleOffset + 3 + size.width;
      for (let index = 0; index < size.value; index += 1) scale = scale * 256 + audio[start + index];
    }
  }
  if (durationOffset < 0) return 0;
  const size = readEbmlSize(audio, durationOffset + 2);
  if (!size || ![4, 8].includes(size.value)) return 0;
  const start = durationOffset + 2 + size.width;
  if (start + size.value > audio.length) return 0;
  const ticks = size.value === 4 ? audio.readFloatBE(start) : audio.readDoubleBE(start);
  return Number.isFinite(ticks) ? ticks * scale / 1_000_000_000 : 0;
}

function mp4Duration(audio) {
  const offset = audio.indexOf(Buffer.from("mvhd"));
  if (offset < 0 || offset + 32 > audio.length) return 0;
  const version = audio[offset + 4];
  const timescaleOffset = offset + (version === 1 ? 24 : 16);
  const durationOffset = timescaleOffset + 4;
  if (durationOffset + (version === 1 ? 8 : 4) > audio.length) return 0;
  const timescale = audio.readUInt32BE(timescaleOffset);
  const duration = version === 1 ? Number(audio.readBigUInt64BE(durationOffset)) : audio.readUInt32BE(durationOffset);
  return timescale > 0 ? duration / timescale : 0;
}

export function validatedAudioDuration(audio, contentType, { wavOnly = false, maxSeconds = 30 } = {}) {
  const type = String(contentType || "").toLowerCase();
  let seconds = type.includes("wav") ? wavDuration(audio) : 0;
  if (!seconds && !wavOnly && type.includes("webm")) seconds = webmDuration(audio);
  if (!seconds && !wavOnly && (type.includes("mp4") || type.includes("m4a"))) seconds = mp4Duration(audio);
  if (!(seconds > 0)) throw new HttpError(400, wavOnly ? "A valid WAV recording is required." : "The audio duration could not be validated.");
  if (seconds > maxSeconds + 0.05) throw new HttpError(413, `Voice recordings are limited to ${maxSeconds} seconds.`);
  return seconds;
}
