// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * The governance contract's vocabulary, for the back-office's server and its
 * console, through export-abi.js.
 *
 * The enums are read from the contract's source - every file of it, the
 * interface included - so they cannot drift from it. The roles are not in the contract, which knows only role numbers 1..8:
 * the mapping of the pilot's organisational roles (component 10.2) to them
 * lives here, once.
 */

const fs = require("node:fs");
const path = require("node:path");

const SOURCES = path.resolve(__dirname, "../contracts");

/** Every Solidity file of the contract - its interface and parts included - as one text. */
function readSource(dir = SOURCES) {
  return fs
    .readdirSync(dir, {withFileTypes: true, recursive: true})
    .filter(entry => entry.isFile() && entry.name.endsWith(".sol"))
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort()
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");
}

/** The organisational roles of component 10.2, as the contract numbers them. */
const ROLES = {
  A: 1, // the certification body's decision maker
  B: 2, // its independent second approver
  C: 3, // the supervisory authority (NBÚ), external to the body
};

/** Every `enum Name { A, B }` in the contract, as {Name: ['a', 'b']}. */
function readEnums(source = readSource()) {
  const enums = {};
  for (const match of source.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
    if (enums[match[1]]) throw new Error(`enum ${match[1]} is declared twice`);
    enums[match[1]] = match[2]
      .split(",")
      .map(name => name.replace(/\/\/.*$/gm, "").trim())
      .filter(Boolean)
      .map(name => name.toLowerCase());
  }
  return enums;
}

const ENUMS = readEnums();

const UNITS = {seconds: 1, minutes: 60, hours: 3600, days: 86400, weeks: 604800};

/**
 * Every `uintN public constant NAME = value [unit];` in the contract, as
 * {NAME: number}, units resolved - the bounds a caller checks its own
 * settings against (MAX_TIMELOCK, MAX_PROPOSAL_TTL, MAX_ROLE). Read the same
 * way as the enums above, so they cannot drift from the source either.
 */
function readLimits(source = readSource()) {
  const limits = {};
  for (const match of source.matchAll(/uint\d+\s+public\s+constant\s+(\w+)\s*=\s*(\d+)\s*(\w+)?\s*;/g)) {
    const unit = match[3] ? UNITS[match[3]] : 1;
    if (unit === undefined) throw new Error(`${match[1]}: unknown unit ${match[3]}`);
    limits[match[1]] = Number(match[2]) * unit;
  }
  return limits;
}

const LIMITS = readLimits();

module.exports = {ROLES, ENUMS, LIMITS, SOURCES, readSource, readEnums, readLimits};
