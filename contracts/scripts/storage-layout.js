// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Keep the contracts' storage layout safe to upgrade.
 *
 * Both contracts sit behind beacon proxies, and each module keeps its state
 * in its own ERC-7201 namespace. A new implementation reads the proxy's
 * storage with its own layout, so a field that moves (inserted before
 * another, retyped, removed) reads another field's bytes, and no test of the
 * new version alone notices.
 *
 * `forge inspect` leaves namespaced storage out, so test/StorageLayouts.sol
 * holds each namespace as an ordinary state variable and the compiler reports
 * every field (foundry.toml's extra_output). This script keeps that layout in
 * test/storage-layout.json, and compares a build with it:
 *
 *   - every field keeps its name, slot, offset and type;
 *   - a struct may gain fields only at its end, and may grow past its last
 *     slot only where nothing follows it: a namespace itself, a mapping's
 *     value, or the last field of a struct that may grow. As an array's
 *     element it would move every element after the first.
 *
 * Usage:
 *   forge build && node scripts/storage-layout.js            # write
 *   node scripts/storage-layout.js --check                   # compare only
 *
 * Write it again when a layout change is intended and safe, and say why in
 * the commit.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACT = path.join(ROOT, "out/StorageLayouts.sol/StorageLayouts.json");
const SNAPSHOT = path.join(ROOT, "test/storage-layout.json");

/** The compiler's layout, by type label instead of by AST id. */
function current() {
  const {storageLayout} = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  if (!storageLayout) throw new Error(`${ARTIFACT} has no storageLayout: is extra_output set in foundry.toml?`);
  const label = (id) => storageLayout.types[id].label;
  const types = {};
  for (const [id, type] of Object.entries(storageLayout.types)) {
    const entry = {bytes: Number(type.numberOfBytes), encoding: type.encoding};
    if (type.members) {
      entry.members = type.members.map((m) => ({
        name: m.label,
        slot: Number(m.slot),
        offset: m.offset,
        type: label(m.type),
      }));
    }
    if (type.key) entry.key = label(type.key);
    if (type.value) entry.value = label(type.value);
    if (type.base) entry.base = label(type.base);
    types[type.label] = entry;
  }
  const namespaces = {};
  for (const variable of storageLayout.storage) namespaces[variable.label] = label(variable.type);
  return {namespaces, types: Object.fromEntries(Object.entries(types).sort(([a], [b]) => a.localeCompare(b)))};
}

/**
 * The structs that may grow past their last slot: used only as a namespace,
 * a mapping's value, or the last field of a struct that may grow.
 */
function growable(layout) {
  const structs = Object.keys(layout.types).filter((t) => layout.types[t].members);
  const uses = Object.fromEntries(structs.map((s) => [s, []]));
  for (const root of Object.values(layout.namespaces)) uses[root]?.push({kind: "namespace"});
  for (const [name, type] of Object.entries(layout.types)) {
    if (type.value && uses[type.value]) uses[type.value].push({kind: "mapping value"});
    if (type.base && uses[type.base]) uses[type.base].push({kind: "array element"});
    (type.members || []).forEach((m, i) => {
      if (uses[m.type]) uses[m.type].push({kind: "field", of: name, last: i === type.members.length - 1});
    });
  }
  const can = new Set(structs);
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of [...can]) {
      const ok = uses[s].every(
        (u) =>
          u.kind === "namespace" || u.kind === "mapping value" || (u.kind === "field" && u.last && can.has(u.of)),
      );
      if (!ok) {
        can.delete(s);
        changed = true;
      }
    }
  }
  return can;
}

/** What makes `next` unsafe to read storage written under `previous`. */
function compare(previous, next) {
  const problems = [];
  const grows = growable(next);
  for (const [variable, root] of Object.entries(previous.namespaces)) {
    if (next.namespaces[variable] !== root) problems.push(`namespace ${variable}: was ${root}, is ${next.namespaces[variable]}`);
  }
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const was = previous.types[name];
    const is = next.types[name];
    if (!is) return problems.push(`${name}: no longer in the layout`);
    for (const part of ["key", "value", "base"]) {
      if (was[part] !== is[part]) problems.push(`${name}: its ${part} was ${was[part]}, is ${is[part]}`);
      if (was[part]) visit(was[part]);
    }
    if (!was.members) {
      if (was.bytes !== is.bytes || was.encoding !== is.encoding) {
        problems.push(`${name}: was ${was.bytes} bytes (${was.encoding}), is ${is.bytes} (${is.encoding})`);
      }
      return;
    }
    was.members.forEach((m, i) => {
      const n = is.members[i];
      if (!n) return problems.push(`${name}: field ${m.name} was removed`);
      if (n.name !== m.name || n.slot !== m.slot || n.offset !== m.offset || n.type !== m.type) {
        problems.push(
          `${name}: field ${i} was ${m.name} (${m.type}) at slot ${m.slot} offset ${m.offset}, ` +
            `is ${n.name} (${n.type}) at slot ${n.slot} offset ${n.offset}`,
        );
      }
      visit(m.type);
    });
    if (is.bytes !== was.bytes && !grows.has(name)) {
      problems.push(`${name}: grew from ${was.bytes} to ${is.bytes} bytes where the value after it would move`);
    }
  };
  Object.values(previous.namespaces).forEach(visit);
  return problems;
}

function main() {
  const layout = current();
  if (!process.argv.includes("--check")) {
    if (fs.existsSync(SNAPSHOT)) {
      for (const p of compare(JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")), layout)) console.warn(`replacing: ${p}`);
    }
    const snapshot = {
      _notice:
        "The storage layout of each ERC-7201 namespace, as test/StorageLayouts.sol makes the compiler report it. " +
        "Written by scripts/storage-layout.js; `--check` refuses a build whose layout an upgrade could not read.",
      ...layout,
    };
    fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`wrote ${path.relative(ROOT, SNAPSHOT)}`);
    return;
  }
  const problems = compare(JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")), layout);
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`\nThe storage layout changed in a way an upgrade could not read (${problems.length}).`);
    process.exit(1);
  }
  console.log("The storage layout is one an upgrade can read.");
}

module.exports = {current, compare, growable};
if (require.main === module) main();
