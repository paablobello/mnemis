import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_OUTPUT ?? undefined,
  transpilePackages: ['@mnemis/db', '@mnemis/saas'],
  turbopack: {
    root,
  },
};

export default nextConfig;
