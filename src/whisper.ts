import { downloadWhisperModel, installWhisperCpp, transcribe } from "@remotion/install-whisper-cpp";
import { OggOpusDecoder } from "ogg-opus-decoder";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const WHISPER_CPP_VERSION = "1.7.6";
const WHISPER_MODEL = "base.en";
const WHISPER_ROOT = join(process.cwd(), ".claude", "claudeclaw", "whisper");
const WHISPER_PATH = join(WHISPER_ROOT, "whisper.cpp");
const MODEL_FOLDER = join(WHISPER_ROOT, "models");
const TMP_FOLDER = join(WHISPER_ROOT, "tmp");

let warmupPromise: Promise<void> | null = null;

type WhisperDebugLog = (message: string) => void;

function noopLog(): void {}

function downmixToMono(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 0) return new Float32Array();
  if (channelData.length === 1) return channelData[0];

  const samples = channelData[0].length;
  const out = new Float32Array(samples);
  const scale = 1 / channelData.length;
  for (let i = 0; i < samples; i++) {
    let mixed = 0;
    for (const channel of channelData) mixed += channel[i] ?? 0;
    out[i] = mixed * scale;
  }
  return out;
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  if (input.length === 0) return new Float32Array();

  const targetLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;

  for (let i = 0; i < targetLength; i++) {
    const srcIndex = i * ratio;
    const left = Math.floor(srcIndex);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcIndex - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }

  return output;
}

function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const channels = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const pcm = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(offset, pcm, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

async function decodeOggOpusToWav(inputPath: string, wavPath: string, log: WhisperDebugLog): Promise<void> {
  const decoder = new OggOpusDecoder({ forceStereo: false });
  try {
    log(`voice decode: init decoder`);
    await decoder.ready;
    log(`voice decode: decoder ready`);
    const inputBytes = new Uint8Array(await readFile(inputPath));
    log(`voice decode: read ${inputBytes.length} bytes`);
    const decoded = await decoder.decodeFile(inputBytes);
    log(
      `voice decode: channels=${decoded.channelData.length} sampleRate=${decoded.sampleRate} samplesDecoded=${decoded.samplesDecoded} decodeErrors=${decoded.errors.length}`
    );
    if (decoded.errors.length > 0) {
      const firstError = decoded.errors[0];
      log(
        `voice decode warning: ${firstError.message} frame=${firstError.frameNumber} inputBytes=${firstError.inputBytes} outputSamples=${firstError.outputSamples}`
      );
    }
    if (!decoded.channelData.length) throw new Error("decoded audio is empty");

    const mono = downmixToMono(decoded.channelData);
    const mono16k = resampleLinear(mono, decoded.sampleRate, 16000);
    log(`voice decode: monoSamples=${mono.length} mono16kSamples=${mono16k.length}`);
    const wavBytes = encodeMonoPcm16Wav(mono16k, 16000);
    await writeFile(wavPath, wavBytes);
    log(`voice decode: wrote wav ${wavPath} (${wavBytes.length} bytes)`);
  } finally {
    decoder.free();
    log(`voice decode: decoder freed`);
  }
}

async function prepareWhisperAssets(printOutput: boolean): Promise<void> {
  await mkdir(WHISPER_ROOT, { recursive: true });
  await mkdir(MODEL_FOLDER, { recursive: true });
  await mkdir(TMP_FOLDER, { recursive: true });

  await installWhisperCpp({
    version: WHISPER_CPP_VERSION,
    to: WHISPER_PATH,
    printOutput,
  });
  await downloadWhisperModel({
    model: WHISPER_MODEL,
    folder: MODEL_FOLDER,
    printOutput,
  });
}

async function ensureWavInput(inputPath: string, log: WhisperDebugLog): Promise<string> {
  const ext = extname(inputPath).toLowerCase();
  log(`voice input: path=${inputPath} ext=${ext || "(none)"}`);
  if (ext === ".wav") return inputPath;

  if (ext !== ".ogg" && ext !== ".oga") {
    throw new Error(`unsupported audio format "${ext || "(none)"}" without ffmpeg; supported: .oga, .ogg, .wav`);
  }

  const wavPath = join(TMP_FOLDER, `${basename(inputPath, extname(inputPath))}-${Date.now()}.wav`);
  await decodeOggOpusToWav(inputPath, wavPath, log);
  return wavPath;
}

export function warmupWhisperAssets(options?: { printOutput?: boolean }): Promise<void> {
  const printOutput = options?.printOutput ?? false;
  if (!warmupPromise) {
    warmupPromise = prepareWhisperAssets(printOutput).catch((err) => {
      warmupPromise = null;
      throw err;
    });
  }
  return warmupPromise;
}

export async function transcribeAudioToText(
  inputPath: string,
  options?: { debug?: boolean; log?: WhisperDebugLog }
): Promise<string> {
  const log = options?.debug ? (options?.log ?? console.log) : noopLog;
  await warmupWhisperAssets();
  log(`voice transcribe: warmup ready cwd=${process.cwd()} input=${inputPath}`);
  try {
    const inputStat = await stat(inputPath);
    log(`voice transcribe: input size=${inputStat.size} bytes`);
  } catch (err) {
    log(`voice transcribe: failed to stat input - ${err instanceof Error ? err.message : String(err)}`);
  }

  const wavPath = await ensureWavInput(inputPath, log);
  const shouldCleanup = wavPath !== inputPath;
  log(`voice transcribe: using wav=${wavPath} cleanup=${shouldCleanup}`);
  try {
    const result = await transcribe({
      inputPath: wavPath,
      model: WHISPER_MODEL,
      modelFolder: MODEL_FOLDER,
      whisperCppVersion: WHISPER_CPP_VERSION,
      whisperPath: WHISPER_PATH,
      tokenLevelTimestamps: false,
      printOutput: false,
      language: null,
    });
    log(`voice transcribe: whisper segments=${result.transcription.length}`);

    const transcript = result.transcription
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    log(`voice transcribe: transcript chars=${transcript.length}`);
    return transcript;
  } finally {
    if (shouldCleanup) {
      log(`voice transcribe: cleanup wav=${wavPath}`);
      await rm(wavPath, { force: true }).catch(() => {});
    }
  }
}
