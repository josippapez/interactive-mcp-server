import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default {
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src/renderer/src'),
    },
  },
};
