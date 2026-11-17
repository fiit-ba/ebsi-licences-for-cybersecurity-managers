// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * Write the third-party component lists in sbom/: for each part of the
 * repository a CycloneDX 1.6 SBOM (<part>.cdx.json) and the same list as
 * Markdown (<part>.md), and the summary in sbom/README.md between its
 * generated markers.
 *
 * What it reads, all of it in the repository or the installed dependencies
 * (it never goes to the network):
 *   - the npm lockfiles of back-office/, contracts/ and infra/ebsi-mock/:
 *     names, versions, hashes, licences and which packages are development-only;
 *   - holder-wallet/yarn.lock, with licences from the installed node_modules/;
 *   - holder-wallet/ios/Podfile.lock, with licences from the podspecs in node_modules/;
 *   - contracts/soldeer.lock;
 *   - sbom/components.json: what no lockfile records, and the licences that
 *     no package states in SPDX form.
 *
 * A published package's licence is fixed by its name and version, so a licence
 * that cannot be read this time (a package not installed on this platform, or
 * no node_modules/ at all) is taken from the previous SBOM. That lets --check
 * run on a fresh checkout.
 *
 * Usage:
 *   node sbom/generate.mjs            # write
 *   node sbom/generate.mjs --check    # compare only; exit 1 if anything would change
 *
 * Both fail when a component has no licence, or when the evidence of a listed
 * component in sbom/components.json no longer holds.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

/** The repository's root: every path below is relative to it. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "sbom";
const CHECK = process.argv.includes("--check");

const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = rel => fs.existsSync(path.join(ROOT, rel));
const readJson = rel => JSON.parse(read(rel));

const CURATED = readJson(`${OUT}/components.json`);

/** The parts of the repository, each with its own list. */
const PARTS = [
  {
    id: "back-office",
    title: "Back Office",
    dir: "back-office",
    sources: [{kind: "npm", dir: "back-office"}],
  },
  {
    id: "contracts",
    title: "Contracts",
    dir: "contracts",
    sources: [
      {kind: "npm", dir: "contracts"},
      {kind: "soldeer", file: "contracts/soldeer.lock"},
    ],
  },
  {
    id: "holder-wallet",
    title: "Atest Wallet",
    dir: "holder-wallet",
    sources: [
      {kind: "yarn", dir: "holder-wallet"},
      {kind: "cocoapods", file: "holder-wallet/ios/Podfile.lock"},
    ],
  },
  {
    id: "infra",
    title: "Infrastructure",
    dir: "infra",
    sources: [
      {
        kind: "npm",
        dir: "infra/ebsi-mock",
        use: "development",
        note: "The development EBSI service runs only in the development stack (the hosted installation uses EBSI itself), so all of its packages are development components.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Licences

/** SPDX identifiers the dependencies use. An identifier missing here is shown as a licence name, not an SPDX id. */
const SPDX_IDS = new Set([
  "0BSD", "AFL-2.1", "Apache-2.0", "Artistic-2.0", "BlueOak-1.0.0", "BSD-2-Clause",
  "BSD-3-Clause", "BSL-1.0", "CC-BY-3.0", "CC-BY-4.0", "CC0-1.0", "EUPL-1.2",
  "GPL-2.0-only", "GPL-3.0-only", "ISC", "LGPL-2.1-only", "LGPL-3.0-only", "MIT", "MIT-0",
  "MPL-2.0", "OFL-1.1", "PostgreSQL", "Python-2.0", "SSPL-1.0", "Unlicense", "WTFPL", "Zlib",
]);

/** Licences that ask no more than keeping their notice. An expression is permissive when one of its alternatives is. */
const PERMISSIVE = new Set([
  "0BSD", "AFL-2.1", "Apache-2.0", "BlueOak-1.0.0", "BSD-2-Clause", "BSD-3-Clause",
  "BSL-1.0", "CC0-1.0", "ISC", "LicenseRef-Public-Domain", "MIT", "MIT-0",
  "PostgreSQL", "Python-2.0", "Unlicense", "WTFPL", "Zlib",
]);

/** Non-SPDX spellings in package metadata that unambiguously mean one SPDX licence. */
const ALIASES = new Map([
  ["Apache 2.0", "Apache-2.0"],
  ["Apache License, Version 2.0", "Apache-2.0"],
  ["Apache License 2.0", "Apache-2.0"],
  ["Apache-2", "Apache-2.0"],
  ["Boost Software License", "BSL-1.0"],
  ["MIT License", "MIT"],
  ["MIT license", "MIT"],
  ["Public Domain", "LicenseRef-Public-Domain"],
]);

/** SPDX's deprecated ids for the GPL family, which mean the version alone, without "or later". */
const DEPRECATED_IDS = new Map([
  ["GPL-2.0", "GPL-2.0-only"],
  ["GPL-3.0", "GPL-3.0-only"],
  ["LGPL-2.1", "LGPL-2.1-only"],
  ["LGPL-3.0", "LGPL-3.0-only"],
]);

const OPERATORS = new Set(["AND", "OR", "WITH"]);

/** The licence tokens of an expression, without operators and parentheses. */
const tokens = expression =>
  expression.replace(/[()]/g, " ").split(/\s+/).filter(t => t && !OPERATORS.has(t));

const isSpdxToken = t => SPDX_IDS.has(t) || t.startsWith("LicenseRef-");
const isSpdx = expression => tokens(expression).every(isSpdxToken);

/**
 * One licence string as SPDX where it can be read as SPDX: aliases resolved,
 * operators in capitals, deprecated ids replaced, and the outer parentheses
 * npm writes around compound expressions removed. Anything else is kept as written.
 */
function normalize(value) {
  let s = String(value).trim();
  if (ALIASES.has(s)) return ALIASES.get(s);
  while (/^\(.*\)$/.test(s) && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
  const spdx = s
    .replace(/\s+(and|or|with)\s+/gi, (_, op) => ` ${op.toUpperCase()} `)
    .replace(/[^\s()]+/g, t => DEPRECATED_IDS.get(t) ?? t);
  return isSpdx(spdx) ? spdx : s;
}

function balanced(s) {
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/** The licence a package.json declares, from "license" or the deprecated "licenses". */
function packageJsonLicense(pkg) {
  const one = l => (typeof l === "string" ? l : l?.type);
  if (pkg.license) return one(pkg.license) ? normalize(one(pkg.license)) : undefined;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    const all = pkg.licenses.map(one).filter(Boolean).map(normalize);
    return all.length > 1 ? all.join(" OR ") : all[0];
  }
  return undefined;
}

/**
 * Whether an expression asks only for its notice: AND binds tighter than OR,
 * an OR is permissive when one side is, an AND when both are.
 */
function permissive(expression) {
  const list = expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
  let i = 0;
  const or = () => {
    let v = and();
    while (list[i] === "OR") { i++; v = and() || v; }
    return v;
  };
  const and = () => {
    let v = atom();
    while (list[i] === "AND") { i++; v = atom() && v; }
    return v;
  };
  const atom = () => {
    if (list[i] === "(") { i++; const v = or(); i++; return v; }
    const id = list[i++];
    if (list[i] === "WITH") i += 2;
    return PERMISSIVE.has(id);
  };
  return or();
}

/** A licence as CycloneDX records it: an SPDX id, an SPDX expression, or a name. */
function cdxLicenses(expression) {
  if (SPDX_IDS.has(expression)) return [{license: {id: expression}}];
  if (isSpdx(expression)) return [{expression}];
  return [{license: {name: expression}}];
}

function licenseOf(cdxLicensesList) {
  const l = cdxLicensesList?.[0];
  return l?.expression ?? l?.license?.id ?? l?.license?.name;
}

// ---------------------------------------------------------------------------
// Components

/**
 * One component, whatever it came from.
 * @typedef {{
 *   ecosystem: string, type: string, name: string, group?: string, version: string,
 *   license?: string, use: "production" | "development", optional?: boolean,
 *   purl?: string, url?: string, hashes?: {alg: string, content: string}[],
 *   providedBy?: string, category?: string, location?: string, supplier?: string, note?: string,
 * }} Component
 */

const npmPurl = (name, version) => {
  const [group, base] = name.startsWith("@") ? name.split("/") : [undefined, name];
  return `pkg:npm/${group ? `${encodeURIComponent(group)}/` : ""}${base}@${encodeURIComponent(version)}`;
};

/** npm's integrity strings ("sha512-<base64>") as CycloneDX hashes. */
function hashes(integrity) {
  if (!integrity) return undefined;
  const algs = {sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512"};
  const out = integrity.split(/\s+/).map(entry => {
    const [alg, b64] = [entry.slice(0, entry.indexOf("-")), entry.slice(entry.indexOf("-") + 1)];
    return algs[alg] && {alg: algs[alg], content: Buffer.from(b64, "base64").toString("hex")};
  }).filter(Boolean);
  return out.length ? out : undefined;
}

/** Keep one component per identity; a package is production if any copy of it is, optional only if every copy is. */
function dedupe(components) {
  const byKey = new Map();
  for (const c of components) {
    const key = c.purl ?? `${c.ecosystem}:${c.name}@${c.version}`;
    const seen = byKey.get(key);
    if (!seen) { byKey.set(key, {...c}); continue; }
    if (c.use === "production") seen.use = "production";
    seen.optional = seen.optional && c.optional;
    seen.license ??= c.license;
  }
  return [...byKey.values()];
}

/** Every package.json under a node_modules/ tree, as "name@version" -> package.json. */
function installedPackages(dir) {
  const found = new Map();
  const walk = nm => {
    if (!exists(nm)) return;
    for (const entry of fs.readdirSync(path.join(ROOT, nm), {withFileTypes: true})) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("@")) {
        for (const scoped of fs.readdirSync(path.join(ROOT, nm, entry.name), {withFileTypes: true})) {
          if (scoped.isDirectory()) visit(`${nm}/${entry.name}/${scoped.name}`);
        }
      } else visit(`${nm}/${entry.name}`);
    }
  };
  const visit = pkgDir => {
    const file = `${pkgDir}/package.json`;
    if (exists(file)) {
      try {
        const pkg = readJson(file);
        if (pkg.name && pkg.version) found.set(`${pkg.name}@${pkg.version}`, pkg);
      } catch { /* a fixture or a broken package.json is not a dependency's */ }
    }
    walk(`${pkgDir}/node_modules`);
  };
  walk(`${dir}/node_modules`);
  return found;
}

/** npm's package-lock.json (v2 or v3). */
function fromNpm(dir) {
  const lockFile = `${dir}/package-lock.json`;
  const lock = readJson(lockFile);
  const components = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "" || entry.link) continue;
    const name = entry.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    let license = entry.license ? normalize(entry.license) : undefined;
    if (!license && exists(`${dir}/${key}/package.json`)) license = packageJsonLicense(readJson(`${dir}/${key}/package.json`));
    components.push({
      ecosystem: "npm",
      type: "library",
      name,
      version: entry.version,
      license,
      use: entry.dev ? "development" : "production",
      optional: Boolean(entry.optional),
      purl: npmPurl(name, entry.version),
      url: entry.resolved,
      hashes: hashes(entry.integrity),
    });
  }
  return {source: lockFile, components: dedupe(components)};
}

/** Yarn 1's yarn.lock: blocks keyed by every "name@range" that resolved to them. */
function parseYarnLock(text) {
  const entries = [];
  let current;
  let inDeps = false;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      const specifiers = line.replace(/:$/, "").split(", ").map(s => s.replace(/^"|"$/g, ""));
      current = {specifiers, dependencies: []};
      entries.push(current);
      inDeps = false;
      continue;
    }
    const m = line.match(/^ {2}(\S+)(?: (.*))?$/);
    if (m) {
      inDeps = m[1] === "dependencies:" || m[1] === "optionalDependencies:";
      if (!inDeps && m[2] !== undefined) current[m[1]] = m[2].replace(/^"|"$/g, "");
      continue;
    }
    const dep = line.match(/^ {4}("?)(.+?)\1 "?(.+?)"?$/);
    if (dep && inDeps) current.dependencies.push(`${dep[2]}@${dep[3]}`);
  }
  return entries;
}

/** The package name of a yarn specifier: "name@range", "@scope/name@range", or an alias "x@npm:name@range". */
function specifierName(specifier) {
  const at = specifier.indexOf("@", 1);
  const range = specifier.slice(at + 1);
  if (range.startsWith("npm:")) return specifierName(range.slice(4));
  return specifier.slice(0, at);
}

function fromYarn(dir) {
  const lockFile = `${dir}/yarn.lock`;
  const pkg = readJson(`${dir}/package.json`);
  const entries = parseYarnLock(read(lockFile));
  const bySpecifier = new Map();
  for (const e of entries) for (const s of e.specifiers) bySpecifier.set(s, e);

  // A resolution in package.json can leave a dependency's own range out of the lockfile.
  const byName = new Map();
  for (const e of entries) {
    const name = specifierName(e.specifiers[0]);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(e);
  }
  const resolve = specifier => {
    if (bySpecifier.has(specifier)) return bySpecifier.get(specifier);
    const name = specifierName(specifier);
    const pinned = pkg.resolutions?.[name];
    const candidates = byName.get(name) ?? [];
    return candidates.find(e => e.version === pinned) ?? (candidates.length === 1 ? candidates[0] : undefined);
  };

  // Production: everything reachable from "dependencies"; the rest of the lockfile is development.
  const production = new Set();
  const unresolved = [];
  const queue = Object.entries({...pkg.dependencies, ...pkg.optionalDependencies}).map(([n, r]) => `${n}@${r}`);
  while (queue.length) {
    const specifier = queue.pop();
    const entry = resolve(specifier);
    if (!entry) { unresolved.push(specifier); continue; }
    if (production.has(entry)) continue;
    production.add(entry);
    queue.push(...entry.dependencies);
  }
  if (unresolved.length) warn(`${lockFile}: no lockfile entry for ${unresolved.join(", ")}`);

  const installed = installedPackages(dir);
  const components = entries.map(e => {
    const name = specifierName(e.specifiers[0].includes("@npm:") ? e.specifiers[0].slice(e.specifiers[0].indexOf("@npm:") + 5) : e.specifiers[0]);
    const pj = installed.get(`${name}@${e.version}`);
    return {
      ecosystem: "npm",
      type: "library",
      name,
      version: e.version,
      license: pj ? packageJsonLicense(pj) : undefined,
      use: production.has(e) ? "production" : "development",
      purl: npmPurl(name, e.version),
      url: e.resolved?.replace(/#.*$/, ""),
      hashes: hashes(e.integrity),
    };
  });
  return {source: lockFile, components: dedupe(components)};
}

/** The license line of a podspec, as text, an SPDX licence, or "package" when it reads package.json's. */
function podspecLicense(file) {
  const text = read(file);
  const line = text.match(/^\s*\w+\.license\s*=\s*(.+)$/m)?.[1];
  if (!line) return undefined;
  const typed = line.match(/:type\s*=>\s*['"]([^'"]+)['"]/) ?? line.match(/^['"]([^'"]+)['"]/);
  return typed ? normalize(typed[1]) : "package";
}

/** The npm package a node_modules/ path belongs to. */
function owningPackage(p) {
  const rest = p.slice(p.lastIndexOf("node_modules/") + "node_modules/".length).split("/");
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

function fromCocoaPods(lockFile) {
  const iosDir = path.posix.dirname(lockFile);
  const text = read(lockFile);
  const section = name => {
    const m = text.match(new RegExp(`^${name}:\\n((?:[ ].*\\n|\\n)*)`, "m"));
    return m ? m[1] : "";
  };
  const pods = new Map();
  for (const m of section("PODS").matchAll(/^ {2}- "?([^\s"/]+)(?:\/[^\s"]*)? \(([^)]+)\)/gm)) {
    pods.set(m[1], m[2]);
  }
  const external = new Map();
  for (const m of section("EXTERNAL SOURCES").matchAll(/^ {2}([^\s:]+):\n {4}:(path|podspec): "([^"]+)"/gm)) {
    external.set(m[1], {kind: m[2], path: path.posix.normalize(`${iosDir}/${m[3]}`)});
  }
  const installed = installedPackages(path.posix.dirname(iosDir));

  const components = [];
  for (const [name, version] of [...pods]) {
    const ext = external.get(name);
    let license;
    let providedBy;
    if (ext?.path.includes("node_modules/")) {
      providedBy = owningPackage(ext.path);
      let podspec;
      if (ext.kind === "podspec") podspec = ext.path;
      else if (exists(ext.path)) {
        const specs = fs.readdirSync(path.join(ROOT, ext.path)).filter(f => f.endsWith(".podspec"));
        podspec = specs.find(f => f === `${name}.podspec`) ?? (specs.length === 1 ? specs[0] : undefined);
        if (podspec) podspec = `${ext.path}/${podspec}`;
      }
      const fromSpec = podspec && exists(podspec) ? podspecLicense(podspec) : undefined;
      if (fromSpec === "package") {
        const owner = [...installed.values()].find(p => p.name === providedBy);
        license = owner && packageJsonLicense(owner);
      } else license = fromSpec;
    }
    license ??= CURATED.podLicenses[name]?.license;
    providedBy ??= CURATED.podLicenses[name]?.providedBy;
    components.push({
      ecosystem: "cocoapods",
      type: "library",
      name,
      version,
      license,
      use: "production",
      purl: `pkg:cocoapods/${name}@${encodeURIComponent(version)}`,
      providedBy,
    });
  }
  return {source: lockFile, components};
}

function fromSoldeer(lockFile) {
  const components = [];
  for (const block of read(lockFile).split("[[dependencies]]").slice(1)) {
    const field = k => block.match(new RegExp(`^${k} = "([^"]*)"`, "m"))?.[1];
    const name = field("name");
    const meta = CURATED.soldeer[name];
    if (!meta) fail(`${lockFile}: ${name} has no entry under "soldeer" in ${OUT}/components.json`);
    components.push({
      ecosystem: "soldeer",
      type: "library",
      name,
      version: field("version"),
      license: meta?.license,
      use: meta?.use ?? "development",
      purl: `pkg:generic/${encodeURIComponent(name)}@${field("version")}?download_url=${encodeURIComponent(field("url"))}`,
      url: meta?.source,
      hashes: [{alg: "SHA-256", content: field("checksum")}],
      note: meta?.note,
    });
  }
  return {source: lockFile, components};
}

/** The components sbom/components.json lists for a part, after checking their evidence. */
function curated(partId) {
  return (CURATED.parts[partId] ?? []).map(c => {
    const {file, contains} = c.evidence ?? {};
    if (file) {
      const optional = file.includes("/node_modules/");
      if (!exists(file)) {
        if (!optional) fail(`${OUT}/components.json: ${c.name} ${c.version}: ${file} does not exist`);
      } else if (contains && !read(file).includes(contains)) {
        fail(`${OUT}/components.json: ${c.name} ${c.version}: ${file} no longer contains ${JSON.stringify(contains)}`);
      }
    }
    return {ecosystem: "curated", ...c};
  });
}

// ---------------------------------------------------------------------------
// Output

const problems = [];
function fail(message) { problems.push(message); }
function warn(message) { console.warn(`warning: ${message}`); }

/** The licenceOverrides entry for a component: its exact key, or a key where * stands for any part of a name. */
function override(c) {
  const key = `${c.ecosystem}:${c.name}@${c.version}`;
  const overrides = CURATED.licenseOverrides;
  if (overrides[key]) return overrides[key];
  const pattern = Object.keys(overrides).find(k => k.includes("*") &&
    new RegExp(`^${k.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^@]*")}$`).test(key));
  return pattern && overrides[pattern];
}

/** Licences of the components in the previous SBOM, by purl. */
function previousLicenses(partId) {
  const file = `${OUT}/${partId}.cdx.json`;
  if (!exists(file)) return new Map();
  const bom = readJson(file);
  return new Map((bom.components ?? []).map(c => [c.purl ?? c["bom-ref"], licenseOf(c.licenses)]));
}

function collect(part) {
  const sources = part.sources.map(s => {
    switch (s.kind) {
      case "npm": return fromNpm(s.dir);
      case "yarn": return fromYarn(s.dir);
      case "cocoapods": return fromCocoaPods(s.file);
      case "soldeer": return fromSoldeer(s.file);
      default: throw new Error(`unknown source ${s.kind}`);
    }
  });
  const previous = previousLicenses(part.id);
  for (const [i, {source, components}] of sources.entries()) {
    for (const c of components) {
      if (part.sources[i].use) c.use = part.sources[i].use;
      const fixed = override(c);
      if (fixed) c.license = fixed.license;
      c.license ??= previous.get(c.purl);
      if (!c.license) {
        c.license = "NOASSERTION";
        fail(`${source}: ${c.name}@${c.version} has no licence; install the dependencies or add it to licenseOverrides in ${OUT}/components.json`);
      }
    }
  }
  return {
    sources: sources.map(s => s.source),
    lockfiles: sources,
    curated: curated(part.id),
  };
}

const sortKey = c => `${c.ecosystem}\u0000${c.group ?? ""}${c.name}\u0000${c.version}`;
const byKey = (a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0);

function cdxComponent(c) {
  const [group, name] = c.ecosystem === "npm" && c.name.startsWith("@") ? c.name.split("/") : [undefined, c.name];
  const properties = [{name: "atest:use", value: c.use}];
  if (c.optional) properties.push({name: "atest:optional", value: "true"});
  if (c.providedBy) properties.push({name: "atest:provided-by", value: c.providedBy});
  if (c.location) properties.push({name: "atest:location", value: c.location});
  if (c.category) properties.push({name: "atest:category", value: c.category});
  if (c.note) properties.push({name: "atest:note", value: c.note});
  const ref = c.purl ?? `${c.ecosystem}:${c.name}@${c.version}`;
  return {
    type: c.type,
    "bom-ref": ref,
    ...(c.supplier && {supplier: {name: c.supplier}}),
    ...(group && {group}),
    name,
    ...(c.version && {version: c.version}),
    scope: c.use === "development" ? "excluded" : c.optional ? "optional" : "required",
    ...(c.hashes && {hashes: c.hashes}),
    licenses: cdxLicenses(c.license),
    ...(c.purl && {purl: c.purl}),
    ...(c.url && {externalReferences: [{type: /^https?:\/\/(registry|soldeer)/.test(c.url) ? "distribution" : "website", url: c.url}]}),
    properties,
  };
}

function cdxBom(part, all) {
  const own = exists(`${part.dir}/package.json`) ? readJson(`${part.dir}/package.json`) : {};
  return {
    $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      tools: {components: [{type: "application", name: "sbom/generate.mjs"}]},
      component: {
        type: "application",
        "bom-ref": `atest:${part.id}`,
        name: part.id,
        ...(own.version && {version: own.version}),
        licenses: [{license: {id: "MIT"}}],
      },
      properties: all.sources.map(s => ({name: "atest:source", value: s})),
    },
    components: [...all.lockfiles.flatMap(s => s.components), ...all.curated].sort(byKey).map(cdxComponent),
  };
}

const cell = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
/** A Markdown table; `align` has an "r" for each right-aligned column. */
const table = (head, rows, align = "") =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map((_, i) => (align[i] === "r" ? "---:" : "---")).join(" | ")} |`,
    ...rows.map(r => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");

function licenceCounts(components) {
  const counts = new Map();
  for (const c of components) {
    const row = counts.get(c.license) ?? {production: 0, development: 0};
    row[c.use]++;
    counts.set(c.license, row);
  }
  return [...counts].sort((a, b) => b[1].production + b[1].development - (a[1].production + a[1].development) || (a[0] < b[0] ? -1 : 1));
}

const SOURCE_TITLES = {npm: "npm packages", yarn: "npm packages", cocoapods: "CocoaPods", soldeer: "Soldeer (Solidity) dependencies"};

function markdown(part, all) {
  const components = [...all.lockfiles.flatMap(s => s.components), ...all.curated];
  const lines = [
    `# Third-party components: ${part.title}`,
    "",
    `<!-- Generated by sbom/generate.mjs from ${all.sources.join(", ")} and sbom/components.json. Do not edit; run node sbom/generate.mjs. -->`,
    "",
    `Every third-party component of \`${part.dir}/\` with its licence. The same list in`,
    `CycloneDX 1.6: [\`${part.id}.cdx.json\`](${part.id}.cdx.json). How it is made and what it`,
    "does not cover: [README.md](README.md).",
    "",
    "**Production** components are what a production install of the part contains: what its",
    "app, images or deployed contracts are built from, build tools included. **Development**",
    "components only build, test or run it locally.",
    "",
    "## Licences",
    "",
    table(["Licence", "Production", "Development"], licenceCounts(components).map(([l, n]) => [l, n.production, n.development]), "lrr"),
  ];
  const categories = [...new Set(all.curated.map(c => c.category))];
  for (const category of categories) {
    lines.push("", `## ${category}`, "", table(["Component", "Version", "Licence", "Use", "Where", "Notes"],
      all.curated.filter(c => c.category === category).sort(byKey).map(c => [c.name, c.version || "—", c.license, c.use, c.location, c.note])));
  }
  for (const [i, source] of all.lockfiles.entries()) {
    const kind = part.sources[i].kind;
    const rows = [...source.components].sort(byKey);
    lines.push("", `## ${SOURCE_TITLES[kind]} (\`${source.source}\`)`, "");
    if (part.sources[i].note) lines.push(part.sources[i].note, "");
    if (!rows.length) { lines.push("None."); continue; }
    if (kind === "cocoapods") {
      lines.push("Pods that come from an npm package are built from that package's native code.", "",
        table(["Pod", "Version", "Licence", "From npm package"], rows.map(c => [c.name, c.version, c.license, c.providedBy ?? "CocoaPods trunk"])));
    } else if (kind === "soldeer") {
      lines.push(table(["Library", "Version", "Licence", "Use", "Notes"], rows.map(c => [c.name, c.version, c.license, c.use, c.note])));
    } else {
      lines.push(table(["Package", "Version", "Licence", "Use"], rows.map(c => [c.name, c.version, c.license, c.use + (c.optional ? " (optional)" : "")])));
    }
  }
  return `${lines.join("\n")}\n`;
}

function summary(results) {
  const rows = results.map(({part, all}) => {
    const components = [...all.lockfiles.flatMap(s => s.components), ...all.curated];
    const production = components.filter(c => c.use === "production").length;
    return [`${part.title} (\`${part.dir}/\`)`, components.length, production, components.length - production, `[list](${part.id}.md), [CycloneDX](${part.id}.cdx.json)`];
  });
  const review = [];
  for (const {part, all} of results) {
    for (const c of [...all.lockfiles.flatMap(s => s.components), ...all.curated].sort(byKey)) {
      if (!permissive(c.license)) review.push([part.title, c.name, c.version || "—", c.license, c.use, c.note ?? CURATED.licenseNotes[c.license] ?? ""]);
    }
  }
  const tools = CURATED.tools.map(t => [t.url ? `[${t.name}](${t.url})` : t.name, t.version || "—", t.license, t.note]);
  return [
    table(["Part", "Components", "Production", "Development", "Lists"], rows, "lrrrl"),
    "",
    "### Components whose licence asks more than keeping a notice",
    "",
    "Every other component is under a permissive licence (MIT, ISC, BSD, Apache-2.0 and",
    "the like), or offers one as an alternative.",
    "",
    table(["Part", "Component", "Version", "Licence", "Use", "Notes"], review),
    "",
    "### Development tools outside the repository",
    "",
    "Not in the repository and not distributed with any part.",
    "",
    table(["Tool", "Version", "Licence", "Notes"], tools),
  ].join("\n");
}

const BEGIN = "<!-- BEGIN GENERATED: sbom/generate.mjs -->";
const END = "<!-- END GENERATED -->";

function main() {
  const results = PARTS.map(part => ({part, all: collect(part)}));
  const files = new Map();
  for (const {part, all} of results) {
    files.set(`${OUT}/${part.id}.cdx.json`, `${JSON.stringify(cdxBom(part, all), null, 2)}\n`);
    files.set(`${OUT}/${part.id}.md`, markdown(part, all));
  }
  const readme = read(`${OUT}/README.md`);
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) fail(`${OUT}/README.md has no ${BEGIN} ... ${END} block`);
  else files.set(`${OUT}/README.md`, `${readme.slice(0, start + BEGIN.length)}\n\n${summary(results)}\n\n${readme.slice(end)}`);

  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  const stale = [...files].filter(([file, content]) => !exists(file) || read(file) !== content).map(([file]) => file);
  if (CHECK) {
    if (stale.length) {
      console.error(`Out of date: ${stale.join(", ")}. Run node sbom/generate.mjs and commit the result.`);
      process.exit(1);
    }
    console.log("The third-party component lists are current.");
    return;
  }
  for (const file of stale) fs.writeFileSync(path.join(ROOT, file), files.get(file));
  console.log(stale.length ? `Wrote ${stale.join(", ")}.` : "Nothing changed.");
}

main();
