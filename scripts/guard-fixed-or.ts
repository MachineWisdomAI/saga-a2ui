import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { isAuthoredTypeScript, repositoryRoot, walkFiles } from './authored-tree.js';

// Narrow check, not truthiness analysis. Flag `||` only when the left operand,
// after unwrapping parentheses and zero-argument `.trim()` calls, is a string
// or template that contains fixed non-whitespace text. Identifiers, interpolations,
// whitespace-only fixed text, concatenation, other operators, and other methods
// are outside this check. See README.md.

type Finding = { file: string; line: number };

function zeroArgTrimReceiver(node: ts.CallExpression): ts.Expression | undefined {
  if (node.arguments.length !== 0) return undefined;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text !== 'trim') return undefined;
  return callee.expression;
}

function fixedText(expression: ts.Expression): string | undefined {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      const receiver = zeroArgTrimReceiver(current);
      if (!receiver) return undefined;
      current = receiver;
      continue;
    }
    break;
  }
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }
  if (ts.isTemplateExpression(current)) {
    const parts = [current.head.text];
    for (const span of current.templateSpans) parts.push(span.literal.text);
    return parts.join('');
  }
  return undefined;
}

function leftHasFixedNonWhitespace(expression: ts.Expression): boolean {
  const text = fixedText(expression);
  if (text === undefined) return false;
  return /\S/.test(text);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function scanSource(file: string, text: string): Finding[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const findings: Finding[] = [];
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      if (leftHasFixedNonWhitespace(node.left)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({ file, line: position.line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

function scanFile(file: string): Finding[] {
  return scanSource(file, fs.readFileSync(file, 'utf8'));
}

function filesToScan(args: string[], cwd: string): string[] {
  let root = repositoryRoot(cwd);
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      const value = args[index + 1];
      if (!value) throw new Error('--root requires a directory');
      root = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    positionals.push(path.resolve(arg));
  }
  if (positionals.length === 0) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`not a directory: ${root}`);
    }
    return walkFiles(root, isAuthoredTypeScript);
  }
  const files: string[] = [];
  for (const target of positionals) {
    if (!fs.existsSync(target)) throw new Error(`not found: ${target}`);
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      files.push(...walkFiles(target, isAuthoredTypeScript));
      continue;
    }
    if (!isAuthoredTypeScript(path.basename(target))) {
      throw new Error(`not an authored TypeScript file: ${target}`);
    }
    files.push(target);
  }
  return files;
}

function main(): number {
  let files: string[];
  try {
    files = filesToScan(process.argv.slice(2), process.cwd());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 2;
  }
  const findings = files.flatMap(scanFile);
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line}: left operand of || necessarily contains fixed non-whitespace text`);
  }
  return findings.length === 0 ? 0 : 1;
}

process.exit(main());
