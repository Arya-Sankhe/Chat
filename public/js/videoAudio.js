// Lecture videos: only the sound is needed, so the audio track is taken out in the browser and
// just that is uploaded. Usually the track is copied as is (a few seconds); long or high-bitrate
// audio is re-encoded to compact speech audio. When the browser can do neither, the caller
// uploads the original and the transcriber's ffmpeg drops the video.

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|mpe?g|3gp|ogv)$/i;

// Browsers label audio-only .mp4/.webm files video/* too; copying their audio out is harmless.
export function isVideoFile(file) {
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("audio/")) return false;
  return type.startsWith("video/") || VIDEO_EXTENSIONS.test(String(file?.name || ""));
}

let library = null;
function loadLibrary() {
  library ||= import("../vendor/mediabunny/mediabunny.min.js").catch((error) => {
    library = null;
    throw error;
  });
  return library;
}

function audioName(fileName, extension) {
  const base = String(fileName || "Video").replace(/\.[a-z0-9]{1,5}$/i, "") || "Video";
  return `${base}.${extension}`;
}

// Copying keeps the original audio but a long lecture can carry 128-256 kbps AAC, which is
// 230-460 MB over 4 hours. Above this budget the sound is re-encoded to compact mono speech
// audio instead (32 kbps Opus is about 58 MB for 4 hours), comfortably under the upload limit.
const COPY_BUDGET_BYTES = 250 * 1024 * 1024;
const SPEECH_BITRATE = 32_000;

// Whole-track statistics: a quiet introduction would make an opening sample far too small.
// MP4 and MOV answer this from their index without reading the media.
async function estimatedCopyBytes(track, durationSeconds) {
  const stats = await track.computePacketStats().catch(() => null);
  const bitrate = Number(stats?.averageBitrate);
  if (!Number.isFinite(bitrate) || bitrate <= 0 || !durationSeconds) return Infinity;
  return (bitrate / 8) * durationSeconds * 1.02;
}

async function speechCodec(mb) {
  // Opus first: it honors mono and the bitrate everywhere, while some AAC encoders ignore both.
  for (const codec of ["opus", "aac"]) {
    if (await mb.canEncodeAudio(codec, { numberOfChannels: 1, bitrate: SPEECH_BITRATE }).catch(() => false)) return codec;
  }
  return "";
}

// Resolves to { file, durationSeconds } holding only the audio, or null when this browser
// can neither copy nor re-encode the track. Throws AbortError when canceled.
export async function extractAudioTrack(file, { signal, onProgress } = {}) {
  let mb;
  try {
    mb = await loadLibrary();
  } catch {
    return null;
  }
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  let conversion = null;
  const abort = () => { void conversion?.cancel(); input.dispose(); };
  signal?.addEventListener("abort", abort, { once: true });
  const checkAborted = () => {
    if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
  };

  async function convert(target, audio) {
    checkAborted();
    const output = new mb.Output({ format: target.format(), target: new mb.BufferTarget() });
    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      audio,
      ...(audio.forceTranscode ? {} : { copy: { mode: "forced" } }),
      showWarnings: false
    });
    if (!conversion.isValid || !conversion.utilizedTracks.length) return null;
    checkAborted();
    if (onProgress) conversion.onProgress = (progress) => onProgress(progress);
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer?.byteLength) return null;
    return new File([buffer], audioName(file.name, target.extension), { type: target.type });
  }

  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track?.codec) return null;
    const rawDuration = await input.computeDuration([track]).catch(() => 0);
    const durationSeconds = Number.isFinite(rawDuration) ? rawDuration : 0;
    // MP4 carries AAC, MP3, Opus and FLAC; WebM covers Vorbis.
    const targets = [
      { format: () => new mb.Mp4OutputFormat({ fastStart: "in-memory" }), extension: "m4a", type: "audio/mp4" },
      { format: () => new mb.WebMOutputFormat(), extension: "webm", type: "audio/webm" }
    ];
    const copyTarget = targets.find((item) => item.format().getSupportedAudioCodecs().includes(track.codec));
    const compactCodec = async () => (await track.canDecode().catch(() => false) ? speechCodec(mb) : "");

    let copied = null;
    if (copyTarget && await estimatedCopyBytes(track, durationSeconds) <= COPY_BUDGET_BYTES) {
      copied = await convert(copyTarget, { forceTranscode: false });
      // The estimate is only a guide; a copy over budget is re-encoded rather than rejected on upload.
      if (copied && copied.size <= COPY_BUDGET_BYTES) return { file: copied, durationSeconds };
    }
    const codec = await compactCodec();
    let result = codec
      ? await convert(targets[0], { codec, bitrate: SPEECH_BITRATE, numberOfChannels: 1, forceTranscode: true })
      : null;
    if (!result && copyTarget) result = copied || await convert(copyTarget, { forceTranscode: false });
    return result ? { file: result, durationSeconds } : null;
  } catch (error) {
    checkAborted();
    console.warn("Could not take the audio out of this video; uploading the original.", error);
    return null;
  } finally {
    signal?.removeEventListener("abort", abort);
    input.dispose();
  }
}
