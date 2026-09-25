// Minimal MPEG audio frame tools for joining TTS clips into one podcast file.
// Kokoro returns VBR clips whose streamed Xing header has a wrong frame count, so we keep only
// real audio frames, measure durations from frame counts, and write one correct Xing header
// (with a seek table) for the joined file so players show the right length and seek accurately.

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function parseHeader(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  if (buffer[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  if (version === 1 || ((b1 >> 1) & 3) !== 1) return null; // Layer III only
  const mpeg1 = version === 3;
  const bitrate = BITRATES[mpeg1 ? 1 : 2][(b2 >> 4) & 15];
  const sampleRate = SAMPLE_RATES[version]?.[(b2 >> 2) & 3];
  if (!bitrate || !sampleRate) return null;
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrate * 1000) / sampleRate) + ((b2 >> 1) & 1);
  const mono = (buffer[offset + 3] >> 6) === 3;
  const sideInfo = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  return { length, sampleRate, samples: mpeg1 ? 1152 : 576, sideInfo, mpeg1 };
}

function isInfoFrame(frame) {
  const head = frame.subarray(4, 48).toString("latin1");
  return head.includes("Xing") || head.includes("Info") || head.includes("VBRI");
}

function id3Size(buffer) {
  if (buffer.length < 10 || buffer.toString("latin1", 0, 3) !== "ID3") return 0;
  return 10 + ((buffer[6] & 0x7f) << 21 | (buffer[7] & 0x7f) << 14 | (buffer[8] & 0x7f) << 7 | (buffer[9] & 0x7f));
}

// Returns the clip's audio frames (every header/tag frame removed) and its exact duration.
export function readMp3(input) {
  const buffer = Buffer.from(input);
  const frames = [];
  let format = null;
  let offset = id3Size(buffer);
  while (offset < buffer.length) {
    const head = parseHeader(buffer, offset);
    const end = head ? offset + head.length : 0;
    // Accept a frame when the next one lines up, or it ends the stream exactly.
    if (head && end <= buffer.length && (end === buffer.length || parseHeader(buffer, end))) {
      const frame = buffer.subarray(offset, end);
      // DeepInfra encodes each sentence separately, so header frames can appear mid-clip too.
      if (!isInfoFrame(frame)) {
        format ||= head;
        if (head.sampleRate === format.sampleRate && head.samples === format.samples) frames.push(frame);
      }
      offset = end;
    } else {
      offset += 1;
    }
  }
  if (!frames.length) throw new Error("No MPEG audio frames found.");
  return { frames, format, seconds: (frames.length * format.samples) / format.sampleRate };
}

// A frame with zeroed side info decodes as silence; reuse a real header so the format matches.
export function silence(clip, seconds) {
  const header = Buffer.from(clip.frames[0].subarray(0, 4));
  header[2] &= ~0x02; // no padding bit
  const { length } = parseHeader(Buffer.concat([header, Buffer.alloc(4)]), 0);
  const frame = Buffer.alloc(length);
  header.copy(frame, 0);
  const count = Math.max(0, Math.round((seconds * clip.format.sampleRate) / clip.format.samples));
  return { frames: Array.from({ length: count }, () => frame), format: clip.format, seconds: (count * clip.format.samples) / clip.format.sampleRate };
}

// Xing frame: frame count, byte count, and a 100-entry seek table for VBR audio.
function xingFrame(frames, format) {
  const header = Buffer.from(frames[0].subarray(0, 4));
  // Pick the smallest bitrate whose frame fits the tag (side info + 4 + 12 + 100 bytes).
  const table = BITRATES[format.mpeg1 ? 1 : 2];
  let head = null;
  for (let index = 1; index < table.length; index += 1) {
    header[2] = (header[2] & 0x0d) | (index << 4); // set bitrate, clear padding
    head = parseHeader(Buffer.concat([header, Buffer.alloc(4)]), 0);
    if (head.length >= 4 + head.sideInfo + 120) break;
  }
  const frame = Buffer.alloc(head.length);
  header.copy(frame, 0);
  let at = 4 + head.sideInfo;
  frame.write("Xing", at, "latin1");
  frame.writeUInt32BE(0x0007, at + 4); // frames + bytes + TOC
  const audioBytes = frames.reduce((sum, item) => sum + item.length, 0);
  frame.writeUInt32BE(frames.length, at + 8);
  frame.writeUInt32BE(audioBytes + frame.length, at + 12);
  at += 16;
  const offsets = [];
  let running = 0;
  for (const item of frames) {
    offsets.push(running);
    running += item.length;
  }
  for (let i = 0; i < 100; i += 1) {
    const index = Math.min(frames.length - 1, Math.floor((i / 100) * frames.length));
    frame[at + i] = Math.min(255, Math.floor(((offsets[index] + frame.length) / (audioBytes + frame.length)) * 256));
  }
  return frame;
}

export function joinMp3(parts) {
  const frames = parts.flatMap((part) => part.frames);
  if (!frames.length) throw new Error("Nothing to join.");
  const format = parts.find((part) => part.frames.length)?.format;
  return Buffer.concat([xingFrame(frames, format), ...frames]);
}
