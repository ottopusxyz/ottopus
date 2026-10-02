/** For tests: a painted bar's cells, back as its glyphs and each cell's foreground colour. */
export function painted(cells: unknown): { glyphs: string; colors: number[] } {
  // The engine's runtime has fromBase64; the TypeScript lib in use does not declare it yet.
  const bytes = (Uint8Array as unknown as { fromBase64(base64: string): Uint8Array<ArrayBuffer> }).fromBase64(String(cells))
  const words = new Uint32Array(bytes.buffer)
  const each = Array.from({ length: words.length / 3 }, (_, i) => i * 3)
  return { glyphs: each.map((i) => String.fromCodePoint(words[i]!)).join(''), colors: each.map((i) => words[i + 1]!) }
}
