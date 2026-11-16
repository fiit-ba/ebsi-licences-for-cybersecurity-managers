import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A source convention failure reported with its owning file and location. */
interface Failure {
  file: string;
  line: number;
  message: string;
}

/**
 * Enumerate authored TypeScript without traversing dependencies or build outputs.
 *
 * @param directory - One source directory within the package.
 * @returns Absolute TypeScript and TSX paths, sorted for stable diagnostics.
 * @throws Filesystem errors if a source directory cannot be read.
 */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')
        ? [path]
        : [];
    }),
  );
  return groups.flat().sort();
}

/**
 * Identify functions whose implementation belongs to the documented surface.
 *
 * @param node - Parsed TypeScript node.
 * @returns Whether it is a type, named implementation, exported callable or service/class operation.
 */
function needsDocumentation(node: ts.Node): boolean {
  if (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  )
    return true;
  if (ts.isConstructorDeclaration(node) || ts.isMethodDeclaration(node)) return true;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    return Boolean(node.name);
  }
  if (
    ts.isVariableStatement(node) &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    return node.declarationList.declarations.some(
      (d) =>
        d.initializer &&
        (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)),
    );
  }
  return (
    ts.isPropertyAssignment(node) &&
    ts.isArrowFunction(node.initializer) &&
    Boolean(
      ts.getJSDocCommentsAndTags(node).length ||
      (ts.isBlock(node.initializer.body) && node.initializer.body.statements.length > 3),
    )
  );
}

/**
 * Resolve implemented callable parameters, excluding type-only member signatures.
 *
 * @param node - Documented declaration or callable variable/property.
 * @returns The implementation signature, or undefined for types and classes.
 */
function callable(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
    return node;
  if (ts.isPropertyAssignment(node) && ts.isArrowFunction(node.initializer))
    return node.initializer;
  if (ts.isVariableStatement(node)) {
    const initializer = node.declarationList.declarations[0]?.initializer;
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)))
      return initializer;
  }
  return undefined;
}

/**
 * Check documentation structure without claiming to validate its semantic accuracy.
 *
 * @param file - Absolute authored TypeScript path.
 * @returns Missing summaries, input descriptions and output descriptions.
 * @throws Filesystem errors if the source cannot be read.
 * @remarks Error behavior and documentation accuracy still require code review.
 */
async function inspect(file: string): Promise<Failure[]> {
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const failures: Failure[] = [];
  const report = (node: ts.Node, message: string) =>
    failures.push({
      file: relative(root, file),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message,
    });

  /**
   * Inspect one declaration and recursively visit its child syntax.
   *
   * @param node - Parsed source node within the current file.
   * @returns No return value; violations are appended to the owning diagnostics list.
   */
  function visit(node: ts.Node): void {
    if (needsDocumentation(node)) {
      const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
      const doc = docs.at(-1);
      if (!doc?.comment) report(node, 'Add a meaningful TSDoc summary.');
      const signature = callable(node);
      if (signature && doc) {
        const tags: readonly ts.JSDocTag[] = doc.tags ?? [];
        const parameters = tags.filter((tag): tag is ts.JSDocParameterTag =>
          ts.isJSDocParameterTag(tag),
        );
        for (const parameter of signature.parameters) {
          if (!ts.isIdentifier(parameter.name)) {
            report(
              parameter,
              'Name the parameter and destructure it inside the function for unambiguous @param tags.',
            );
            continue;
          }
          const name = parameter.name.text;
          if (!parameters.some((tag) => tag.name.getText(source) === name && tag.comment))
            report(parameter, `Describe @param ${name}.`);
        }
        for (const tag of parameters) {
          if (
            !signature.parameters.some(
              (p) => ts.isIdentifier(p.name) && p.name.text === tag.name.getText(source),
            )
          )
            report(tag, 'Remove or correct the unmatched @param tag.');
        }
        if (
          !ts.isConstructorDeclaration(node) &&
          !tags.some((tag) => ts.isJSDocReturnTag(tag) && tag.comment)
        )
          report(node, 'Describe @returns, including an intentionally absent value.');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

const directories = ['server', 'shared', 'web/src', 'scripts', 'data'];
const files = (
  await Promise.all(directories.map((directory) => sourceFiles(resolve(root, directory))))
).flat();
const failures = (await Promise.all(files.map(inspect))).flat();
for (const failure of failures)
  console.error(`${failure.file}:${failure.line}: ${failure.message}`);
if (failures.length) process.exitCode = 1;
else
  console.log(
    `TSDoc structure checked in ${files.length} TypeScript sources; semantic accuracy requires review.`,
  );
