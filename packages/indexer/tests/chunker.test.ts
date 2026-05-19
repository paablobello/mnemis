import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkFile } from '../src/index.ts';

describe('chunkFile', () => {
  it('preserves path, line ranges and language', () => {
    const chunks = chunkFile(
      {
        path: 'src/example.ts',
        absolutePath: '/tmp/src/example.ts',
        content: ['export function one() {}', 'export function two() {}', ''].join('\n'),
        language: 'typescript',
        byteLength: 44,
        modifiedAt: new Date('2026-05-16T10:00:00.000Z'),
      },
      { chunkMaxChars: 80 },
    );

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]!.path, 'src/example.ts');
    assert.equal(chunks[0]!.lineStart, 1);
    assert.equal(chunks[0]!.lineEnd, 1);
    assert.equal(chunks[0]!.language, 'typescript');
    assert.equal((chunks[0]!.metadata as { symbol_name?: string }).symbol_name, 'one');
  });

  it('splits long files with overlap', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1} xxxxxxxxxx`).join('\n');
    const chunks = chunkFile(
      {
        path: 'README.md',
        absolutePath: '/tmp/README.md',
        content,
        language: 'markdown',
        byteLength: content.length,
        modifiedAt: new Date('2026-05-16T10:00:00.000Z'),
      },
      { chunkMaxChars: 45, chunkOverlapLines: 1 },
    );

    assert.ok(chunks.length > 1);
    assert.equal(chunks[1]!.lineStart, chunks[0]!.lineEnd);
  });

  it('chunks markdown by heading sections', () => {
    const content = [
      '# Overview',
      'Intro text.',
      '## Install',
      'Run bun install.',
      '## Search',
      'Use raw chunk search with citations.',
    ].join('\n');
    const chunks = chunkFile({
      path: 'README.md',
      absolutePath: '/tmp/README.md',
      content,
      language: 'markdown',
      byteLength: content.length,
      modifiedAt: new Date('2026-05-16T10:00:00.000Z'),
    });

    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks[0]!.sectionPath, ['Overview']);
    assert.deepEqual(chunks[1]!.sectionPath, ['Overview', 'Install']);
    assert.equal(
      (chunks[1]!.metadata as { chunk_strategy?: string }).chunk_strategy,
      'markdown_section',
    );
  });

  it('chunks brace languages by top-level symbols', () => {
    const content = [
      'export function alpha() {',
      '  return 1;',
      '}',
      '',
      'export const beta = () => {',
      '  return 2;',
      '};',
    ].join('\n');
    const chunks = chunkFile({
      path: 'src/example.ts',
      absolutePath: '/tmp/src/example.ts',
      content,
      language: 'typescript',
      byteLength: content.length,
      modifiedAt: new Date('2026-05-16T10:00:00.000Z'),
    });

    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks.map((chunk) => (chunk.metadata as { symbol_name?: string }).symbol_name),
      ['alpha', 'beta'],
    );
    assert.ok(chunks.every((chunk) => chunk.metadata.chunk_strategy === 'brace_symbol'));
  });

  it('chunks Python by def and class blocks', () => {
    const content = [
      'def alpha():',
      '    return 1',
      '',
      'class Beta:',
      '    def inside(self):',
      '        return 2',
      '',
      'def gamma():',
      '    return 3',
    ].join('\n');
    const chunks = chunkFile({
      path: 'main.py',
      absolutePath: '/tmp/main.py',
      content,
      language: 'python',
      byteLength: content.length,
      modifiedAt: new Date('2026-05-16T10:00:00.000Z'),
    });

    assert.equal(chunks.length, 3);
    assert.deepEqual(
      chunks.map((chunk) => (chunk.metadata as { symbol_name?: string }).symbol_name),
      ['alpha', 'Beta', 'gamma'],
    );
    assert.ok(chunks[1]!.rawText.includes('def inside'));
  });
});
