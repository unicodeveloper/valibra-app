import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/**
 * Markdown → .docx.
 *
 * Server-side on purpose: the docx builder is a large dependency and no part of
 * it is needed to render the page, so keeping it here leaves the client bundle
 * alone. The alternative — an HTML file named .doc — opens in Word but lays out
 * unpredictably, which is worse than not offering the format.
 *
 * The subset handled is the subset DeepResearch actually emits: headings,
 * paragraphs, bullet and numbered lists, block quotes, fenced code, simple
 * tables, and inline bold / italic / code / links. Anything unrecognised falls
 * through as plain text rather than being dropped.
 */

const HEADING_BY_LEVEL = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/**
 * Inline markdown → docx runs. Order matters: links first, so their label text
 * isn't consumed by the emphasis passes.
 *
 * The link label allows one level of nested brackets. DeepResearch cites as
 * `[[1]](url)`, and a label of `[^\]]*` cannot span the inner `]` — so every
 * citation in the report failed to match and leaked into Word as raw markdown
 * followed by a bare URL. Measured on a real report: 47 of them.
 */
function inlineRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  const pattern =
    /\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;

  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun(text.slice(last, m.index)));

    if (m[1] !== undefined && m[2] !== undefined) {
      out.push(
        new ExternalHyperlink({
          link: m[2],
          children: [new TextRun({ text: m[1] || m[2], style: "Hyperlink" })],
        }),
      );
    } else if (m[3] !== undefined) {
      out.push(new TextRun({ text: m[3], bold: true }));
    } else if (m[4] !== undefined) {
      out.push(new TextRun({ text: m[4], italics: true }));
    } else if (m[5] !== undefined) {
      out.push(new TextRun({ text: m[5], font: "Consolas" }));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)));
  return out.length ? out : [new TextRun("")];
}

function tableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

function markdownToBlocks(md: string): (Paragraph | Table)[] {
  const lines = md.split("\n");
  const blocks: (Paragraph | Table)[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Fenced code — emit verbatim until the closing fence.
    if (/^```/.test(trimmed)) {
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        blocks.push(
          new Paragraph({ children: [new TextRun({ text: lines[i], font: "Consolas", size: 18 })] }),
        );
        i++;
      }
      continue;
    }

    // Table: a header row followed by a divider.
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = tableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(tableRow(lines[i]));
        i++;
      }
      i--;
      blocks.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [header, ...rows].map(
            (cells, rowIndex) =>
              new TableRow({
                children: cells.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children:
                            rowIndex === 0
                              ? [new TextRun({ text: cell, bold: true })]
                              : inlineRuns(cell),
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push(
        new Paragraph({
          heading: HEADING_BY_LEVEL[heading[1].length - 1],
          children: inlineRuns(heading[2]),
        }),
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      blocks.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(bullet[1]) }));
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      blocks.push(
        new Paragraph({ numbering: { reference: "report-numbering", level: 0 }, children: inlineRuns(numbered[1]) }),
      );
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(
        new Paragraph({ indent: { left: 480 }, children: [new TextRun({ text: quote[1], italics: true })] }),
      );
      continue;
    }

    blocks.push(new Paragraph({ children: inlineRuns(trimmed) }));
  }

  return blocks;
}

export interface DocxReport {
  title: string;
  meta: string;
  body: string;
  sources: { title: string; url: string }[];
}

/** Build the .docx and return it as a buffer ready to stream. */
export async function buildDocx(report: DocxReport): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(report.title)] }),
    new Paragraph({
      children: [new TextRun({ text: report.meta, italics: true, color: "666666" })],
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph({ children: [new TextRun("")] }),
    ...markdownToBlocks(report.body),
  ];

  if (report.sources.length) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Sources")] }),
    );
    report.sources.forEach((s, i) => {
      const label = s.title || s.url;
      children.push(
        new Paragraph({
          children: [
            new TextRun(`${i + 1}. `),
            s.url
              ? new ExternalHyperlink({
                  link: s.url,
                  children: [new TextRun({ text: label, style: "Hyperlink" })],
                })
              : new TextRun(label),
          ],
        }),
      );
    });
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "report-numbering",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
