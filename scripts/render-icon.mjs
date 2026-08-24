import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const assetsDir = path.join(__dirname, '..', 'assets');
const svgPath = path.join(assetsDir, 'icon.svg');
const pngPath = path.join(assetsDir, 'icon.png');
const icoPath = path.join(assetsDir, 'icon.ico');

const svg = fs.readFileSync(svgPath);
const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 512 },
}).render().asPng();

fs.writeFileSync(pngPath, png);
fs.writeFileSync(icoPath, await pngToIco(pngPath));

console.log(`Wrote ${pngPath}`);
console.log(`Wrote ${icoPath}`);
