import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Vitest podstawia pod KAŻDY import CSS pusty moduł (również przy `?raw`), więc
// test kontraktów arkusza (`src/utils/stylesheetContract.test.ts`) nie może po prostu
// zaimportować `styles.css`. Ten wirtualny moduł podaje jego treść jako string.
// Siedzi tutaj, a nie w teście, bo `tsconfig.json` obejmuje tylko `src`, a
// aplikacja celowo nie ma typów Node.
const STYLES_ID = 'virtual:styles-css';

export default defineConfig({
  plugins: [
    {
      name: 'n2hub-styles-raw',
      resolveId: (id: string) => (id === STYLES_ID ? `\0${STYLES_ID}` : null),
      load: (id: string) =>
        id === `\0${STYLES_ID}`
          ? `export default ${JSON.stringify(
              readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8'),
            )};`
          : null,
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
