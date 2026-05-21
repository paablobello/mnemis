import ts from 'typescript';
import type { IndexChunk, LoadedFile } from './types.ts';

const DEFAULT_CHUNK_MAX_CHARS = 4_000;
const DEFAULT_OVERLAP_LINES = 4;
const BRACE_LANGUAGES = new Set([
  'c',
  'cpp',
  'csharp',
  'go',
  'java',
  'javascript',
  'javascriptreact',
  'rust',
  'typescript',
  'typescriptreact',
]);
const TYPESCRIPT_AST_LANGUAGES = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);
const PYTHON_SYMBOL = /^(\s*)(async\s+def|def|class)\s+([A-Za-z_][\w]*)/;
const BRACE_SYMBOL =
  /^\s*(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function|class|interface|type|enum|struct|impl|trait)\s+([A-Za-z_][\w]*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][\w]*)\s*=>/;

interface ChunkOpts {
  chunkMaxChars?: number;
  chunkOverlapLines?: number;
}

interface LineSpan {
  lineStart: number;
  lineEnd: number;
  rawText: string;
  sectionPath: string[];
  metadata: Record<string, unknown>;
  chunkKey?: string;
  parentKey?: string | null;
}

function lineEndFor(lines: string[], start: number, endExclusive: number): number {
  return Math.max(start + 1, endExclusive);
}

function buildChunk(file: LoadedFile, span: LineSpan): IndexChunk {
  return {
    path: file.path,
    chunkKey: span.chunkKey,
    parentKey: span.parentKey,
    lineStart: span.lineStart,
    lineEnd: span.lineEnd,
    page: file.page ?? null,
    rawText: span.rawText,
    contextualPrefix: null,
    language: file.language,
    sectionPath: span.sectionPath,
    metadata: {
      byte_length: file.byteLength,
      modified_at: file.modifiedAt.toISOString(),
      ...(file.metadata ?? {}),
      ...span.metadata,
    },
  };
}

function chunkKeyFor(file: LoadedFile, span: LineSpan, role = 'chunk'): string {
  return `${file.path}:${span.lineStart}:${span.lineEnd}:${role}`;
}

function trimSpan(lines: string[], start: number, endExclusive: number): LineSpan | null {
  let s = start;
  let e = endExclusive;
  while (s < e && (lines[s] ?? '').trim() === '') s++;
  while (e > s && (lines[e - 1] ?? '').trim() === '') e--;
  if (s >= e) return null;

  return {
    lineStart: s + 1,
    lineEnd: lineEndFor(lines, s, e),
    rawText: lines.slice(s, e).join('\n').trim(),
    sectionPath: [],
    metadata: {},
  };
}

function splitLargeSpan(lines: string[], span: LineSpan, opts: Required<ChunkOpts>): LineSpan[] {
  if (span.rawText.length <= opts.chunkMaxChars) return [span];

  const startIdx = span.lineStart - 1;
  const endIdx = span.lineEnd;
  const out: LineSpan[] = [];
  let start = startIdx;

  while (start < endIdx) {
    let end = start;
    let chars = 0;
    while (end < endIdx) {
      const next = lines[end] ?? '';
      if (chars > 0 && chars + next.length + 1 > opts.chunkMaxChars) break;
      chars += next.length + 1;
      end++;
    }
    if (end === start) end++;

    const trimmed = trimSpan(lines, start, end);
    if (trimmed) {
      out.push({
        ...trimmed,
        sectionPath: span.sectionPath,
        metadata: {
          ...span.metadata,
          split_from_line_start: span.lineStart,
          split_from_line_end: span.lineEnd,
        },
      });
    }

    if (end >= endIdx) break;
    start = Math.max(end - opts.chunkOverlapLines, start + 1);
  }

  return out;
}

function splitLargeParentChild(
  file: LoadedFile,
  lines: string[],
  span: LineSpan,
  opts: Required<ChunkOpts>,
): IndexChunk[] {
  if (span.rawText.length <= opts.chunkMaxChars) {
    return [buildChunk(file, { ...span, chunkKey: chunkKeyFor(file, span) })];
  }

  const parentKey = chunkKeyFor(file, span, 'parent');
  const parent = buildChunk(file, {
    ...span,
    chunkKey: parentKey,
    metadata: {
      ...span.metadata,
      retrieval_role: 'parent',
    },
  });

  const children = splitLargeSpan(lines, span, opts).map((child, index) =>
    buildChunk(file, {
      ...child,
      parentKey,
      chunkKey: `${parentKey}:child:${index + 1}`,
      sectionPath: span.sectionPath,
      metadata: {
        ...child.metadata,
        chunk_strategy: span.metadata.chunk_strategy,
        symbol_kind: span.metadata.symbol_kind,
        symbol_name: span.metadata.symbol_name,
        retrieval_role: 'child',
      },
    }),
  );

  return [parent, ...children];
}

function lineWindowChunks(file: LoadedFile, opts: Required<ChunkOpts>): IndexChunk[] {
  const lines = file.content.split(/\r?\n/);
  const chunks: IndexChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    let end = start;
    let chars = 0;

    while (end < lines.length) {
      const next = lines[end] ?? '';
      if (chars > 0 && chars + next.length + 1 > opts.chunkMaxChars) break;
      chars += next.length + 1;
      end++;
    }

    if (end === start) end++;

    const span = trimSpan(lines, start, end);
    if (span) {
      chunks.push(
        buildChunk(file, {
          ...span,
          metadata: { ...span.metadata, chunk_strategy: 'line_window' },
        }),
      );
    }

    if (end >= lines.length) break;
    start = Math.max(end - opts.chunkOverlapLines, start + 1);
  }

  return chunks;
}

function markdownChunks(file: LoadedFile, opts: Required<ChunkOpts>): IndexChunk[] {
  const lines = file.content.split(/\r?\n/);
  const headingStack: string[] = [];
  const starts: { line: number; sectionPath: string[] }[] = [];

  lines.forEach((line, i) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) return;

    const level = match[1]!.length;
    const title = match[2]!.replace(/\s+#+$/, '').trim();
    headingStack.length = level - 1;
    headingStack[level - 1] = title;
    starts.push({ line: i, sectionPath: headingStack.filter(Boolean) });
  });

  if (starts.length === 0) return [];

  const spans: LineSpan[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = starts[i + 1]?.line ?? lines.length;
    const span = trimSpan(lines, start.line, end);
    if (span) {
      spans.push({
        ...span,
        sectionPath: start.sectionPath,
        metadata: { chunk_strategy: 'markdown_section' },
      });
    }
  }

  return spans
    .flatMap((span) => splitLargeSpan(lines, span, opts))
    .map((span) => buildChunk(file, span));
}

function pythonSymbolChunks(file: LoadedFile, opts: Required<ChunkOpts>): IndexChunk[] {
  const lines = file.content.split(/\r?\n/);
  const symbols: { line: number; indent: number; kind: string; name: string }[] = [];

  lines.forEach((line, i) => {
    const match = PYTHON_SYMBOL.exec(line);
    if (!match) return;
    const indent = match[1]!.replace(/\t/g, '    ').length;
    if (indent > 0) return;
    symbols.push({
      line: i,
      indent,
      kind: match[2]!.includes('class') ? 'class' : 'function',
      name: match[3]!,
    });
  });

  const spans: LineSpan[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i]!;
    let end = lines.length;

    for (let j = i + 1; j < symbols.length; j++) {
      const next = symbols[j]!;
      if (next.indent <= symbol.indent) {
        end = next.line;
        break;
      }
    }

    const span = trimSpan(lines, symbol.line, end);
    if (span) {
      spans.push({
        ...span,
        sectionPath: [symbol.name],
        metadata: {
          chunk_strategy: 'python_symbol',
          symbol_kind: symbol.kind,
          symbol_name: symbol.name,
        },
      });
    }
  }

  return spans
    .flatMap((span) => splitLargeSpan(lines, span, opts))
    .map((span) => buildChunk(file, span));
}

function braceDelta(line: string): number {
  let delta = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') delta++;
    if (char === '}') delta--;
  }

  return delta;
}

function braceSymbolChunks(file: LoadedFile, opts: Required<ChunkOpts>): IndexChunk[] {
  const lines = file.content.split(/\r?\n/);
  const spans: LineSpan[] = [];
  let depth = 0;
  let active: {
    start: number;
    startDepth: number;
    name: string;
    kind: string;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match: RegExpExecArray | null = active ? null : BRACE_SYMBOL.exec(line);

    if (match) {
      active = {
        start: i,
        startDepth: depth,
        name: match[1] ?? match[2] ?? 'anonymous',
        kind: line.includes('class ') ? 'class' : 'function',
      };
    }

    depth += braceDelta(line);

    if (active && depth <= active.startDepth) {
      const span = trimSpan(lines, active.start, i + 1);
      if (span) {
        spans.push({
          ...span,
          sectionPath: [active.name],
          metadata: {
            chunk_strategy: 'brace_symbol',
            symbol_kind: active.kind,
            symbol_name: active.name,
          },
        });
      }
      active = null;
    }
  }

  if (active) {
    const span = trimSpan(lines, active.start, lines.length);
    if (span) {
      spans.push({
        ...span,
        sectionPath: [active.name],
        metadata: {
          chunk_strategy: 'brace_symbol',
          symbol_kind: active.kind,
          symbol_name: active.name,
        },
      });
    }
  }

  return spans
    .flatMap((span) => splitLargeSpan(lines, span, opts))
    .map((span) => buildChunk(file, span));
}

function scriptKindForLanguage(language: string | null): ts.ScriptKind {
  switch (language) {
    case 'javascript':
      return ts.ScriptKind.JS;
    case 'javascriptreact':
      return ts.ScriptKind.JSX;
    case 'typescriptreact':
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function topLevelTsSymbol(statement: ts.Statement): { kind: string; name: string } | null {
  if (ts.isFunctionDeclaration(statement)) {
    return { kind: 'function', name: statement.name?.text ?? 'default' };
  }
  if (ts.isClassDeclaration(statement)) {
    return { kind: 'class', name: statement.name?.text ?? 'default' };
  }
  if (ts.isInterfaceDeclaration(statement)) {
    return { kind: 'interface', name: statement.name.text };
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return { kind: 'type', name: statement.name.text };
  }
  if (ts.isEnumDeclaration(statement)) {
    return { kind: 'enum', name: statement.name.text };
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const init = declaration.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init)) {
        return {
          kind: ts.isClassExpression(init) ? 'class' : 'function',
          name: declaration.name.text,
        };
      }
    }
  }
  return null;
}

function tsAstSymbolChunks(file: LoadedFile, opts: Required<ChunkOpts>): IndexChunk[] {
  const lines = file.content.split(/\r?\n/);
  const source = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    false,
    scriptKindForLanguage(file.language),
  );
  const spans: LineSpan[] = [];

  for (const statement of source.statements) {
    const symbol = topLevelTsSymbol(statement);
    if (!symbol) continue;

    const start = source.getLineAndCharacterOfPosition(statement.getFullStart()).line;
    const end = source.getLineAndCharacterOfPosition(statement.end).line + 1;
    const span = trimSpan(lines, start, end);
    if (span) {
      spans.push({
        ...span,
        sectionPath: [symbol.name],
        metadata: {
          chunk_strategy: 'ts_ast_symbol',
          symbol_kind: symbol.kind,
          symbol_name: symbol.name,
        },
      });
    }
  }

  return spans.flatMap((span) => splitLargeParentChild(file, lines, span, opts));
}

export function chunkFile(file: LoadedFile, opts: ChunkOpts = {}): IndexChunk[] {
  if (file.content.trim().length === 0) return [];

  const resolved = {
    chunkMaxChars: opts.chunkMaxChars ?? DEFAULT_CHUNK_MAX_CHARS,
    chunkOverlapLines: opts.chunkOverlapLines ?? DEFAULT_OVERLAP_LINES,
  };

  if (file.language === 'markdown' || file.language === 'mdx') {
    const chunks = markdownChunks(file, resolved);
    if (chunks.length > 0) return chunks;
  }

  if (file.language === 'python') {
    const chunks = pythonSymbolChunks(file, resolved);
    if (chunks.length > 0) return chunks;
  }

  if (file.language && TYPESCRIPT_AST_LANGUAGES.has(file.language)) {
    const chunks = tsAstSymbolChunks(file, resolved);
    if (chunks.length > 0) return chunks;
  }

  if (file.language && BRACE_LANGUAGES.has(file.language)) {
    const chunks = braceSymbolChunks(file, resolved);
    if (chunks.length > 0) return chunks;
  }

  return lineWindowChunks(file, resolved);
}

export function chunkFiles(files: LoadedFile[], opts: ChunkOpts = {}): IndexChunk[] {
  return files.flatMap((file) => chunkFile(file, opts));
}
