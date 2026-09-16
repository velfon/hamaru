/**
 * PWA アイコンの生成(docs/03 §8)。
 * 「--kiln 背景に 2×2 の釉薬タイル(柿・青磁・黄瀬戸・藤)を目地付きで配置。
 *   マスカブル対応(セーフゾーン 80 %)」
 *
 * 画像を手で置くとサイズ予算とレビューが面倒なので、PNG を**その場で書き出す**。
 * 依存を増やさないため、zlib(Node 標準)だけで最小の PNG エンコーダを書いている。
 *
 *   npx tsx scripts/gen-icons.ts
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");

const KILN = [0x17, 0x26, 0x2a];
const GLAZES = [
  [0xe0, 0x85, 0x5a], // 柿
  [0x5f, 0xb3, 0xa1], // 青磁
  [0xe4, 0xc2, 0x5a], // 黄瀬戸
  [0x9a, 0x86, 0xc9], // 藤
];

/* ---------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------- 絵 ------------------------------------ */

function drawIcon(size: number, maskable: boolean): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const set = (x: number, y: number, rgb: readonly number[]): void => {
    const i = (y * size + x) * 4;
    px[i] = rgb[0] as number;
    px[i + 1] = rgb[1] as number;
    px[i + 2] = rgb[2] as number;
    px[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) set(x, y, KILN);
  }

  // マスカブルはセーフゾーン 80 %(= 内側 80 % に収める)。
  const art = maskable ? size * 0.62 : size * 0.76;
  const origin = (size - art) / 2;
  const grout = art * 0.06;
  const tile = (art - grout) / 2;
  const radius = tile * 0.14;

  const inRounded = (lx: number, ly: number): boolean => {
    const dx = Math.min(lx, tile - lx);
    const dy = Math.min(ly, tile - ly);
    if (dx >= radius || dy >= radius) return true;
    const cx = dx < radius ? radius - dx : 0;
    const cy = dy < radius ? radius - dy : 0;
    return cx * cx + cy * cy <= radius * radius;
  };

  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const left = origin + col * (tile + grout);
    const top = origin + row * (tile + grout);
    const color = GLAZES[i] as number[];
    for (let y = Math.floor(top); y < Math.ceil(top + tile); y++) {
      for (let x = Math.floor(left); x < Math.ceil(left + tile); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const lx = x - left;
        const ly = y - top;
        if (lx < 0 || ly < 0 || lx > tile || ly > tile) continue;
        if (!inRounded(lx, ly)) continue;
        // 上から下へ軽い艶(釉薬のハイライト)。
        const shade = 1.14 - 0.26 * (ly / tile);
        set(x, y, [
          Math.min(255, Math.round((color[0] as number) * shade)),
          Math.min(255, Math.round((color[1] as number) * shade)),
          Math.min(255, Math.round((color[2] as number) * shade)),
        ]);
      }
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });

const files: Array<[string, number, boolean]> = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
];

for (const [name, size, maskable] of files) {
  const png = encodePng(size, size, drawIcon(size, maskable));
  writeFileSync(resolve(OUT, name), png);
  console.log(`${name}: ${png.length} bytes`);
}

/* favicon は SVG(小さく、テーマに追従しない固定色)。 */
const svgTile = (x: number, y: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="13" height="13" rx="2" fill="${fill}"/>`;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="#17262A"/>
${svgTile(4, 4, "#E0855A")}${svgTile(15, 4, "#5FB3A1")}${svgTile(4, 15, "#E4C25A")}${svgTile(15, 15, "#9A86C9")}
</svg>
`;
writeFileSync(resolve(OUT, "favicon.svg"), favicon);
console.log(`favicon.svg: ${favicon.length} bytes`);
