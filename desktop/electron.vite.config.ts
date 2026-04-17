import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Don't externalize the OpenCode SDK - let Vite bundle it
        // to convert ESM to CJS for Electron's main process
        exclude: ['@opencode-ai/sdk'],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks(id: string): string | undefined {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (id.includes('react-syntax-highlighter')) {
              return 'syntax-highlighter';
            }
            if (id.includes('react-markdown') || id.includes('remark-gfm')) {
              return 'markdown';
            }
            if (id.includes('@gsap/react') || /[\\/]gsap[\\/]/.test(id)) {
              return 'gsap';
            }
            if (id.includes('@radix-ui')) {
              return 'radix';
            }
            if (/[\\/]node_modules[\\/]cmdk[\\/]/.test(id)) {
              return 'cmdk';
            }
            if (id.includes('@tanstack')) {
              return 'tanstack';
            }
            if (/[\\/]node_modules[\\/]morphdom[\\/]/.test(id)) {
              return 'morphdom';
            }
            if (
              id.includes('jotai') ||
              id.includes('use-stick-to-bottom') ||
              id.includes('class-variance-authority') ||
              id.includes('clsx') ||
              id.includes('tailwind-merge') ||
              id.includes('tailwindcss-animate') ||
              id.includes('zod')
            ) {
              return 'vendor-utils';
            }
            if (
              /[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id) ||
              id.includes('react-dom/client') ||
              id.includes('scheduler')
            ) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
  },
});
