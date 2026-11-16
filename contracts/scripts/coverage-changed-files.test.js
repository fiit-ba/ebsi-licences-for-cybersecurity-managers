// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
// node --test scripts/coverage-changed-files.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const {parseLcov, assess, isDeclarationOnly} = require("./coverage-changed-files");

const LCOV = [
  "TN:",
  "SF:contracts/A.sol",
  "DA:1,3",
  "DA:2,0",
  "DA:3,1",
  "DA:4,1",
  "end_of_record",
  "SF:contracts/B.sol",
  "DA:1,1",
  "end_of_record",
  "",
].join("\n");

/** For calls that must not need a file's source. */
const unread = (file) => {
  throw new Error(`read ${file}`);
};

test("counts the lines found and hit per file", () => {
  const files = parseLcov(LCOV);
  assert.deepEqual(files.get("contracts/A.sol"), {found: 4, hit: 3});
  assert.deepEqual(files.get("contracts/B.sol"), {found: 1, hit: 1});
});

test("fails a changed contract below the threshold, and only that one", () => {
  const results = assess(["contracts/A.sol", "contracts/B.sol"], parseLcov(LCOV), 90, unread);
  assert.deepEqual(
    results.map(({file, failed}) => [file, failed]),
    [
      ["contracts/A.sol", true],
      ["contracts/B.sol", false],
    ],
  );
  assert.equal(results[0].percent, 75);
});

test("ignores tests, scripts and the mocks", () => {
  const changed = ["test/X.t.sol", "scripts/Deploy.s.sol", "local/ebsi-mock/Y.sol"];
  assert.deepEqual(assess(changed, parseLcov(LCOV), 90, unread), []);
});

test("passes a file the report does not name only if nothing in it runs", () => {
  const sources = {
    "contracts/interfaces/I.sol": "interface I { function f() external; }",
    "contracts/Types.sol": "library T { struct S { uint256 a; } } // function g() { }",
    "contracts/New.sol": "contract N { function f() external { } }",
  };
  const results = assess(Object.keys(sources), new Map(), 90, (file) => sources[file]);
  assert.deepEqual(
    results.map(({file, failed}) => [file, failed]),
    [
      ["contracts/interfaces/I.sol", false],
      ["contracts/Types.sol", false],
      ["contracts/New.sol", true],
    ],
  );
});

test("a file the report names without executable lines passes", () => {
  const lcov = "SF:contracts/C.sol\nend_of_record\n";
  assert.deepEqual(assess(["contracts/C.sol"], parseLcov(lcov), 90, unread), [
    {file: "contracts/C.sol", percent: 100, failed: false},
  ]);
});

test("strings and comments do not count as code", () => {
  assert.equal(isDeclarationOnly('library L { string constant X = "function f() {"; }'), true);
  assert.equal(isDeclarationOnly("library L { function f() internal pure { } }"), false);
});
