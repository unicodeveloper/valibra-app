import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import OpenAI from "openai";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not available in the environment or .env.local");
}

const OUT_DIR = path.join(process.cwd(), "public", "og");
const WORK_DIR = path.join(os.tmpdir(), "openmlr-og-backplates");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

const cards = [
  {
    slug: "openmlr",
    rightStudy: "faint comparative A1C chart fragments on the right, drawn without labels",
    eyebrow: "MLR pre-check · open source",
    eyebrowRight: "Grounded via Valyu",
    headline: ["Check every claim", "against the evidence"],
    lede: [
      "Every promotional claim, tested against approved labelling,",
      "trial records and the peer-reviewed literature.",
    ],
    sheetLabel: "Promotional asset · 14 claims extracted",
    sheetMeta: "US · HCP",
    claimNumber: "4",
    claim: "In a head-to-head trial, OZEMPIC reduced A1C more than dulaglutide.",
    verdict: "Claim not supported by the evidence",
    source: "Drug labels · 12 sources",
    severity: "critical",
  },
  {
    slug: "research",
    rightStudy: "quiet post-market surveillance trend lines and clipped source sheets, no axis text",
    eyebrow: "Deep research lane",
    eyebrowRight: "Grounded via Valyu",
    headline: ["Deep research that outlives", "the browser tab"],
    lede: [
      "Surveillance, device and indication checks run as long-form",
      "research against licensed datasets, and finish without you.",
    ],
    sheetLabel: "Deep research · post-market surveillance",
    sheetMeta: "Running · 41 sources",
    claimNumber: "9",
    claim: "No new safety signal has emerged since approval.",
    verdict: "Needs post-market surveillance",
    source: "Adverse events · clinical trials",
    severity: "warning",
  },
  {
    slug: "library",
    rightStudy: "subtle claim-card archive tabs and a pale clinical curve, no labels or numbers",
    eyebrow: "Claims library",
    eyebrowRight: "Substantiate once",
    headline: ["A claim you have cleared", "stays cleared"],
    lede: [
      "Accepted claims are kept with the evidence that cleared them, so the",
      "next asset reusing a line reuses its substantiation too.",
    ],
    sheetLabel: "Claims library · matched on this asset",
    sheetMeta: "Confirmed · 98% match",
    claimNumber: "1",
    claim: "OZEMPIC lowers A1C by up to 1.8% in adults with type 2 diabetes.",
    verdict: "Cleared previously — evidence reused",
    source: "Library · confirmed by reviewer",
    severity: "supported",
  },
  {
    slug: "history",
    rightStudy: "archival binder texture, punched holes, transparent sheets and faint graph paper with no labels",
    eyebrow: "Review history",
    eyebrowRight: "Audit trail kept",
    headline: ["Every review, every decision,", "still on the record"],
    lede: [
      "Each run keeps its claims, findings, reviewer decisions and the",
      "datasets it queried — reopenable months later.",
    ],
    sheetLabel: "Review history · 3 runs on this asset",
    sheetMeta: "Reopened · decisions intact",
    claimNumber: "4",
    claim: "In a head-to-head trial, OZEMPIC reduced A1C more than dulaglutide.",
    verdict: "Rejected by reviewer — revision requested",
    source: "Audit · 2 decisions recorded",
    severity: "critical",
  },
  {
    slug: "dossier",
    rightStudy: "layered dossier pages and a cropped evidence chart, no text, no barcode, no dates",
    eyebrow: "Evidence dossier",
    eyebrowRight: "Export as PDF",
    headline: ["The evidence behind a drug,", "in one cited document"],
    lede: [
      "Approved labelling, the trial record and the literature, assembled",
      "into a dossier a reviewer can read, quote and hand on.",
    ],
    sheetLabel: "Evidence dossier · semaglutide",
    sheetMeta: "72 sources · 3 datasets",
    claimNumber: "§",
    claim: "Indications, trial record and safety profile, assembled with citations.",
    verdict: "Every section cites its source",
    source: "Drug labels · trials · PubMed",
    severity: "supported",
  },
  {
    slug: "review",
    rightStudy: "faint forest-plot geometry, paper notes and evidence tabs without labels or numbers",
    eyebrow: "Claim-by-claim review",
    eyebrowRight: "Every finding cited",
    headline: ["A verdict on every claim,", "with its source attached"],
    lede: [
      "Findings sorted by severity, each carrying the evidence",
      "a reviewer needs to accept or reject it on.",
    ],
    sheetLabel: "Findings · sorted by severity",
    sheetMeta: "3 critical · 6 to review",
    claimNumber: "1",
    claim: "OZEMPIC lowers A1C by up to 1.8% in adults with type 2 diabetes.",
    verdict: "Supported by the approved label",
    source: "Drug labels · §14.1",
    severity: "supported",
  },
];

const status = {
  critical: { color: "#7f2f27", mark: "△" },
  warning: { color: "#73520f", mark: "○" },
  supported: { color: "#245c50", mark: "✓" },
};

const fonts = {
  sans: path.join(process.cwd(), "assets", "fonts", "PublicSans-Regular.ttf"),
  sansBold: path.join(process.cwd(), "assets", "fonts", "PublicSans-Bold.ttf"),
  serif: path.join(process.cwd(), "assets", "fonts", "SourceSerif4-Regular.otf"),
  mono: path.join(process.cwd(), "assets", "fonts", "IBMPlexMono-Medium.ttf"),
};

function draw(args, command) {
  args.push("-draw", command);
}

function annotate(args, { x, y, text, font, size, fill, gravity = "NorthWest", kerning = 0 }) {
  args.push(
    "-font",
    font,
    "-pointsize",
    String(size),
    "-fill",
    fill,
    "-kerning",
    String(kerning),
    "-gravity",
    gravity,
    "-annotate",
    `+${x}+${y}`,
    text,
  );
}

function renderArgs(card, basePath, outputPath) {
  const s = status[card.severity];
  const headlineSize = card.slug === "openmlr" ? 79 : 76;
  const headlineY = card.slug === "openmlr" ? [135, 218] : [139, 222];
  const ledeY = card.slug === "openmlr" ? [324, 358] : [326, 360];
  const args = [basePath];

  draw(args, "fill '#f7f3ea44' rectangle 0,0 1200,630");
  draw(args, "stroke '#7f82789e' stroke-width 1.2 line 80,104 1138,104");
  draw(args, "stroke '#899087aa' stroke-width 1 line 280,54 280,88");
  annotate(args, { x: 80, y: 47, text: "OpenMLR", font: fonts.sansBold, size: 40, fill: "#0c1816" });
  annotate(args, { x: 314, y: 59, text: card.eyebrow, font: fonts.mono, size: 16, fill: "#172520", kerning: 1.8 });
  annotate(args, { x: 62, y: 59, text: card.eyebrowRight, font: fonts.mono, size: 16, fill: "#174f47", gravity: "NorthEast", kerning: 1.7 });

  annotate(args, { x: 82, y: headlineY[0], text: card.headline[0], font: fonts.serif, size: headlineSize, fill: "#0d1d1a" });
  annotate(args, { x: 82, y: headlineY[1], text: card.headline[1], font: fonts.serif, size: headlineSize, fill: "#0d1d1a" });
  annotate(args, { x: 84, y: ledeY[0], text: card.lede[0], font: fonts.serif, size: 27, fill: "#33403a" });
  annotate(args, { x: 84, y: ledeY[1], text: card.lede[1], font: fonts.serif, size: 27, fill: "#33403a" });

  draw(args, "fill '#1018151d' stroke 'none' roundrectangle 78,434 1134,592 11,11");
  draw(args, "fill '#fffdf8ee' stroke '#aaa89f' stroke-width 1.2 roundrectangle 72,421 1128,579 11,11");
  draw(args, "fill '#f7f2e880' stroke 'none' rectangle 73,422 1127,471");
  draw(args, "stroke '#8f9389a8' stroke-width 1 line 72,471 1128,471");

  annotate(args, { x: 106, y: 440, text: card.sheetLabel, font: fonts.mono, size: 15, fill: "#29322f", kerning: 1.6 });
  annotate(args, { x: 106, y: 440, text: card.sheetMeta, font: fonts.mono, size: 15, fill: "#29322f", gravity: "NorthEast", kerning: 1.6 });

  annotate(args, { x: 113, y: 493, text: card.claim, font: fonts.serif, size: 30, fill: "#101a18" });
  annotate(args, { x: 113, y: 543, text: s.mark, font: fonts.sansBold, size: 25, fill: s.color });
  annotate(args, { x: 150, y: 544, text: card.verdict, font: fonts.sansBold, size: 23, fill: s.color });
  annotate(args, { x: 106, y: 544, text: card.source, font: fonts.mono, size: 15, fill: "#343d39", gravity: "NorthEast", kerning: 1.6 });

  args.push(outputPath);
  return args;
}

function backplatePrompt(card) {
  return `
Create a text-free editorial background plate for a 1200x640 Open Graph card for OpenMLR, a serious medical-legal-regulatory evidence review tool.

No readable text, no letters, no numbers, no watermarks, no logo, no UI copy, no labels, no dates, no barcodes. Do not draw any red, green, amber, or teal thick borders, rails, frames, side strips, severity bars, or colored left edges. Avoid stock medical symbols, pills, stethoscopes, DNA helixes, glassmorphism, glossy gradients, generic SaaS bento cards, and fake 3D.

Visual direction: premium scanned pharmaceutical evidence dossier, tactile warm paper, subtle fibers and dust, fine grey regulatory rules, very faint abstract chart geometry, understated hand annotation strokes, quiet shadows from stacked paper. Leave clean open space in the upper-left for a large headline and a clean white evidence panel area near the bottom. The final text will be added separately, so the plate must stay mostly quiet and legible.

Variant-specific background detail: ${card.rightStudy}.
`.trim();
}

function runMagick(args) {
  const result = spawnSync("magick", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`ImageMagick failed: ${args.join(" ")}`);
  }
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

for (const card of cards) {
  const backplatePath = path.join(WORK_DIR, `${card.slug}-backplate.png`);
  if (!fs.existsSync(backplatePath)) {
    console.log(`Generating backplate: ${card.slug}`);
    const response = await client.images.generate({
      model: "gpt-image-2",
      prompt: backplatePrompt(card),
      size: "1200x640",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image returned for ${card.slug}`);
    fs.writeFileSync(backplatePath, Buffer.from(b64, "base64"));
  } else {
    console.log(`Using cached backplate: ${card.slug}`);
  }

  const basePath = path.join(WORK_DIR, `${card.slug}-base.png`);
  const outputPath = path.join(OUT_DIR, `${card.slug}.png`);

  runMagick([backplatePath, "-gravity", "center", "-crop", "1200x630+0+0", "+repage", basePath]);
  runMagick(renderArgs(card, basePath, outputPath));
  console.log(outputPath);
}
