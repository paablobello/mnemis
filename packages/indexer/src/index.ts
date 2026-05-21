export { chunkFile, chunkFiles } from './chunker.ts';
export { buildDocsSiteIndex, crawlDocsSite, crawlWebPage } from './docs.ts';
export { collectLocalFiles } from './files.ts';
export { detectLanguage } from './language.ts';
export { buildPdfDocumentIndex, buildWebPageIndex } from './web.ts';
export type { BuildIndexResult, IndexChunk, IndexSourceConfig, LoadedFile } from './types.ts';

import { chunkFiles } from './chunker.ts';
import { collectLocalFiles } from './files.ts';
import type { BuildIndexResult, IndexSourceConfig } from './types.ts';

export async function buildLocalSourceIndex(
  rootPath: string,
  config: IndexSourceConfig = {},
): Promise<BuildIndexResult> {
  const files = await collectLocalFiles(rootPath, config);
  const chunks = chunkFiles(files, {
    chunkMaxChars: config.chunkMaxChars,
    chunkOverlapLines: config.chunkOverlapLines,
  });
  const lastChangeAt =
    files.length === 0
      ? null
      : files.reduce(
          (latest, file) => (file.modifiedAt > latest ? file.modifiedAt : latest),
          files[0]!.modifiedAt,
        );

  return { files, chunks, lastChangeAt };
}
