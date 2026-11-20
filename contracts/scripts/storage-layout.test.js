// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * The rules of scripts/storage-layout.js, on small layouts of the compiler's
 * shape: what an upgrade can read, and what it cannot.
 *
 *   node --test scripts/storage-layout.test.js
 */

const test = require("node:test");
const assert = require("node:assert");
const {compare} = require("./storage-layout");

const word = (bytes = 32) => ({bytes, encoding: "inplace"});
const field = (name, slot, offset, type) => ({name, slot, offset, type});

/** A namespace holding a mapping of `Item`s and an array of `Element`s. */
function layout({item, element}) {
  return {
    namespaces: {ns: "struct Root"},
    types: {
      uint64: word(8),
      uint256: word(32),
      "struct Root": {
        ...word(64),
        members: [field("items", 0, 0, "mapping(uint256 => struct Item)"), field("elements", 1, 0, "struct Element[]")],
      },
      "mapping(uint256 => struct Item)": {bytes: 32, encoding: "mapping", key: "uint256", value: "struct Item"},
      "struct Element[]": {bytes: 32, encoding: "dynamic_array", base: "struct Element"},
      "struct Item": {...word(32 * Math.ceil(item.length / 4)), members: item},
      "struct Element": {...word(32 * Math.ceil(element.length / 4)), members: element},
    },
  };
}

const base = layout({
  item: [field("a", 0, 0, "uint64"), field("b", 0, 8, "uint64")],
  element: [field("x", 0, 0, "uint64")],
});

test("the same layout is readable", () => {
  assert.deepStrictEqual(compare(base, base), []);
});

test("a field added at the end of a mapping's value is readable, past its slot too", () => {
  const next = layout({
    item: [
      field("a", 0, 0, "uint64"),
      field("b", 0, 8, "uint64"),
      field("c", 0, 16, "uint64"),
      field("d", 0, 24, "uint64"),
      field("e", 1, 0, "uint64"),
    ],
    element: [field("x", 0, 0, "uint64")],
  });
  assert.deepStrictEqual(compare(base, next), []);
});

test("a field inserted before another moves it", () => {
  const next = layout({
    item: [field("a", 0, 0, "uint64"), field("new", 0, 8, "uint64"), field("b", 0, 16, "uint64")],
    element: [field("x", 0, 0, "uint64")],
  });
  assert.match(compare(base, next).join("\n"), /field 1 was b/);
});

test("a retyped or removed field is refused", () => {
  const retyped = layout({
    item: [field("a", 0, 0, "uint256"), field("b", 1, 0, "uint64")],
    element: [field("x", 0, 0, "uint64")],
  });
  assert.ok(compare(base, retyped).length > 0);
  const removed = layout({item: [field("a", 0, 0, "uint64")], element: [field("x", 0, 0, "uint64")]});
  assert.match(compare(base, removed).join("\n"), /field b was removed/);
});

test("an array's element may fill its slot, but not grow past it", () => {
  const filled = layout({
    item: base.types["struct Item"].members,
    element: [field("x", 0, 0, "uint64"), field("y", 0, 8, "uint64")],
  });
  assert.deepStrictEqual(compare(base, filled), []);
  const grown = layout({
    item: base.types["struct Item"].members,
    element: [field("x", 0, 0, "uint64"), field("y", 0, 8, "uint64"), field("z", 0, 16, "uint64"), field("w", 0, 24, "uint64"), field("v", 1, 0, "uint64")],
  });
  assert.match(compare(base, grown).join("\n"), /struct Element: grew from 32 to 64 bytes/);
});

test("a namespace that holds another struct is refused", () => {
  const moved = {...base, namespaces: {ns: "struct Other"}};
  assert.match(compare(base, moved).join("\n"), /namespace ns/);
});
