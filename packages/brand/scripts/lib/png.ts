/**
 * A small, dependency-free PNG encoder and header reader.
 *
 * The encoder writes 8-bit truecolour (RGB when every pixel is opaque, RGBA
 * otherwise), picks the best of the five standard scanline filters per row and
 * deflates at maximum compression. Output depends only on the pixels, so
 * renders are reproducible.
 */
import { constants, crc32, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_GREY_ALPHA = 4;
const COLOR_TYPE_RGBA = 6;
const OPAQUE = 255;
const RGBA_CHANNELS = 4;
const RGB_CHANNELS = 3;
const IHDR_LENGTH = 13;
/** Byte offsets inside a PNG file: signature (8), IHDR length (4), IHDR type (4), then the data. */
const IHDR_TYPE_OFFSET = 12;
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;
const IHDR_COLOR_TYPE_OFFSET = 25;
const MIN_PNG_HEADER_BYTES = 33;

enum Filter {
  None = 0,
  Sub = 1,
  Up = 2,
  Average = 3,
  Paeth = 4,
}
const FILTERS = [Filter.None, Filter.Sub, Filter.Up, Filter.Average, Filter.Paeth] as const;

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Straight (not premultiplied) RGBA, row-major, 4 bytes per pixel. */
  readonly data: Uint8Array;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

function filterRow(
  filter: Filter,
  row: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  out: Uint8Array,
): void {
  for (let i = 0; i < row.length; i += 1) {
    const value = row[i] ?? 0;
    const left = i >= bytesPerPixel ? (row[i - bytesPerPixel] ?? 0) : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? (previous[i - bytesPerPixel] ?? 0) : 0;
    let predicted = 0;
    if (filter === Filter.Sub) predicted = left;
    else if (filter === Filter.Up) predicted = up;
    else if (filter === Filter.Average) predicted = (left + up) >> 1;
    else if (filter === Filter.Paeth) predicted = paeth(left, up, upLeft);
    out[i] = (value - predicted) & 0xff;
  }
}

/** Standard heuristic: the filter whose output has the smallest sum of signed magnitudes. */
function cost(filtered: Uint8Array): number {
  let sum = 0;
  for (const byte of filtered) sum += byte < 128 ? byte : 256 - byte;
  return sum;
}

function packRows(image: RgbaImage, channels: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let y = 0; y < image.height; y += 1) {
    const row = new Uint8Array(image.width * channels);
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * RGBA_CHANNELS;
      for (let c = 0; c < channels; c += 1) row[x * channels + c] = image.data[source + c] ?? 0;
    }
    rows.push(row);
  }
  return rows;
}

function isOpaque(image: RgbaImage): boolean {
  for (let i = RGBA_CHANNELS - 1; i < image.data.length; i += RGBA_CHANNELS) {
    if (image.data[i] !== OPAQUE) return false;
  }
  return true;
}

export function encodePng(image: RgbaImage): Buffer {
  const { width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid PNG size ${width}x${height}.`);
  }
  if (image.data.length !== width * height * RGBA_CHANNELS) {
    throw new RangeError('Pixel buffer does not match the image size.');
  }
  const opaque = isOpaque(image);
  const channels = opaque ? RGB_CHANNELS : RGBA_CHANNELS;
  const rows = packRows(image, channels);
  const stride = width * channels;
  const filtered = Buffer.alloc(height * (stride + 1));
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  let previous: Uint8Array = new Uint8Array(stride);
  rows.forEach((row, y) => {
    let bestCost = Number.POSITIVE_INFINITY;
    let bestFilter: Filter = Filter.None;
    for (const filter of FILTERS) {
      filterRow(filter, row, previous, channels, candidate);
      const score = cost(candidate);
      if (score < bestCost) {
        bestCost = score;
        bestFilter = filter;
        best.set(candidate);
      }
    }
    const offset = y * (stride + 1);
    filtered[offset] = bestFilter;
    filtered.set(best, offset + 1);
    previous = row;
  });

  const header = Buffer.alloc(IHDR_LENGTH);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = BIT_DEPTH;
  header[9] = opaque ? COLOR_TYPE_RGB : COLOR_TYPE_RGBA;
  // Bytes 10–12: deflate compression, adaptive filtering, no interlace (all zero).
  const compressed = deflateSync(filtered, {
    level: constants.Z_BEST_COMPRESSION,
    memLevel: 9,
    strategy: constants.Z_DEFAULT_STRATEGY,
  });
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

/** Reads width, height and alpha from a PNG's IHDR chunk; throws on anything that is not a PNG. */
export function readPngHeader(bytes: Uint8Array): PngHeader {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buffer.length < MIN_PNG_HEADER_BYTES ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new TypeError('Not a PNG file.');
  }
  if (buffer.toString('latin1', IHDR_TYPE_OFFSET, IHDR_TYPE_OFFSET + 4) !== 'IHDR') {
    throw new TypeError('PNG does not start with an IHDR chunk.');
  }
  const colorType = buffer[IHDR_COLOR_TYPE_OFFSET];
  return {
    width: buffer.readUInt32BE(IHDR_WIDTH_OFFSET),
    height: buffer.readUInt32BE(IHDR_HEIGHT_OFFSET),
    hasAlpha: colorType === COLOR_TYPE_RGBA || colorType === COLOR_TYPE_GREY_ALPHA,
  };
}
