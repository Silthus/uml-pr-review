// PROTOTYPE - throwaway. The shapes lonir#4819 does not happen to contain.
//
// The pull request the prototype measures uses plain `it` and `describe` only.
// These cases pin down what the extractor does with `it.each`, `test.only`,
// `test.skip`, `it.todo` and a non-literal title, so the answer on issue #13
// rests on evidence and not on a claim.
//
// Run with:  bun test prototype/analyzer/test-shapes.test.ts

import { expect, test } from "bun:test";
import ts from "typescript";
import { listSymbols } from "./extract-tsc.ts";

/** Parse one snippet as a test file and return its symbols as `kind id`. */
function symbolsOf(source: string, path = "a.test.ts"): string[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  return listSymbols(ts, sf, path).map((d) => `${d.kind} ${d.id}`);
}

test("a describe block prefixes the title but is not a symbol of its own", () => {
  expect(
    symbolsOf(`
      describe('outer', () => {
        describe('inner', () => {
          it('does the thing', () => { work() })
        })
      })
    `),
  ).toEqual(["test a.test.ts#test:outer > inner > does the thing"]);
});

test("only, skip, concurrent and failing keep the id of the plain test", () => {
  const plain = symbolsOf(`it('same title', () => {})`);
  for (const modifier of ["only", "skip", "concurrent", "failing"]) {
    expect(symbolsOf(`it.${modifier}('same title', () => {})`)).toEqual(plain);
  }
  expect(symbolsOf(`test.only('same title', () => {})`)).toEqual(plain);
});

test("it.each is one symbol for the whole block, titled by the template", () => {
  expect(
    symbolsOf(`
      it.each([[1, 2], [3, 4]])('adds $a and $b', (a, b) => { add(a, b) })
    `),
  ).toEqual(["test a.test.ts#test:adds $a and $b"]);
});

test("a tagged-template each table is one symbol too", () => {
  expect(
    symbolsOf(
      "it.each`a|b\\n${1}|${2}`('adds $a and $b', ({ a, b }) => { add(a, b) })",
    ),
  ).toEqual(["test a.test.ts#test:adds $a and $b"]);
});

test("a template-literal title keeps its substitution in the id", () => {
  expect(symbolsOf("it(`renders in ${mode} mode`, () => {})")).toEqual([
    "test a.test.ts#test:renders in ${mode} mode",
  ]);
});

test("a non-literal title falls back to the source text of the expression", () => {
  expect(symbolsOf(`it(CASE_TITLE, () => {})`)).toEqual([
    "test a.test.ts#test:CASE_TITLE",
  ]);
});

test("a test with no body is not a symbol, because it can call nothing", () => {
  expect(symbolsOf(`it.todo('later')`)).toEqual([]);
  expect(symbolsOf(`it('pending')`)).toEqual([]);
});

test("two tests with the same title path get distinct ids", () => {
  expect(
    symbolsOf(`
      it('same', () => {})
      it('same', () => {})
    `),
  ).toEqual(["test a.test.ts#test:same", "test a.test.ts#test:same #2"]);
});

test("hooks are symbols, named by the hook and prefixed by the describe", () => {
  expect(
    symbolsOf(`
      describe('outer', () => {
        beforeEach(() => { seed() })
        afterAll(() => { clean() })
      })
    `),
  ).toEqual([
    "hook a.test.ts#hook:outer > beforeEach",
    "hook a.test.ts#hook:outer > afterAll",
  ]);
});

test("a helper declared inside a test nests under the test id", () => {
  expect(
    symbolsOf(`
      it('uses a helper', () => {
        const build = () => ({})
        build()
      })
    `),
  ).toEqual([
    "test a.test.ts#test:uses a helper",
    "arrow a.test.ts#test:uses a helper.build",
  ]);
});

test("a production file gets no test symbols even if it calls describe", () => {
  expect(symbolsOf(`describe('x', () => { it('y', () => {}) })`, "a.ts")).toEqual(
    [],
  );
});

test("an unknown member stops the match, so foo.describe is not a suite", () => {
  expect(symbolsOf(`foo.describe('x', () => { it('y', () => {}) })`)).toEqual([
    "test a.test.ts#test:y",
  ]);
});
