import { createInterface } from 'node:readline/promises';

export function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function err(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function prompt(question: string, options: { mask?: boolean } = {}): Promise<string> {
  if (options.mask) {
    return promptMasked(question);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptMasked(question: string): Promise<string> {
  process.stdout.write(question);
  const tty = process.stdin.isTTY;
  if (tty && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r' || ch === '') {
          process.stdin.off('data', onData);
          if (tty && process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
          }
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(buffer.trim());
          return;
        }
        if (ch === '') {
          process.exit(130);
        }
        if (ch === '' || ch === '\b') {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
