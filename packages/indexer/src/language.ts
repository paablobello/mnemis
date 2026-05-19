import { extname } from 'node:path';

const EXTENSION_LANGUAGE = new Map<string, string>([
  ['.c', 'c'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cs', 'csharp'],
  ['.css', 'css'],
  ['.go', 'go'],
  ['.html', 'html'],
  ['.java', 'java'],
  ['.js', 'javascript'],
  ['.jsx', 'javascriptreact'],
  ['.json', 'json'],
  ['.md', 'markdown'],
  ['.mdx', 'mdx'],
  ['.py', 'python'],
  ['.rs', 'rust'],
  ['.sh', 'shell'],
  ['.sql', 'sql'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescriptreact'],
  ['.txt', 'text'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
]);

export function detectLanguage(path: string): string | null {
  return EXTENSION_LANGUAGE.get(extname(path).toLowerCase()) ?? null;
}
