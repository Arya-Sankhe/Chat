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

export function validatedAudioDuration(audio, contentType) {
  const seconds = String(contentType || "").toLowerCase().includes("wav") ? wavDuration(audio) : 0;
  if (!(seconds > 0)) throw new HttpError(400, "A valid WAV recording is required.");
  return seconds;
}
