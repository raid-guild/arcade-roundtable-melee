import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve("assets-src/art-review");
const OUT_BG = path.resolve("public/backgrounds");
const OUT_SPRITES = path.resolve("public/sprites");
const OUT_CHARACTER_SPRITES = path.resolve("public/sprites/characters");

const ITEM_SOURCE = path.join(SRC, "items-v1-chroma.png");
const RANGER_SOURCE = path.join(SRC, "ranger-pose-sheet-v1-chroma.png");
const ARENA_SOURCE = path.join(SRC, "arena-dungeon-v1.png");
const GENERATED_POSES = path.join(SRC, "generated-poses");

const ITEM_NAMES = ["ham", "chest-closed", "chest-damaged", "chest-open"];
const RANGER_POSES = [
  "idle-down",
  "idle-up",
  "idle-left",
  "idle-right",
  "attack-down",
  "attack-up",
  "attack-left",
  "attack-right",
  "frozen",
  "disconnected",
];

const CHARACTER_SOURCES = [
  ["alchemist", path.join(GENERATED_POSES, "alchemist-pose-sheet-v1-chroma.png")],
  ["archer", path.join(GENERATED_POSES, "archer-pose-sheet-v1-chroma.png")],
  ["cleric", path.join(GENERATED_POSES, "cleric-pose-sheet-v1-chroma.png")],
  ["druid", path.join(GENERATED_POSES, "druid-pose-sheet-v1-chroma.png")],
  ["dwarf", path.join(GENERATED_POSES, "dwarf-pose-sheet-v1-chroma.png")],
  ["healer", path.join(GENERATED_POSES, "healer-pose-sheet-v1-chroma.png")],
  ["hunter", path.join(GENERATED_POSES, "hunter-pose-sheet-v1-chroma.png")],
  ["monk", path.join(GENERATED_POSES, "monk-pose-sheet-v1-chroma.png")],
  ["necromancer", path.join(GENERATED_POSES, "necromancer-pose-sheet-v1-chroma.png")],
  ["paladin", path.join(GENERATED_POSES, "paladin-pose-sheet-v1-chroma.png")],
  ["ranger", RANGER_SOURCE],
  ["rogue", path.join(GENERATED_POSES, "rogue-pose-sheet-v1-chroma.png")],
  ["scribe", path.join(GENERATED_POSES, "scribe-pose-sheet-v1-chroma.png")],
  ["tavern-keeper", path.join(GENERATED_POSES, "tavern-keeper-pose-sheet-v1-chroma.png")],
  ["warrior", path.join(GENERATED_POSES, "warrior-pose-sheet-v1-chroma.png")],
  ["wizard", path.join(GENERATED_POSES, "wizard-pose-sheet-v1-chroma.png")],
];

async function main() {
  await mkdir(OUT_BG, { recursive: true });
  await mkdir(OUT_SPRITES, { recursive: true });
  await mkdir(OUT_CHARACTER_SPRITES, { recursive: true });

  await sharp(ARENA_SOURCE)
    .resize(720, 660, {
      fit: "cover",
      position: "center",
      kernel: "nearest",
    })
    .png({ palette: true, colors: 96, dither: 0 })
    .toFile(path.join(OUT_BG, "arena-dungeon.png"));

  await buildHorizontalSheet({
    src: ITEM_SOURCE,
    outPng: path.join(OUT_SPRITES, "items.png"),
    outJson: path.join(OUT_SPRITES, "items.json"),
    names: ITEM_NAMES,
    cell: { w: 48, h: 48 },
    key: { r: 0, g: 255, b: 0 },
    pad: 8,
  });

  for (const [name, src] of CHARACTER_SOURCES) {
    const outPng = path.join(OUT_CHARACTER_SPRITES, `${name}.png`);
    await buildRowSheet({
      src,
      label: name,
      segmentMode: "detect",
      outPng,
      outJson: path.join(OUT_CHARACTER_SPRITES, `${name}.json`),
      names: RANGER_POSES,
      rowCounts: [4, 6],
      cell: { w: 54, h: 68 },
      key: { r: 255, g: 0, b: 255 },
      pad: 8,
    });

    await sharp(outPng)
      .extract({ left: 0, top: 0, width: 54, height: 68 })
      .png()
      .toFile(path.join(OUT_CHARACTER_SPRITES, `${name}-preview.png`));
  }

  await sharp(path.join(OUT_CHARACTER_SPRITES, "ranger.png"))
    .toFile(path.join(OUT_SPRITES, "ranger-poses.png"));
  await writeFile(
    path.join(OUT_SPRITES, "ranger-poses.json"),
    JSON.stringify({ cell: { w: 54, h: 68 }, names: RANGER_POSES, source: path.relative(".", RANGER_SOURCE) }, null, 2)
  );
  await sharp(path.join(OUT_CHARACTER_SPRITES, "ranger-preview.png"))
    .toFile(path.join(OUT_SPRITES, "ranger-preview.png"));

  console.log("wrote approved art to public/backgrounds and public/sprites");
}

async function buildHorizontalSheet({ src, outPng, outJson, names, cell, key, pad }) {
  const source = sharp(src).ensureAlpha();
  const { data, info } = await source.clone().raw().toBuffer({ resolveWithObject: true });
  const cells = [];

  for (let i = 0; i < names.length; i += 1) {
    const x0 = Math.floor((i * info.width) / names.length);
    const x1 = Math.floor(((i + 1) * info.width) / names.length);
    cells.push(await extractCell(source, data, info, { x0, x1, y0: 0, y1: info.height, cell, key, pad }));
  }

  await writeSheet(cells, cell, outPng);
  await writeFile(outJson, JSON.stringify({ cell, names, source: path.relative(".", src) }, null, 2));
}

async function buildRowSheet({
  src,
  label = src,
  segmentMode = "detect",
  outPng,
  outJson,
  names,
  rowCounts,
  cell,
  key,
  pad,
}) {
  const source = sharp(src).ensureAlpha();
  const { data, info } = await source.clone().raw().toBuffer({ resolveWithObject: true });
  const cells = [];
  let nameIndex = 0;

  for (let row = 0; row < rowCounts.length; row += 1) {
    const y0 = Math.floor((row * info.height) / rowCounts.length);
    const y1 = Math.floor(((row + 1) * info.height) / rowCounts.length);
    const cols = rowCounts[row];
    const detectedGroups = findColumnGroups(data, info, y0, y1, key);
    const groups =
      segmentMode === "equal" || detectedGroups.length < cols
        ? equalColumnGroups(info.width, cols)
        : detectedGroups.slice(0, cols);
    for (let col = 0; col < cols; col += 1) {
      if (nameIndex >= names.length) break;
      const { x0, x1 } = groups[col];
      cells.push(
        await extractCell(source, data, info, {
          label: `${label}:${names[nameIndex]}`,
          x0,
          x1,
          y0,
          y1,
          cell,
          key,
          pad,
        })
      );
      nameIndex += 1;
    }
  }

  await writeSheet(cells, cell, outPng);
  await writeFile(outJson, JSON.stringify({ cell, names, source: path.relative(".", src) }, null, 2));
}

function equalColumnGroups(width, cols) {
  return Array.from({ length: cols }, (_, col) => ({
    x0: Math.floor((col * width) / cols),
    x1: Math.floor(((col + 1) * width) / cols),
  }));
}

function findColumnGroups(data, info, y0, y1, key) {
  const active = [];
  for (let x = 0; x < info.width; x += 1) {
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] <= 10) continue;
      if (keyDistance({ r: data[i], g: data[i + 1], b: data[i + 2] }, key) >= 48) {
        count += 1;
      }
    }
    active[x] = count > 4;
  }

  const groups = [];
  let start = -1;
  let lastActive = -1;
  const maxGap = 14;
  for (let x = 0; x < active.length; x += 1) {
    if (active[x]) {
      if (start < 0) start = x;
      lastActive = x;
      continue;
    }
    if (start >= 0 && x - lastActive > maxGap) {
      groups.push({ x0: Math.max(0, start - 8), x1: Math.min(info.width, lastActive + 9) });
      start = -1;
      lastActive = -1;
    }
  }
  if (start >= 0) {
    groups.push({ x0: Math.max(0, start - 8), x1: Math.min(info.width, lastActive + 9) });
  }

  return groups.filter((group) => {
    const bounds = measureGroup(data, info, group.x0, group.x1, y0, y1, key);
    return group.x1 - group.x0 > 24 && bounds.count > 500 && bounds.height > 32;
  });
}

function measureGroup(data, info, x0, x1, y0, y1, key) {
  let count = 0;
  let minY = Infinity;
  let maxY = -1;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] <= 10) continue;
      if (keyDistance({ r: data[i], g: data[i + 1], b: data[i + 2] }, key) < 48) continue;
      count += 1;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { count, height: maxY >= minY ? maxY - minY + 1 : 0 };
}

async function extractCell(source, data, info, { label, x0, x1, y0, y1, cell, key, pad }) {
  const bounds = findNonKeyBounds(data, info, x0, x1, y0, y1, key, label);
  const left = Math.max(0, bounds.minX - pad);
  const top = Math.max(0, bounds.minY - pad);
  const width = Math.min(info.width - left, bounds.maxX - bounds.minX + 1 + pad * 2);
  const height = Math.min(info.height - top, bounds.maxY - bounds.minY + 1 + pad * 2);

  const cropped = await source
    .clone()
    .extract({ left, top, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const keyed = removeKey(cropped.data, cropped.info, key);

  return sharp(keyed, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: 4,
    },
  })
    .resize(cell.w, cell.h, {
      fit: "contain",
      position: "south",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "nearest",
    })
    .png()
    .toBuffer();
}

function findNonKeyBounds(data, info, x0, x1, y0, y1, key, label = "sprite") {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * info.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a <= 10 || keyDistance({ r, g, b }, key) < 48) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error(`${label}: no sprite pixels found while extracting approved art.`);
  }

  return { minX, minY, maxX, maxY };
}

function removeKey(data, info, key) {
  const out = Buffer.from(data);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * 4;
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      const dist = keyDistance({ r, g, b }, key);
      if (dist < 70) {
        out[i + 3] = 0;
      }
    }
  }
  return out;
}

async function writeSheet(cells, cell, outPng) {
  await sharp({
    create: {
      width: cell.w * cells.length,
      height: cell.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(cells.map((input, i) => ({ input, left: i * cell.w, top: 0 })))
    .png({ palette: true, colors: 128, dither: 0 })
    .toFile(outPng);
}

function keyDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
