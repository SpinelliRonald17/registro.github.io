const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makeClockIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const R = size * 0.46;
  const ringW = Math.max(2, size * 0.06);
  const handW = Math.max(1.5, size * 0.03);
  const bg = [30, 110, 240, 255];
  const fg = [255, 255, 255, 255];
  const pt = (deg, len) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + Math.cos(a) * len, c + Math.sin(a) * len];
  };
  const hour = pt(300, R * 0.4);
  const minute = pt(60, R * 0.58);
  const centerDotR = Math.max(2, size * 0.025);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = Math.hypot(px - c, py - c);
      let color = bg;
      if (d <= R + ringW && d >= R - ringW) color = fg;
      else if (
        d < R - ringW &&
        (distToSeg(px, py, c, c, hour[0], hour[1]) < handW ||
          distToSeg(px, py, c, c, minute[0], minute[1]) < handW ||
          d < centerDotR)
      ) {
        color = fg;
      }
      const i = (y * size + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = color[3];
    }
  }
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [512, 192, 180, 32]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makeClockIcon(size));
  console.log(`icon-${size}.png generado`);
}
console.log('Iconos PWA listos en public/icons/');
