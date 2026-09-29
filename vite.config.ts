import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';

export default defineConfig(() => {
  return {
    plugins: [dyadComponentTagger(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
