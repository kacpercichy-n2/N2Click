# Product

## Register

product

## Users

Zespół agencji kreatywnej N2 Media (projektanci, programiści, kierownicy
projektów, zarząd) — kilkanaście osób pracujących długo przy ekranie, głównie
desktop, ciemne biura/wieczory. Kontekst: codzienne planowanie i rozliczanie
pracy — użytkownik jest w środku zadania, nie „zwiedza" interfejsu. Język
interfejsu: wyłącznie polski.

## Product Purpose

N2Hub to wewnętrzny planer agencji: klienci → projekty → zadania → godziny
rozplanowane na kalendarzu osób. Sukces = zespół widzi w kilka sekund co ma
dziś robić, a kierownik — kto jest przeciążony i co jest nierozplanowane.
Rozszerzany o warstwę HR (urlopy, wnioski, zapotrzebowania).

## Brand Personality

Profesjonalne narzędzie z energią: sprawne, skondensowane, poważne w pracy —
ale fioletowo-neonowa paleta (violet #7000ff, lawenda #c496ff, limonkowy
sukces #b9ff4d na czarnym tle) daje mu wyrazisty, własny charakter agencji
kreatywnej. Punkt odniesienia: Linear, Raycast — gęstość informacji bez
ciasnoty, precyzja bez sterylności. Trzy słowa: sprawne · wyraziste · rzeczowe.

## Anti-references

- Korpo-ERP: gęste tabele w ramkach, szare tła, wygląd SAP-a / starego Jiry.
  Żadnych siatek obramowanych komórek i formularzy-ścian.
- Generyczny szablon SaaS-dashboardu (identyczne karty ikona+nagłówek+tekst,
  hero-metryki z gradientem) — N2Hub ma własny system, nie szablonowy.

## Design Principles

1. **Gęstość bez ciasnoty** — dane skondensowane jak w Linear, oddychające
   światłem (spacing), nie ramkami.
2. **Kolor znaczy, nie zdobi** — fiolet = marka/akcja, cyjan = wydarzenia,
   czerwień = nieobecność/niebezpieczeństwo, limonka = sukces. Nowe elementy
   biorą znaczenia z istniejącej mapy, nie dodają nowych kolorów.
3. **Czytaj bez klikania, edytuj świadomie** — wartości domyślnie w trybie
   odczytu; edycja to jawny stan, nie pole czekające na focus.
4. **Jeden system** — tokeny `--n2-*`, wspólne powłoki modali/nakładek/pól;
   żaden widok nie wymyśla własnych prymitywów.
5. **Stan pusty to też ekran** — każda sekcja ma zaprojektowaną pustkę
   (empty state), nie białą dziurę.

## Accessibility & Inclusion

WCAG AA jako twardy standard: kontrast tekstu ≥4,5:1 na realnej powierzchni
(progi udokumentowane przy tokenach w `styles.css` — `--n2-text-faint` to
najsłabszy dozwolony kolor tekstu), widoczny focus, pełne wsparcie
`prefers-reduced-motion`, cele dotykowe ≥44px, brak natywnych `title`
(wspólny system dymków), ogłoszenia zmian przez liveRegion.
