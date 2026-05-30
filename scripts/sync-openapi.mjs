#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const defaultOutput = path.join(repoRoot, "openapi", "openapi.json");
const execFileAsync = promisify(execFile);

function usage() {
  console.error(`Usage:
  sync-openapi.mjs --source-url <url> [--output <path>]
  sync-openapi.mjs --rfid-dir <path> [--output <path>]

Options:
  --source-url  Fetch OpenAPI JSON from a deployed DropRFID API.
  --rfid-dir    Extract openAPISpec from backend/internal/api/handlers/openapi.go.
  --output      Destination file. Defaults to openapi/openapi.json.
`);
}

function parseArgs(argv) {
  const args = { output: defaultOutput };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-url") {
      args.sourceUrl = argv[++i];
    } else if (arg === "--rfid-dir") {
      args.rfidDir = argv[++i];
    } else if (arg === "--output") {
      args.output = path.resolve(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function extractRawString(source, constName) {
  const startToken = `const ${constName} = \``;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`could not find ${constName} raw string`);
  }

  const rawStart = start + startToken.length;
  const rawEnd = source.indexOf("`", rawStart);
  if (rawEnd === -1) {
    throw new Error(`could not find closing backtick for ${constName}`);
  }
  return source.slice(rawStart, rawEnd);
}

async function loadFromRfidDir(rfidDir) {
  const resolvedRfidDir = path.resolve(rfidDir);
  const openapiGo = path.join(
    resolvedRfidDir,
    "backend",
    "internal",
    "api",
    "handlers",
    "openapi.go",
  );

  try {
    const source = await readFile(openapiGo, "utf8");
    return extractRawString(source, "openAPISpec");
  } catch (error) {
    if (error?.code !== "ENOENT" && !String(error?.message ?? "").includes("raw string")) {
      throw error;
    }
  }

  const backendDir = path.join(resolvedRfidDir, "backend");
  const { stdout } = await execFileAsync("go", ["run", "./cmd/openapi"], {
    cwd: backendDir,
    maxBuffer: 1024 * 1024 * 10,
  });
  return stdout;
}

async function loadFromUrl(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function normalizeSpec(raw) {
  const spec = JSON.parse(raw);
  if (!spec.openapi || !spec.info || !spec.paths) {
    throw new Error("document does not look like an OpenAPI spec");
  }
  return `${JSON.stringify(spec, null, 2)}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if ((args.sourceUrl ? 1 : 0) + (args.rfidDir ? 1 : 0) !== 1) {
    usage();
    throw new Error("provide exactly one of --source-url or --rfid-dir");
  }

  const raw = args.sourceUrl
    ? await loadFromUrl(args.sourceUrl)
    : await loadFromRfidDir(args.rfidDir);
  const formatted = normalizeSpec(raw);

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, formatted);
  console.log(`wrote ${path.relative(process.cwd(), args.output)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
