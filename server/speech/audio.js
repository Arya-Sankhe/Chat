import { HttpError } from "../http/responses.js";

export const MAX_AUDIO_SECONDS = 10 * 60;

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

// Element IDs keep their length-marker bits, unlike sizes.
function readEbmlId(audio, offset) {
  const first = audio[offset];
  if (!first) return null;
  const width = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
  if (!width || offset + width > audio.length) return null;
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + audio[offset + index];
  return { width, value };
}

const EBML_SEGMENT_INFO = [0x15, 0x49, 0xa9, 0x66];
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;

// Duration comes only from the Segment Info header's own children. Live MediaRecorder WebM has
// none, and scanning the whole file for its ID found stray bytes in the audio instead, reading
// garbage like "over five minutes" for a few seconds of speech.
function webmDuration(audio) {
  const info = findBytes(audio.subarray(0, 4096), EBML_SEGMENT_INFO);
  if (info < 0) return 0;
  const infoSize = readEbmlSize(audio, info + 4);
  if (!infoSize) return 0;
  const unknown = infoSize.value === 2 ** (7 * infoSize.width) - 1;
  let offset = info + 4 + infoSize.width;
  const end = unknown ? audio.length : Math.min(audio.length, offset + infoSize.value);
  let scale = 1_000_000;
  let ticks = 0;
  while (offset < end) {
    const id = readEbmlId(audio, offset);
    const size = id && readEbmlSize(audio, offset + id.width);
    if (!size) break;
    const start = offset + id.width + size.width;
    if (start + size.value > end) break;
    if (id.value === EBML_TIMECODE_SCALE && size.value > 0 && size.value <= 8) {
      scale = 0;
      for (let index = 0; index < size.value; index += 1) scale = scale * 256 + audio[start + index];
    } else if (id.value === EBML_DURATION && (size.value === 4 || size.value === 8)) {
      ticks = size.value === 4 ? audio.readFloatBE(start) : audio.readDoubleBE(start);
    } else if (unknown && ![0x73a4, 0x7384, 0x2ad7b1, 0x4489, 0x4461, 0x7ba9, 0x4d80, 0x5741].includes(id.value)) {
      // An Info of unknown size ends at the first element that isn't one of its children.
      break;
    }
    offset = start + size.value;
  }
  return Number.isFinite(ticks) && ticks > 0 ? ticks * scale / 1_000_000_000 : 0;
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

export function validatedAudioDuration(audio, contentType, { wavOnly = false, maxSeconds = MAX_AUDIO_SECONDS } = {}) {
  const type = String(contentType || "").toLowerCase();
  let seconds = type.includes("wav") ? wavDuration(audio) : 0;
  if (!seconds && !wavOnly && type.includes("webm")) seconds = webmDuration(audio);
  if (!seconds && !wavOnly && (type.includes("mp4") || type.includes("m4a"))) seconds = mp4Duration(audio);
  if (!(seconds > 0)) throw new HttpError(400, wavOnly ? "A valid WAV recording is required." : "The audio duration could not be validated.");
  if (seconds > maxSeconds + 0.05) throw new HttpError(413, `Voice recordings are limited to ${maxSeconds / 60} minutes.`);
  return seconds;
}
