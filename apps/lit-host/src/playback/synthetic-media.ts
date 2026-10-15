/**
 * A real, decodable mono 16-bit PCM WAV of a quiet synthetic tone. The example application serves
 * it as its "protected" episode and browser tests decode it; it is generated, so no recording,
 * customer content or third-party audio is involved.
 */
export function toneWav(seconds = 3, rate = 8_000): Uint8Array {
  const samples = seconds * rate;
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) out.writeInt16LE(Math.round(Math.sin(i / 6) * 1_500), 44 + i * 2);
  return new Uint8Array(out);
}
