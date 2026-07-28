import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Trzy paczki vendorów wydzielone ręcznie — i ani jednej więcej. Dopasowanie
 * idzie po ID modułu (ścieżka w `node_modules`), a nie po nazwie importu.
 *
 * `react` celowo zbiera CAŁĄ rodzinę środowiska uruchomieniowego React
 * (`react`, `react-dom`, `scheduler`) RAZEM z routerem (`react-router`,
 * `react-router-dom`, `@remix-run/router`). Rozbicie routera do osobnego chunku
 * potrafi dać cykliczną inicjalizację między chunkami albo drugą kopię Reacta —
 * a router i tak jest potrzebny przy pierwszym malowaniu, więc nic by to nie
 * oszczędziło.
 *
 * `motion` obejmuje też wewnętrzne paczki silnika (`framer-motion`,
 * `motion-dom`, `motion-utils`), bo `motion/react` jest tylko fasadą nad nimi.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
    return 'react';
  }
  if (/node_modules\/@remix-run\/router\//.test(id)) return 'react';
  if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion';
  if (/node_modules\/@supabase\//.test(id)) return 'supabase';
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  // `lucide-react` to setki drobnych modułów ikon — bez prebundlingu dev-server
  // rozprasza je na osobne żądania przy pierwszym wejściu na każdą trasę.
  // Wpływa WYŁĄCZNIE na `vite dev`, nie na build produkcyjny.
  optimizeDeps: { include: ['lucide-react'] },
  build: {
    // JEDEN arkusz stylów na całą aplikację. Trasy są teraz leniwe, a przy
    // domyślnym `cssCodeSplit: true` każdy chunk trasy wstrzykiwałby własny
    // `<link>` w trakcie działania — kaskada `styles.css` jest jednym plikiem i
    // ma nim zostać.
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
});
