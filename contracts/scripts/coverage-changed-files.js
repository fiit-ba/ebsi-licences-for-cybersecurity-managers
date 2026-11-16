// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Fail when a contract changed since a base commit has too little line
 * coverage. Run from contracts/ after `FOUNDRY_PROFILE=coverage forge
 * coverage --report lcov` (foundry.toml says why that profile).
 *
 * Usage:
 *   node scripts/coverage-changed-files.js --lcov coverage/lcov.info \
 *     --base origin/main --threshold 90
 *
 * Only files under contracts/ count: tests, scripts and the mocks are not
 * the contract. A changed file the report does not name counts as 0 %, unless
 * its source declares nothing that runs (only interfaces, or no function,
 * constructor, modifier, fallback or receive with a body). A file the report
 * names with no executable lines passes. With `GITHUB_STEP_SUMMARY` set, the
 * table is also written there.
 */

const fs = require("node:fs");
const {execFileSync} = require("node:child_process");

/** Lines found and hit per source file, from an LCOV report. */
function parseLcov(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      current = {found: 0, hit: 0};
      files.set(line.slice(3).trim(), current);
    } else if (line.startsWith("DA:") && current) {
      const [, hits] = line.slice(3).split(",");
      current.found += 1;
      if (Number(hits) > 0) current.hit += 1;
    } else if (line.startsWith("end_of_record")) {
      current = null;
    }
  }
  return files;
}

const COMMENT = /\/\/.*?$|\/\*[\s\S]*?\*\//gm;
const STRING = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const TOP_LEVEL_TYPE = /\b(contract|interface|library)\s+[A-Za-z_][A-Za-z0-9_]*/g;
const EXECUTABLE_MEMBER = /\b(function|constructor|fallback|receive|modifier)\b[^;{]*\{/;

/** Whether a source declares nothing that runs, so has nothing to cover. */
function isDeclarationOnly(text) {
  const source = text.replace(COMMENT, "").replace(STRING, "");
  const kinds = [...source.matchAll(TOP_LEVEL_TYPE)].map((m) => m[1]);
  if (kinds.length > 0 && kinds.every((kind) => kind === "interface")) return true;
  return !EXECUTABLE_MEMBER.test(source);
}

/**
 * Each changed contract with its coverage, and whether it falls short.
 * `read` gives a file's source, for one the report does not name.
 */
function assess(changed, coverage, threshold, read) {
  return changed
    .filter((file) => file.startsWith("contracts/") && file.endsWith(".sol"))
    .map((file) => {
      const lines = coverage.get(file);
      if (!lines) {
        if (isDeclarationOnly(read(file))) return {file, percent: null, failed: false};
        return {file, percent: 0, failed: true, missing: true};
      }
      const percent = lines.found === 0 ? 100 : (100 * lines.hit) / lines.found;
      return {file, percent, failed: percent < threshold};
    });
}

function changedSince(base) {
  // Relative to contracts/, as the LCOV report names them; deleted files are
  // not there to cover.
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--relative", "--diff-filter=d", `${base}...HEAD`, "--", "contracts"],
    {encoding: "utf8"},
  );
  return out.split("\n").filter(Boolean);
}

function table(results, threshold) {
  const rows = results.map(({file, percent, failed, missing}) => {
    const value =
      percent === null ? "declarations only" : missing ? "not in the report (0 %)" : `${percent.toFixed(2)} %`;
    return `| ${file} | ${value} | ${failed ? "below" : "ok"} |`;
  });
  return [
    `Line coverage of the changed contracts (threshold ${threshold} %)`,
    "",
    "| File | Lines | |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}

function main(argv) {
  const option = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1 || !argv[i + 1]) throw new Error(`--${name} is required`);
    return argv[i + 1];
  };
  const threshold = Number(option("threshold"));
  const coverage = parseLcov(fs.readFileSync(option("lcov"), "utf8"));
  const read = (file) => fs.readFileSync(file, "utf8");
  const results = assess(changedSince(option("base")), coverage, threshold, read);

  if (results.length === 0) {
    console.log("No contract changed; nothing to check.");
    return 0;
  }
  const report = table(results, threshold);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  return results.some((r) => r.failed) ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = {parseLcov, assess, isDeclarationOnly};
