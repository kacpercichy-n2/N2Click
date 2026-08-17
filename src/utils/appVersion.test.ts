import { describe, expect, it } from 'vitest';
import { isNewerBuild, moduleScriptSrc } from './appVersion';

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-Ef56.css">
</head><body><div id="root"></div></body></html>`;

describe('moduleScriptSrc', () => {
  it('czyta adres głównego skryptu modułu z HTML-a Vite', () => {
    expect(moduleScriptSrc(HTML)).toBe('/assets/index-Ab12Cd34.js');
  });

  it('pomija skrypty bez type=module i toleruje inną kolejność atrybutów', () => {
    const html = `<script src="/x.js"></script><script src="/src/main.tsx" type="module"></script>`;
    expect(moduleScriptSrc(html)).toBe('/src/main.tsx');
  });

  it('daje null, gdy HTML nie ma skryptu modułu', () => {
    expect(moduleScriptSrc('')).toBeNull();
    expect(moduleScriptSrc('<html><body>Authentication Required</body></html>')).toBeNull();
    expect(moduleScriptSrc('<script type="module"></script>')).toBeNull();
  });
});

describe('isNewerBuild', () => {
  it('nowa wersja tylko przy dwóch znanych, różnych odciskach', () => {
    expect(isNewerBuild('/assets/index-a.js', '/assets/index-b.js')).toBe(true);
    expect(isNewerBuild('/assets/index-a.js', '/assets/index-a.js')).toBe(false);
    expect(isNewerBuild(null, '/assets/index-b.js')).toBe(false);
    expect(isNewerBuild('/assets/index-a.js', null)).toBe(false);
  });
});
