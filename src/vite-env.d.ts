/// <reference types="vite/client" />

/** Treść `src/styles.css` jako string — wirtualny moduł z `vitest.config.ts`,
 *  używany wyłącznie przez `src/utils/stylesheetContract.test.ts` (Vitest stubuje importy CSS). */
declare module 'virtual:styles-css' {
  const css: string;
  export default css;
}
