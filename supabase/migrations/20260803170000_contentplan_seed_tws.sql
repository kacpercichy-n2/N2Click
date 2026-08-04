-- =============================================================================
-- Migracja: 20260803170000_contentplan_seed_tws
--
-- Moduł Content Plan (faza R6): JEDNORAZOWY import realnego content planu marki
-- Tetra Wave Solutions (lipiec i sierpień 2026) z appki-plannera
-- („Content plan/planner/src/data/tws.js" — dane przeniesione 1:1 z arkusza
-- „Content plan - TWS.xlsx"). Plik jest WYGENEROWANY przez
-- `scripts/contentplan-seed-tws.mjs` — nie edytuj go ręcznie, zmień mapper
-- (`scripts/contentplan-seed-tws-mapper.mjs`) i wygeneruj plik ponownie.
--
-- ZERO zmian schematu: same wiersze do tabel z 20260803160000. Klucze główne to
-- UUID v5 liczone z identyfikatorów źródłowych, więc wygenerowany SQL jest
-- deterministyczny (te same id przy każdym uruchomieniu).
--
-- `on conflict (id) do nothing` (a NIE `do update`): to seed danych
-- historycznych, a nie źródło prawdy. Po imporcie treści żyją w module i bywają
-- redagowane przez zespół — ponowne wykonanie migracji nie może cofnąć tych
-- zmian. Wiersz brakujący zostanie dołożony, wiersz istniejący zostaje nietknięty.
--
-- Mapowanie statusów arkusz -> planner -> moduł oraz progi `visibility`
-- opisuje tabela w nagłówku mappera (sekcja „TABELA MAPOWANIA STATUSÓW").
-- `n2click_client_id` zostaje NULL — import nie zgaduje identyfikatorów
-- klientów N2Click, markę podpina operator z poziomu UI.
-- =============================================================================

-- Marka wraz ze słownikami wyprowadzonymi z danych źródłowych.
insert into contentplan.brands
  (id, name, industry, contact, accent, platforms, topics, formats, n2click_client_id)
values
  ('db1ac512-2c44-50ea-9760-c21e417fe2f8',
   'Tetra Wave Solutions',
   '',
   '@tetrawavesolutions',
   '#14b8a6',
   '[{"id":"facebook","name":"Facebook","color":"#1877F2"},{"id":"instagram","name":"Instagram","color":"#E4405F"},{"id":"tiktok","name":"TikTok","color":"#00F2EA"}]'::jsonb,
   array['Produkt', 'O firmie', 'Usługi']::text[],
   array['Post', 'Reel']::text[],
   null)
on conflict (id) do nothing;

-- Publikacje (23) — jeden wiersz na kreację arkusza.
insert into contentplan.posts
  (id, brand_id, date, title, topic, format, status, visibility, base_tags)
values
  -- tws-0707-1
  ('b4fe133c-d098-54c4-99c0-a51f78646fec',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-07',
   'Podczas intensywnej gry liczy się każdy detal - również stabi...',
   'Produkt',
   'Post',
   'Opublikowano',
   'published',
   array['#tws', '#tetrawavesolutions', '#diamondlock', '#akcesoriamuzyczne', '#dlamuzyków']::text[]),
  -- tws-0708-1
  ('d5ba7429-db61-511d-953e-88b9ed7b357e',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-08',
   'Mały detal, duży spokój.',
   'Produkt',
   'Reel',
   'Opublikowano',
   'published',
   array['#tws', '#tetrawavesolutions', '#diamondlock', '#akcesoriamuzyczne', '#dlamuzyków']::text[]),
  -- tws-0710-1
  ('2d0d0a22-5753-5490-beea-77f85041c74a',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-10',
   'Są brzmienia, które mają być po prostu słyszalne. Są też taki...',
   'Produkt',
   'Post',
   'Opublikowano',
   'published',
   array['#tws', '#tetrawavesolutions', '#midsub', '#akcesoriamuzyczne', '#dlamuzyków']::text[]),
  -- tws-0710-2
  ('9dca9f30-107b-5a6c-aaea-e3f08443fffa',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-10',
   'Są brzmienia, które mają być po prostu słyszalne. Są też taki...',
   'Produkt',
   'Post',
   'Zaplanowane',
   'published',
   array['#tws', '#tetrawavesolutions', '#midsub', '#akcesoriamuzyczne', '#dlamuzyków']::text[]),
  -- tws-0711-1
  ('c01403c4-a2c6-53dd-8314-229c1b664768',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-11',
   'Niski dźwięk, wysoka precyzja - poznaj mikrofon, który rozumi...',
   'Produkt',
   'Reel',
   'Zaplanowane',
   'published',
   array['#tws', '#tetrawavesolutions', '#midsub', '#akcesoriamuzyczne', '#dlamuzyków']::text[]),
  -- tws-0713-1
  ('33bc3f8d-4fe9-5ec5-ae7f-b2fa0d77f940',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-13',
   'Dobry setup mikrofonowy zaczyna się od precyzyjnego ustawieni...',
   'O firmie',
   'Post',
   'Zaplanowane',
   'published',
   array['#xy', '#ORTF', '#fredman', '#snareclip', '#tetrawavesolutions']::text[]),
  -- tws-0715-1
  ('a6d9b88f-a48a-523e-8890-c7100f019d50',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-15',
   'Nie każdy bohater studia wydaje dźwięk. Niektórzy po prostu t...',
   'Produkt',
   'Reel',
   'Opublikowano',
   'published',
   array['#tetrawavesolutions', '#XY', '#ORTF', '#snareclip', '#fredman']::text[]),
  -- tws-0716-1
  ('378f9ff4-8af4-52ff-9001-fb1f1b947ab2',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-16',
   'Nie lubimy ograniczeń - preferujemy kreatywne dopasowanie.',
   'Usługi',
   'Post',
   'Opublikowano',
   'published',
   array['#tetrawavesolutions', '#akcesoriamuzyczne', '#personalizacja', '#dlamuzyków', '#tws']::text[]),
  -- tws-0717-1
  ('f16252b9-037a-5713-af21-014488dc9680',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-17',
   'Standardowy uchwyt nie pasuje? To jeszcze nie koniec tematu.',
   'Usługi',
   'Reel',
   'Zaplanowane',
   'published',
   array['#tetrawavesolutions', '#akcesoriamuzyczne', '#personalizacja', '#dlamuzyków', '#tws']::text[]),
  -- tws-0720-1
  ('1a8b9735-4486-571d-939b-63ce9b3c13b0',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-20',
   'Ribbon Mount to uchwyt do konfiguracji Mid-Side, który pomaga...',
   'Produkt',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzykow', '#ribbonmount', '#akcesoriamuzyczne']::text[]),
  -- tws-0721-1
  ('26168e27-4ac7-5647-bcb5-4d2707de6dff',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-21',
   'Dwa mikrofony, jedna konfiguracja i zdecydowanie mniej przypa...',
   'Produkt',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzykow', '#ribbonmount', '#akcesoriamuzyczne']::text[]),
  -- tws-0723-1
  ('ae4934cc-404c-5173-a464-d3d6b73b0125',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-23',
   'Cable Wall Mount to techniczny uchwyt ścienny zaprojektowany...',
   'Produkt',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#muzyka', '#CableWallMount', '#akcesoriamuzyczne']::text[]),
  -- tws-0724-1
  ('6759c140-cd80-50fa-93d7-c1b985618148',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-24',
   'Kable nie muszą leżeć na ziemi, plątać się pod nogami ani zaj...',
   'Produkt',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#muzyka', '#CableWallMount', '#akcesoriamuzyczne']::text[]),
  -- tws-0727-1
  ('14610be4-39f0-50e1-b67a-de69058c8a03',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-27',
   'Wymyśliłeś coś, czego nie ma na rynku? Custom Shop to miejsce...',
   'Usługi',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#CustomShop', '#akcesoriamuzyczne']::text[]),
  -- tws-0728-1
  ('07369e1d-2ec5-5add-836c-c4a8f17aeaf2',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-28',
   'Masz pomysł na produkt, akcesorium, obudowę albo element tech...',
   'Usługi',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#CustomShop', '#akcesoriamuzyczne']::text[]),
  -- tws-0730-1
  ('bb040230-3b5e-53b5-bdcc-c8b8d7b19b31',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-30',
   'Dual Clip to klips montowany na statywie mikrofonowym, który...',
   'Produkt',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#DualClip', '#akcesoriamuzyczne']::text[]),
  -- tws-0731-1
  ('ba13cf2c-d52a-58c5-baa9-5731f2238611',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-07-31',
   'Mały element, który potrafi uporządkować cały setup.',
   'Produkt',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#DualClip', '#akcesoriamuzyczne']::text[]),
  -- tws-0803-1
  ('110751ab-f664-55d5-8193-39f68fdba7a5',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-08-03',
   'MixMount Shelf to uchwyt ścienny zaprojektowany z myślą o peł...',
   'Produkt',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#MixMountShelf', '#akcesoriamuzyczne']::text[]),
  -- tws-0804-1
  ('23c855ac-f1a7-5b7a-9617-295761189513',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-08-04',
   'Mikser na ścianie, przestrzeń odzyskana, setup bardziej uporz...',
   'Produkt',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#MixMountShelf', '#akcesoriamuzyczne']::text[]),
  -- tws-0806-1
  ('a206002b-0baa-53cd-b4a8-63d6d4699902',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-08-06',
   'MixMount Base to płytka montażowa, która pozwala stabilnie za...',
   'Produkt',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#MixMountBase', '#akcesoriamuzyczne']::text[]),
  -- tws-0807-1
  ('449a20e8-d2c2-5ccb-84d5-57a1b05494b1',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-08-07',
   'Ergonomia zaczyna się tam, gdzie sprzęt ma swoje miejsce.',
   'Produkt',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#MixMountBase', '#akcesoriamuzyczne']::text[]),
  -- tws-0810-1
  ('18e334ea-ecc8-5590-bdbb-263bbe15c03b',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-08-10',
   'Nie każdą część da się dziś bez problemu kupić. Czasem jest n...',
   'Usługi',
   'Post',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#customshop', '#akcesoriamuzyczne']::text[]),
  -- tws-0811-1
  ('5e150a05-badc-5926-a8cf-cd7ab4e63408',
   'db1ac512-2c44-50ea-9760-c21e417fe2f8',
   '2026-08-11',
   'Część niedostępna? To jeszcze nie znaczy, że temat jest zamkn...',
   'Usługi',
   'Reel',
   'Zaplanowane',
   'published',
   array['#TWS', '#tetrawavesolutions', '#dlamuzyków', '#customshop', '#akcesoriamuzyczne']::text[])
on conflict (id) do nothing;

-- Kanały (55) — jeden wiersz na parę (publikacja, platforma).
-- NULL w `description_group_id` ≡ grupa główna opisu (patrz domain.ts).
insert into contentplan.post_channels
  (id, post_id, platform_id, copy, tags, override_tags, description_group_id,
   media_source, media_file_id, media_width, media_height, media_type)
values
  ('0bdca87e-a4d8-5344-bd33-bfb548466f1f',
   'b4fe133c-d098-54c4-99c0-a51f78646fec',
   'instagram',
   '🥁 Podczas intensywnej gry liczy się każdy detal - również stabilność śrub perkusyjnych. TWS Diamond Lock pomaga utrzymać ich wybraną pozycję i ogranicza samoczynne luzowanie się lugów podczas pracy zestawu.
💎 Diamentowy kształt pozwala dopasować blokadę do wielu odległości i rodzajów bębnów, bez potrzeby zamawiania kilku wariantów rozmiarowych. Zęby o szerokości 1 mm zapewniają pewne trzymanie oraz precyzyjne ustawienie.
🛠️ Każdy detal Diamond Locka wykańczamy również z wykorzystaniem procesu „ironingu” - prasowania powierzchni gorącą dyszą przy równoległym podawaniu materiału. Dzięki temu ograniczamy drobne ubytki i uzyskujemy bardziej dopracowane wykończenie.
🔥 Dokręć śrubę i zadbaj o stabilność swojego setupu. Sprawdź Diamond Lock oraz pozostałe akcesoria na stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1gMKksSz9a0IkIrxueOKX-b6Rs8xoq3gL',
   null,
   null,
   'image'),
  ('b3cd01b0-ee9b-5bd1-9a4e-1624797c8454',
   'b4fe133c-d098-54c4-99c0-a51f78646fec',
   'facebook',
   '🥁 Podczas intensywnej gry liczy się każdy detal - również stabilność śrub perkusyjnych. TWS Diamond Lock pomaga utrzymać ich wybraną pozycję i ogranicza samoczynne luzowanie się lugów podczas pracy zestawu.
💎 Diamentowy kształt pozwala dopasować blokadę do wielu odległości i rodzajów bębnów, bez potrzeby zamawiania kilku wariantów rozmiarowych. Zęby o szerokości 1 mm zapewniają pewne trzymanie oraz precyzyjne ustawienie.
🛠️ Każdy detal Diamond Locka wykańczamy również z wykorzystaniem procesu „ironingu” - prasowania powierzchni gorącą dyszą przy równoległym podawaniu materiału. Dzięki temu ograniczamy drobne ubytki i uzyskujemy bardziej dopracowane wykończenie.
🔥 Dokręć śrubę i zadbaj o stabilność swojego setupu. Sprawdź Diamond Lock oraz pozostałe akcesoria na stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1gMKksSz9a0IkIrxueOKX-b6Rs8xoq3gL',
   null,
   null,
   'image'),
  ('bd83cff9-4bc5-5b19-b3a1-8c8c152f4ec8',
   'd5ba7429-db61-511d-953e-88b9ed7b357e',
   'instagram',
   'Mały detal, duży spokój.
💎 Blokady Diamond Lock pomagają utrzymać wybraną pozycję śruby i ograniczają jej samoczynne luzowanie podczas gry.
🛠️ Diamentowy kształt pozwala dopasować blokadę do różnych odległości i typów bębnów, a precyzyjny druk 3D umożliwił wykonanie drobnych, 1-milimetrowych zębów trzymających lugę.
🔥 W produkcji dopracowaliśmy także proces wykończenia powierzchni, żeby detal był stabilny, powtarzalny i gotowy do pracy w perkusyjnym setupie.
😄 Niech śruby trzymają rytm razem z Tobą - sprawdź Diamond Lock na naszej stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1KJ8-O9MAC5CUyFxx7zkRHtfnnu8Wz1Gu',
   null,
   null,
   'video'),
  ('aec4897f-e66a-5cdb-8cc6-669045859480',
   'd5ba7429-db61-511d-953e-88b9ed7b357e',
   'facebook',
   'Mały detal, duży spokój.
💎 Blokady Diamond Lock pomagają utrzymać wybraną pozycję śruby i ograniczają jej samoczynne luzowanie podczas gry.
🛠️ Diamentowy kształt pozwala dopasować blokadę do różnych odległości i typów bębnów, a precyzyjny druk 3D umożliwił wykonanie drobnych, 1-milimetrowych zębów trzymających lugę.
🔥 W produkcji dopracowaliśmy także proces wykończenia powierzchni, żeby detal był stabilny, powtarzalny i gotowy do pracy w perkusyjnym setupie.
😄 Niech śruby trzymają rytm razem z Tobą - sprawdź Diamond Lock na naszej stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1KJ8-O9MAC5CUyFxx7zkRHtfnnu8Wz1Gu',
   null,
   null,
   'video'),
  ('50810824-cc6c-54db-9ac5-c4e3f7e89bc3',
   'd5ba7429-db61-511d-953e-88b9ed7b357e',
   'tiktok',
   'Mały detal, duży spokój.
💎 Blokady Diamond Lock pomagają utrzymać wybraną pozycję śruby i ograniczają jej samoczynne luzowanie podczas gry.
🛠️ Diamentowy kształt pozwala dopasować blokadę do różnych odległości i typów bębnów, a precyzyjny druk 3D umożliwił wykonanie drobnych, 1-milimetrowych zębów trzymających lugę.
🔥 W produkcji dopracowaliśmy także proces wykończenia powierzchni, żeby detal był stabilny, powtarzalny i gotowy do pracy w perkusyjnym setupie.
😄 Niech śruby trzymają rytm razem z Tobą - sprawdź Diamond Lock na naszej stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1KJ8-O9MAC5CUyFxx7zkRHtfnnu8Wz1Gu',
   null,
   null,
   'video'),
  ('08fff162-dee6-56ca-82fa-04a49f2f005d',
   '2d0d0a22-5753-5490-beea-77f85041c74a',
   'instagram',
   '🔊 Są brzmienia, które mają być po prostu słyszalne. Są też takie, które trzeba poczuć. MidSub został stworzony z myślą o ciężarze, głębi i wyraźnym fundamencie dolnego pasma.
🎙️ W konstrukcji wykorzystaliśmy przetwornik elektroakustyczny dobrze reagujący na niskie częstotliwości. Obudowę zaprojektowaliśmy tak, aby możliwie najmniej ingerowała w jego naturalną pracę i nie ograniczała swobodnego przepływu powietrza.
🛠️ Podczas testów sprawdzaliśmy różne kształty i wymiary siatek zabezpieczających. To nie jest wyłącznie element ochronny - geometria siatki wpływa na pracę przetwornika, dlatego dzięki połączeniom gwintowym mogliśmy precyzyjnie dopracować finalną charakterystykę MidSuba.
🔥 Wbij na stronę i poczuj prawdziwy bas. Sprawdź MidSub oraz pozostałe rozwiązania Tetra Wave Solutions na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1A2f9EYX31RtKLGURuzO5rMZDL_Ivlbhl',
   null,
   null,
   'image'),
  ('ec3e5375-fcc8-5b55-889c-a894f672b232',
   '9dca9f30-107b-5a6c-aaea-e3f08443fffa',
   'instagram',
   '🔊 Są brzmienia, które mają być po prostu słyszalne. Są też takie, które trzeba poczuć. MidSub został stworzony z myślą o ciężarze, głębi i wyraźnym fundamencie dolnego pasma.
🎙️ W konstrukcji wykorzystaliśmy przetwornik elektroakustyczny dobrze reagujący na niskie częstotliwości. Obudowę zaprojektowaliśmy tak, aby możliwie najmniej ingerowała w jego naturalną pracę i nie ograniczała swobodnego przepływu powietrza.
🛠️ Podczas testów sprawdzaliśmy różne kształty i wymiary siatek zabezpieczających. To nie jest wyłącznie element ochronny - geometria siatki wpływa na pracę przetwornika, dlatego dzięki połączeniom gwintowym mogliśmy precyzyjnie dopracować finalną charakterystykę MidSuba.
🔥 Wbij na stronę i poczuj prawdziwy bas. Sprawdź MidSub oraz pozostałe rozwiązania Tetra Wave Solutions na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1A2f9EYX31RtKLGURuzO5rMZDL_Ivlbhl',
   null,
   null,
   'image'),
  ('291b23e5-5adc-5d70-9938-1da7fa696223',
   'c01403c4-a2c6-53dd-8314-229c1b664768',
   'instagram',
   'Niski dźwięk, wysoka precyzja - poznaj mikrofon, który rozumie niskie dźwięki. 
🎙️ MidSub powstał z myślą o rejestracji niższego pasma - tam, gdzie liczy się ciężar, głębia i solidny fundament brzmienia.
🛠️ Podczas projektowania skupiliśmy się na kompatybilności komponentów, łatwym montażu oraz maksymalnym ograniczeniu wpływu obudowy na naturalną pracę przetwornika.
📐 Dzięki połączeniom gwintowym i prototypowaniu różnych kształtów siatek zabezpieczających mogliśmy dopracować konstrukcję tak, aby mikrofon zachował odpowiednią charakterystykę pracy z dźwiękiem.
🔥 Poczuj głębie niskiego pasma! Sprawdź MidSub na naszej stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1vySHBFyUTUzJ-7mB0nZF_Rfmvvt8fqsx',
   null,
   null,
   'video'),
  ('5416ac12-ef22-5905-b2bd-46bec3f2abdf',
   'c01403c4-a2c6-53dd-8314-229c1b664768',
   'facebook',
   'Niski dźwięk, wysoka precyzja - poznaj mikrofon, który rozumie niskie dźwięki. 
🎙️ MidSub powstał z myślą o rejestracji niższego pasma - tam, gdzie liczy się ciężar, głębia i solidny fundament brzmienia.
🛠️ Podczas projektowania skupiliśmy się na kompatybilności komponentów, łatwym montażu oraz maksymalnym ograniczeniu wpływu obudowy na naturalną pracę przetwornika.
📐 Dzięki połączeniom gwintowym i prototypowaniu różnych kształtów siatek zabezpieczających mogliśmy dopracować konstrukcję tak, aby mikrofon zachował odpowiednią charakterystykę pracy z dźwiękiem.
🔥 Poczuj głębie niskiego pasma! Sprawdź MidSub na naszej stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1vySHBFyUTUzJ-7mB0nZF_Rfmvvt8fqsx',
   null,
   null,
   'video'),
  ('2db22ccf-20f0-5950-9138-85023488b272',
   'c01403c4-a2c6-53dd-8314-229c1b664768',
   'tiktok',
   'Niski dźwięk, wysoka precyzja - poznaj mikrofon, który rozumie niskie dźwięki. 
🎙️ MidSub powstał z myślą o rejestracji niższego pasma - tam, gdzie liczy się ciężar, głębia i solidny fundament brzmienia.
🛠️ Podczas projektowania skupiliśmy się na kompatybilności komponentów, łatwym montażu oraz maksymalnym ograniczeniu wpływu obudowy na naturalną pracę przetwornika.
📐 Dzięki połączeniom gwintowym i prototypowaniu różnych kształtów siatek zabezpieczających mogliśmy dopracować konstrukcję tak, aby mikrofon zachował odpowiednią charakterystykę pracy z dźwiękiem.
🔥 Poczuj głębie niskiego pasma! Sprawdź MidSub na naszej stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1vySHBFyUTUzJ-7mB0nZF_Rfmvvt8fqsx',
   null,
   null,
   'video'),
  ('9240fdc3-721a-509d-bd11-2721ae5aea61',
   '33bc3f8d-4fe9-5ec5-ae7f-b2fa0d77f940',
   'instagram',
   '🎙️ Dobry setup mikrofonowy zaczyna się od precyzyjnego ustawienia. Uchwyty Tetra Wave Solutions powstały po to, aby mikrofon pozostał dokładnie tam, gdzie powinien - przez całą długość nagrania.
📐 Każdy model ma własną geometrię oraz odpowiednie nachylenie gniazd, dopasowane do konkretnej techniki mikrofonowania. Od konfiguracji stereo XY i ORTF, przez mikrofonowanie kolumn gitarowych metodą Fredmana, aż po precyzyjne ustawienie mikrofonu przy werblu z użyciem Snare Clip.
🛠️ Druk 3D pozwala zachować wysoką precyzję pasowania dla wielu modeli mikrofonów oraz uzyskać charakterystyczny „klik”, który potwierdza ich stabilne osadzenie w uchwycie.
💡 W mikrofonowaniu nawet niewielka zmiana kąta może wpłynąć na odbiór brzmienia i relację fazową między mikrofonami. Dlatego nasze uchwyty pomagają odtwarzać ustawienie z dokładnością, której trudno oczekiwać przy ręcznym pozycjonowaniu mikrofonów.
🔥 Ustaw swój setup dokładnie tak, jak chcesz go słyszeć. Sprawdź uchwyty mikrofonowe Tetra Wave Solutions na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1VGflfh2QN6sOu5tQOuY7cMFPi1Oa4EGd',
   null,
   null,
   'image'),
  ('c0ae277b-7a4a-581f-a6d8-195a98e5622b',
   '33bc3f8d-4fe9-5ec5-ae7f-b2fa0d77f940',
   'facebook',
   '🎙️ Dobry setup mikrofonowy zaczyna się od precyzyjnego ustawienia. Uchwyty Tetra Wave Solutions powstały po to, aby mikrofon pozostał dokładnie tam, gdzie powinien - przez całą długość nagrania.
📐 Każdy model ma własną geometrię oraz odpowiednie nachylenie gniazd, dopasowane do konkretnej techniki mikrofonowania. Od konfiguracji stereo XY i ORTF, przez mikrofonowanie kolumn gitarowych metodą Fredmana, aż po precyzyjne ustawienie mikrofonu przy werblu z użyciem Snare Clip.
🛠️ Druk 3D pozwala zachować wysoką precyzję pasowania dla wielu modeli mikrofonów oraz uzyskać charakterystyczny „klik”, który potwierdza ich stabilne osadzenie w uchwycie.
💡 W mikrofonowaniu nawet niewielka zmiana kąta może wpłynąć na odbiór brzmienia i relację fazową między mikrofonami. Dlatego nasze uchwyty pomagają odtwarzać ustawienie z dokładnością, której trudno oczekiwać przy ręcznym pozycjonowaniu mikrofonów.
🔥 Ustaw swój setup dokładnie tak, jak chcesz go słyszeć. Sprawdź uchwyty mikrofonowe Tetra Wave Solutions na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1VGflfh2QN6sOu5tQOuY7cMFPi1Oa4EGd',
   null,
   null,
   'image'),
  ('001e3a49-e826-544e-8efb-82c5031b6e5e',
   'a6d9b88f-a48a-523e-8890-c7100f019d50',
   'instagram',
   'Nie każdy bohater studia wydaje dźwięk. Niektórzy po prostu trzymają mikrofon. 
🛠️ Uchwyty XY, ORTF, Fredman i Snare Clip powstały po to, aby mikrofon pozostał dokładnie tam, gdzie powinien - przez całą długość nagrania.
📐 Każdy z nich posiada inną geometrię oraz nachylenie gniazda, dopasowane do konkretnej techniki mikrofonowania. Dzięki temu łatwiej zachować powtarzalność ustawienia i kontrolę nad brzmieniem.
🔩 Druk 3D pozwolił nam uzyskać wysoką precyzję pasowania dla wielu modeli mikrofonów oraz charakterystyczny „klik”, który potwierdza stabilne osadzenie w uchwycie.
🔥 Ustaw mikrofon raz, nagrywaj pewnie już zawsze! Sprawdź nasze uchwyty na stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1pzt1c8apN_41tEDCHwzatC2KlBi3JEce',
   null,
   null,
   'video'),
  ('1740587c-afab-552c-bddc-36e6346472d1',
   'a6d9b88f-a48a-523e-8890-c7100f019d50',
   'facebook',
   'Nie każdy bohater studia wydaje dźwięk. Niektórzy po prostu trzymają mikrofon. 
🛠️ Uchwyty XY, ORTF, Fredman i Snare Clip powstały po to, aby mikrofon pozostał dokładnie tam, gdzie powinien - przez całą długość nagrania.
📐 Każdy z nich posiada inną geometrię oraz nachylenie gniazda, dopasowane do konkretnej techniki mikrofonowania. Dzięki temu łatwiej zachować powtarzalność ustawienia i kontrolę nad brzmieniem.
🔩 Druk 3D pozwolił nam uzyskać wysoką precyzję pasowania dla wielu modeli mikrofonów oraz charakterystyczny „klik”, który potwierdza stabilne osadzenie w uchwycie.
🔥 Ustaw mikrofon raz, nagrywaj pewnie już zawsze! Sprawdź nasze uchwyty na stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1pzt1c8apN_41tEDCHwzatC2KlBi3JEce',
   null,
   null,
   'video'),
  ('ae46312c-0971-52de-b8b9-845fcdb622a2',
   'a6d9b88f-a48a-523e-8890-c7100f019d50',
   'tiktok',
   'Nie każdy bohater studia wydaje dźwięk. Niektórzy po prostu trzymają mikrofon. 
🛠️ Uchwyty XY, ORTF, Fredman i Snare Clip powstały po to, aby mikrofon pozostał dokładnie tam, gdzie powinien - przez całą długość nagrania.
📐 Każdy z nich posiada inną geometrię oraz nachylenie gniazda, dopasowane do konkretnej techniki mikrofonowania. Dzięki temu łatwiej zachować powtarzalność ustawienia i kontrolę nad brzmieniem.
🔩 Druk 3D pozwolił nam uzyskać wysoką precyzję pasowania dla wielu modeli mikrofonów oraz charakterystyczny „klik”, który potwierdza stabilne osadzenie w uchwycie.
🔥 Ustaw mikrofon raz, nagrywaj pewnie już zawsze! Sprawdź nasze uchwyty na stronie.',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1pzt1c8apN_41tEDCHwzatC2KlBi3JEce',
   null,
   null,
   'video'),
  ('def964d1-8540-5cb1-9c24-2dee93990597',
   '378f9ff4-8af4-52ff-9001-fb1f1b947ab2',
   'instagram',
   '🛠️ Nie lubimy ograniczeń - preferujemy kreatywne dopasowanie.
📐 W Tetra Wave Solutions możemy modyfikować wybrane produkty pod inne modele mikrofonów, mikserów lub elementów setupu. Nie zawsze trzeba projektować wszystko od zera - czasem wystarczy zmienić wymiar, rozstaw mocowań, kąt, średnicę albo sposób montażu.
🎙️ Dzięki temu akcesorium może lepiej odpowiadać konkretnym warunkom pracy i sprzętowi, z którego korzystasz na co dzień.
🔥 Masz produkt, który jest prawie idealny, ale wymaga dopasowania? Wypełnij formularz na naszej stronie- tetrawavesolutions.pl. Opisz, czego szukasz, podaj model sprzętu i pozwól nam działać!',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1l1j3oIi01Gdv4kGF5c2ZXWmi1FicvNCd',
   null,
   null,
   'image'),
  ('47d8cb53-17ee-5518-a1e9-8f3f92804a3f',
   '378f9ff4-8af4-52ff-9001-fb1f1b947ab2',
   'facebook',
   '🛠️ Nie lubimy ograniczeń - preferujemy kreatywne dopasowanie.
📐 W Tetra Wave Solutions możemy modyfikować wybrane produkty pod inne modele mikrofonów, mikserów lub elementów setupu. Nie zawsze trzeba projektować wszystko od zera - czasem wystarczy zmienić wymiar, rozstaw mocowań, kąt, średnicę albo sposób montażu.
🎙️ Dzięki temu akcesorium może lepiej odpowiadać konkretnym warunkom pracy i sprzętowi, z którego korzystasz na co dzień.
🔥 Masz produkt, który jest prawie idealny, ale wymaga dopasowania? Wypełnij formularz na naszej stronie- tetrawavesolutions.pl. Opisz, czego szukasz, podaj model sprzętu i pozwól nam działać!',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1l1j3oIi01Gdv4kGF5c2ZXWmi1FicvNCd',
   null,
   null,
   'image'),
  ('a1fb07c5-64ca-580f-ae05-e8a8f8ebce25',
   'f16252b9-037a-5713-af21-014488dc9680',
   'instagram',
   '🛠️Standardowy uchwyt nie pasuje? To jeszcze nie koniec tematu.
📐 W Tetra Wave Solutions możemy modyfikować wybrane produkty pod inne modele mikrofonów, mikserów lub elementów setupu. Nie zawsze trzeba zaczynać od zera - czasem wystarczy dobrze dopasować istniejące rozwiązanie.
🎙️ Dzięki drukowi 3D możemy elastycznie zmieniać wybrane elementy, takie jak wymiary, rozstaw mocowań, średnicę, kąt albo sposób montażu.Na start wystarczy informacja, który produkt Cię interesuje, z jakim sprzętem chcesz go połączyć oraz kilka zdjęć, podstawowe wymiary lub model urządzenia.
🔥 Jeśli produkt jest prawie idealny, ale wymaga dopasowania pod Twój setup - odezwij się do nas przez formularz na stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1l_EGlo2uq07rxv_17CsyiMbFCeJizJSF',
   null,
   null,
   'video'),
  ('28412792-8f86-5af1-96f7-a9373dd57e20',
   'f16252b9-037a-5713-af21-014488dc9680',
   'facebook',
   '🛠️Standardowy uchwyt nie pasuje? To jeszcze nie koniec tematu.
📐 W Tetra Wave Solutions możemy modyfikować wybrane produkty pod inne modele mikrofonów, mikserów lub elementów setupu. Nie zawsze trzeba zaczynać od zera - czasem wystarczy dobrze dopasować istniejące rozwiązanie.
🎙️ Dzięki drukowi 3D możemy elastycznie zmieniać wybrane elementy, takie jak wymiary, rozstaw mocowań, średnicę, kąt albo sposób montażu.Na start wystarczy informacja, który produkt Cię interesuje, z jakim sprzętem chcesz go połączyć oraz kilka zdjęć, podstawowe wymiary lub model urządzenia.
🔥 Jeśli produkt jest prawie idealny, ale wymaga dopasowania pod Twój setup - odezwij się do nas przez formularz na stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1l_EGlo2uq07rxv_17CsyiMbFCeJizJSF',
   null,
   null,
   'video'),
  ('35dcfca4-20eb-5bce-87d4-7a92ccb28048',
   'f16252b9-037a-5713-af21-014488dc9680',
   'tiktok',
   '🛠️Standardowy uchwyt nie pasuje? To jeszcze nie koniec tematu.
📐 W Tetra Wave Solutions możemy modyfikować wybrane produkty pod inne modele mikrofonów, mikserów lub elementów setupu. Nie zawsze trzeba zaczynać od zera - czasem wystarczy dobrze dopasować istniejące rozwiązanie.
🎙️ Dzięki drukowi 3D możemy elastycznie zmieniać wybrane elementy, takie jak wymiary, rozstaw mocowań, średnicę, kąt albo sposób montażu.Na start wystarczy informacja, który produkt Cię interesuje, z jakim sprzętem chcesz go połączyć oraz kilka zdjęć, podstawowe wymiary lub model urządzenia.
🔥 Jeśli produkt jest prawie idealny, ale wymaga dopasowania pod Twój setup - odezwij się do nas przez formularz na stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1l_EGlo2uq07rxv_17CsyiMbFCeJizJSF',
   null,
   null,
   'video'),
  ('4ac7bdc4-54cf-5684-a2bf-ba44dbd284fc',
   '1a8b9735-4486-571d-939b-63ce9b3c13b0',
   'instagram',
   '🎙️ Ribbon Mount to uchwyt do konfiguracji Mid-Side, który pomaga uporządkować pracę z dwoma mikrofonami i szybciej odtworzyć właściwe ustawienie podczas kolejnych nagrań.
🛠️ Uchwyt stabilnie łączy mikrofony w jednej konstrukcji, dzięki czemu cały setup pozostaje czytelny, trwały i powtarzalny - bez przypadkowego przesuwania się pozycji w trakcie sesji.
📐 To rozwiązanie stworzone z myślą o większej wygodzie pracy, precyzji ustawienia i powtarzalności, które mają realne znaczenie podczas nagrań wymagających dokładnego odwzorowania konfiguracji mikrofonowej.
🔥 Bo stabilność zaczyna się od dobrego uchwytu. Sprawdź Ribbon Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1KdONvn9IgWY-gXqr_XfWTdA74Kp7306T',
   null,
   null,
   'image'),
  ('d71f1e09-b66f-5ceb-9b5f-890686d9997e',
   '1a8b9735-4486-571d-939b-63ce9b3c13b0',
   'facebook',
   '🎙️ Ribbon Mount to uchwyt do konfiguracji Mid-Side, który pomaga uporządkować pracę z dwoma mikrofonami i szybciej odtworzyć właściwe ustawienie podczas kolejnych nagrań.
🛠️ Uchwyt stabilnie łączy mikrofony w jednej konstrukcji, dzięki czemu cały setup pozostaje czytelny, trwały i powtarzalny - bez przypadkowego przesuwania się pozycji w trakcie sesji.
📐 To rozwiązanie stworzone z myślą o większej wygodzie pracy, precyzji ustawienia i powtarzalności, które mają realne znaczenie podczas nagrań wymagających dokładnego odwzorowania konfiguracji mikrofonowej.
🔥 Bo stabilność zaczyna się od dobrego uchwytu. Sprawdź Ribbon Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1KdONvn9IgWY-gXqr_XfWTdA74Kp7306T',
   null,
   null,
   'image'),
  ('0f85af47-a0de-5260-a713-6af89351cef9',
   '26168e27-4ac7-5647-bcb5-4d2707de6dff',
   'instagram',
   '🎙️ Dwa mikrofony, jedna konfiguracja i zdecydowanie mniej przypadkowości w ustawieniu.
📐 Ribbon Mount powstał z myślą o pracy w technice Mid-Side, gdzie liczy się precyzyjne ułożenie mikrofonów, stabilność oraz możliwość szybkiego odtworzenia setupu przy kolejnych nagraniach.
🛠️ Konstrukcja opiera się na dwóch dopasowanych elementach, które łączą się ze sobą w trwały i prosty sposób. Dzięki temu uchwyt jest wygodny i stabilny w użyciu.
🔥 Podział na dwa komponenty pozwala też ograniczyć potrzebę stosowania podpór w druku 3D. Efekt? Gładsze powierzchnie, mniej obróbki końcowej i mniejsze ryzyko uszkodzenia detalu.
Sprawdź Ribbon Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1r9ttJcjCGqwtANKY2iE4pd6qcUGnvzyW',
   null,
   null,
   'video'),
  ('2c14cbbf-82a1-5bf3-9352-4bc39c432c2a',
   '26168e27-4ac7-5647-bcb5-4d2707de6dff',
   'facebook',
   '🎙️ Dwa mikrofony, jedna konfiguracja i zdecydowanie mniej przypadkowości w ustawieniu.
📐 Ribbon Mount powstał z myślą o pracy w technice Mid-Side, gdzie liczy się precyzyjne ułożenie mikrofonów, stabilność oraz możliwość szybkiego odtworzenia setupu przy kolejnych nagraniach.
🛠️ Konstrukcja opiera się na dwóch dopasowanych elementach, które łączą się ze sobą w trwały i prosty sposób. Dzięki temu uchwyt jest wygodny i stabilny w użyciu.
🔥 Podział na dwa komponenty pozwala też ograniczyć potrzebę stosowania podpór w druku 3D. Efekt? Gładsze powierzchnie, mniej obróbki końcowej i mniejsze ryzyko uszkodzenia detalu.
Sprawdź Ribbon Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1r9ttJcjCGqwtANKY2iE4pd6qcUGnvzyW',
   null,
   null,
   'video'),
  ('3ac07a99-9875-543c-ad9c-1f3dd3181c26',
   '26168e27-4ac7-5647-bcb5-4d2707de6dff',
   'tiktok',
   '🎙️ Dwa mikrofony, jedna konfiguracja i zdecydowanie mniej przypadkowości w ustawieniu.
📐 Ribbon Mount powstał z myślą o pracy w technice Mid-Side, gdzie liczy się precyzyjne ułożenie mikrofonów, stabilność oraz możliwość szybkiego odtworzenia setupu przy kolejnych nagraniach.
🛠️ Konstrukcja opiera się na dwóch dopasowanych elementach, które łączą się ze sobą w trwały i prosty sposób. Dzięki temu uchwyt jest wygodny i stabilny w użyciu.
🔥 Podział na dwa komponenty pozwala też ograniczyć potrzebę stosowania podpór w druku 3D. Efekt? Gładsze powierzchnie, mniej obróbki końcowej i mniejsze ryzyko uszkodzenia detalu.
Sprawdź Ribbon Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1r9ttJcjCGqwtANKY2iE4pd6qcUGnvzyW',
   null,
   null,
   'video'),
  ('1d4d75ba-cda6-5575-9758-62dee2425a24',
   'ae4934cc-404c-5173-a464-d3d6b73b0125',
   'instagram',
   '🔌 Cable Wall Mount to techniczny uchwyt ścienny zaprojektowany z myślą o uporządkowanym przechowywaniu luźnych kabli audio, zasilających i sygnałowych.
🛠️ Konstrukcja została opracowana tak, aby zachowywać stabilność również przy większym obciążeniu i nie opadać pod ciężarem zwiniętych przewodów. Dzięki temu uchwyt sprawdza się wszędzie tam, gdzie liczy się porządek, wygoda i dobre wykorzystanie przestrzeni.
📐 Odpowiednio dobrana szerokość pozwala lepiej zagospodarować miejsce na ścianie, a prosty system montażu ułatwia dopasowanie uchwytu do studia, sali prób lub zaplecza technicznego.
🔥 Uporządkuj kable bez zajmowania cennej przestrzeni. Sprawdź Cable Wall Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1c69SAyNuDaqqMvZ4iQlKUNDJSB31Yofp',
   null,
   null,
   'image'),
  ('7fa2eb8e-a748-556c-89a1-eb26a11de218',
   'ae4934cc-404c-5173-a464-d3d6b73b0125',
   'facebook',
   '🔌 Cable Wall Mount to techniczny uchwyt ścienny zaprojektowany z myślą o uporządkowanym przechowywaniu luźnych kabli audio, zasilających i sygnałowych.
🛠️ Konstrukcja została opracowana tak, aby zachowywać stabilność również przy większym obciążeniu i nie opadać pod ciężarem zwiniętych przewodów. Dzięki temu uchwyt sprawdza się wszędzie tam, gdzie liczy się porządek, wygoda i dobre wykorzystanie przestrzeni.
📐 Odpowiednio dobrana szerokość pozwala lepiej zagospodarować miejsce na ścianie, a prosty system montażu ułatwia dopasowanie uchwytu do studia, sali prób lub zaplecza technicznego.
🔥 Uporządkuj kable bez zajmowania cennej przestrzeni. Sprawdź Cable Wall Mount i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1c69SAyNuDaqqMvZ4iQlKUNDJSB31Yofp',
   null,
   null,
   'image'),
  ('e2129fab-8528-5008-86c8-e2260d7f8e8c',
   '6759c140-cd80-50fa-93d7-c1b985618148',
   'instagram',
   '🔌 Kable nie muszą leżeć na ziemi, plątać się pod nogami ani zajmować miejsca na stanowisku.
🛠️ Cable Wall Mount to ścienny uchwyt techniczny zaprojektowany do przechowywania kabli audio, zasilających i sygnałowych.
📐 Konstrukcja została opracowana tak, aby zachowywać stabilność pod obciążeniem i lepiej radzić sobie z naprężeniami. Dzięki odpowiednio dobranej szerokości pozwala wygodnie wykorzystać przestrzeń na ścianie - w studiu, sali prób, magazynie lub na zapleczu technicznym.
🔥 Zorganizuj kable z pomocą wyłącznie ściany - sprawdź Cable Wall Mount na naszej stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1IpfZ4Io_sSIoDcT9CeNNlJk-mudIKn-A',
   null,
   null,
   'video'),
  ('e790479b-230f-5de5-ba54-632b759677ae',
   '6759c140-cd80-50fa-93d7-c1b985618148',
   'facebook',
   '🔌 Kable nie muszą leżeć na ziemi, plątać się pod nogami ani zajmować miejsca na stanowisku.
🛠️ Cable Wall Mount to ścienny uchwyt techniczny zaprojektowany do przechowywania kabli audio, zasilających i sygnałowych.
📐 Konstrukcja została opracowana tak, aby zachowywać stabilność pod obciążeniem i lepiej radzić sobie z naprężeniami. Dzięki odpowiednio dobranej szerokości pozwala wygodnie wykorzystać przestrzeń na ścianie - w studiu, sali prób, magazynie lub na zapleczu technicznym.
🔥 Zorganizuj kable z pomocą wyłącznie ściany - sprawdź Cable Wall Mount na naszej stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1IpfZ4Io_sSIoDcT9CeNNlJk-mudIKn-A',
   null,
   null,
   'video'),
  ('db743e82-b13c-54a7-a66a-c08787b31ef9',
   '6759c140-cd80-50fa-93d7-c1b985618148',
   'tiktok',
   '🔌 Kable nie muszą leżeć na ziemi, plątać się pod nogami ani zajmować miejsca na stanowisku.
🛠️ Cable Wall Mount to ścienny uchwyt techniczny zaprojektowany do przechowywania kabli audio, zasilających i sygnałowych.
📐 Konstrukcja została opracowana tak, aby zachowywać stabilność pod obciążeniem i lepiej radzić sobie z naprężeniami. Dzięki odpowiednio dobranej szerokości pozwala wygodnie wykorzystać przestrzeń na ścianie - w studiu, sali prób, magazynie lub na zapleczu technicznym.
🔥 Zorganizuj kable z pomocą wyłącznie ściany - sprawdź Cable Wall Mount na naszej stronie: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1IpfZ4Io_sSIoDcT9CeNNlJk-mudIKn-A',
   null,
   null,
   'video'),
  ('239556fc-4a3c-5263-bcc5-8a36bec190b2',
   '14610be4-39f0-50e1-b67a-de69058c8a03',
   'instagram',
   '🛠️ Wymyśliłeś coś, czego nie ma na rynku? Custom Shop to miejsce, w którym pomagamy przejść od pomysłu do fizycznego produktu.
📐 Możesz zgłosić się do nas z koncepcją akcesorium, obudowy, elementu technicznego, części do sprzętu albo zupełnie niestandardowego rozwiązania.
🎙️ Na start przydadzą się zdjęcia, podstawowe wymiary i informacja o tym, jak dany element ma być używany. Na tej podstawie omawiamy możliwości techniczne, dobieramy kierunek wykonania i pomagamy dopracować funkcję, kształt oraz materiał.
⚙️ W zależności od potrzeb możemy przygotować projekt, prototyp, pojedynczy detal albo punkt wyjścia do większego produktu.
🔥 Masz pomysł, ale brakuje Ci zaplecza technicznego? Zgłoś swój projekt w Custom Shopie na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1AiLPpfGgXi_g7hfcdd6J3vb8XyAzh-W0',
   null,
   null,
   'image'),
  ('a9d84fb9-bfb4-5209-812c-1ce891d07626',
   '14610be4-39f0-50e1-b67a-de69058c8a03',
   'facebook',
   '🛠️ Wymyśliłeś coś, czego nie ma na rynku? Custom Shop to miejsce, w którym pomagamy przejść od pomysłu do fizycznego produktu.
📐 Możesz zgłosić się do nas z koncepcją akcesorium, obudowy, elementu technicznego, części do sprzętu albo zupełnie niestandardowego rozwiązania.
🎙️ Na start przydadzą się zdjęcia, podstawowe wymiary i informacja o tym, jak dany element ma być używany. Na tej podstawie omawiamy możliwości techniczne, dobieramy kierunek wykonania i pomagamy dopracować funkcję, kształt oraz materiał.
⚙️ W zależności od potrzeb możemy przygotować projekt, prototyp, pojedynczy detal albo punkt wyjścia do większego produktu.
🔥 Masz pomysł, ale brakuje Ci zaplecza technicznego? Zgłoś swój projekt w Custom Shopie na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1AiLPpfGgXi_g7hfcdd6J3vb8XyAzh-W0',
   null,
   null,
   'image'),
  ('c7d511f9-8d6d-5d29-97e6-7d4d681414d6',
   '07369e1d-2ec5-5add-836c-c4a8f17aeaf2',
   'instagram',
   '🛠️ Masz pomysł na produkt, akcesorium, obudowę albo element techniczny, którego nie możesz znaleźć na rynku?
📐 W Custom Shopie Tetra Wave Solutions pomagamy przełożyć koncepcję na realny, fizyczny detal - od luźnego pomysłu, przez projekt i prototyp, aż po gotowe rozwiązanie.
🎙️ Na start wystarczy kilka podstawowych informacji: zdjęcia, wymiary, opis zastosowania i informacja, jak dany element ma pracować w Twoim setupie. Potem omawiamy szczegóły i sprawdzamy, jak najlepiej podejść do projektu technicznie.
⚙️ Możemy pomóc dopracować kształt, funkcję, materiał oraz sposób wykonania - niezależnie od tego, czy potrzebujesz pojedynczego elementu, części do sprzętu, akcesorium czy punktu wyjścia do większego produktu.
🔥 Opowiedz nam, co chcesz stworzyć, a my pomożemy zamienić pomysł w gotowy produkt. Zgłoś projekt w Custom Shopie na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1GM9KgwJm1PDf-ExTLKYrFkotfaVPbBiH',
   null,
   null,
   'video'),
  ('4ee303f4-794c-5f17-8302-4d26595fc3a5',
   '07369e1d-2ec5-5add-836c-c4a8f17aeaf2',
   'facebook',
   '🛠️ Masz pomysł na produkt, akcesorium, obudowę albo element techniczny, którego nie możesz znaleźć na rynku?
📐 W Custom Shopie Tetra Wave Solutions pomagamy przełożyć koncepcję na realny, fizyczny detal - od luźnego pomysłu, przez projekt i prototyp, aż po gotowe rozwiązanie.
🎙️ Na start wystarczy kilka podstawowych informacji: zdjęcia, wymiary, opis zastosowania i informacja, jak dany element ma pracować w Twoim setupie. Potem omawiamy szczegóły i sprawdzamy, jak najlepiej podejść do projektu technicznie.
⚙️ Możemy pomóc dopracować kształt, funkcję, materiał oraz sposób wykonania - niezależnie od tego, czy potrzebujesz pojedynczego elementu, części do sprzętu, akcesorium czy punktu wyjścia do większego produktu.
🔥 Opowiedz nam, co chcesz stworzyć, a my pomożemy zamienić pomysł w gotowy produkt. Zgłoś projekt w Custom Shopie na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1GM9KgwJm1PDf-ExTLKYrFkotfaVPbBiH',
   null,
   null,
   'video'),
  ('0ca079a6-dcde-5f56-a00c-7206635bf010',
   '07369e1d-2ec5-5add-836c-c4a8f17aeaf2',
   'tiktok',
   '🛠️ Masz pomysł na produkt, akcesorium, obudowę albo element techniczny, którego nie możesz znaleźć na rynku?
📐 W Custom Shopie Tetra Wave Solutions pomagamy przełożyć koncepcję na realny, fizyczny detal - od luźnego pomysłu, przez projekt i prototyp, aż po gotowe rozwiązanie.
🎙️ Na start wystarczy kilka podstawowych informacji: zdjęcia, wymiary, opis zastosowania i informacja, jak dany element ma pracować w Twoim setupie. Potem omawiamy szczegóły i sprawdzamy, jak najlepiej podejść do projektu technicznie.
⚙️ Możemy pomóc dopracować kształt, funkcję, materiał oraz sposób wykonania - niezależnie od tego, czy potrzebujesz pojedynczego elementu, części do sprzętu, akcesorium czy punktu wyjścia do większego produktu.
🔥 Opowiedz nam, co chcesz stworzyć, a my pomożemy zamienić pomysł w gotowy produkt. Zgłoś projekt w Custom Shopie na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1GM9KgwJm1PDf-ExTLKYrFkotfaVPbBiH',
   null,
   null,
   'video'),
  ('42b46d21-4dcc-5962-8d98-c985bf174068',
   'bb040230-3b5e-53b5-bdcc-c8b8d7b19b31',
   'instagram',
   '🎤 Dual Clip to klips montowany na statywie mikrofonowym, który pomaga uporządkować prowadzenie dwóch lub trzech przewodów w jednym miejscu.
🔌 To proste rozwiązanie ogranicza plątaninę kabli, poprawia bezpieczeństwo pracy i sprawia, że całe stanowisko wygląda bardziej profesjonalnie - zarówno w studiu, jak i podczas realizacji scenicznych.
🛠️ Dzięki dopasowaniu do średnicy statywu oraz sposobu prowadzenia przewodów, klips stabilnie utrzymuje kable bez ich nadmiernego ściskania. To praktyczny detal, który realnie poprawia organizację pracy.
🔥 Prowadź kable pewnie i bez chaosu. Sprawdź Dual Clip oraz pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '10TNuUj_fg_-bIVPZLrN8ykikHqNXdrgI',
   null,
   null,
   'image'),
  ('8017aaeb-af8b-5f89-886f-0de3d7157d46',
   'bb040230-3b5e-53b5-bdcc-c8b8d7b19b31',
   'facebook',
   '🎤 Dual Clip to klips montowany na statywie mikrofonowym, który pomaga uporządkować prowadzenie dwóch lub trzech przewodów w jednym miejscu.
🔌 To proste rozwiązanie ogranicza plątaninę kabli, poprawia bezpieczeństwo pracy i sprawia, że całe stanowisko wygląda bardziej profesjonalnie - zarówno w studiu, jak i podczas realizacji scenicznych.
🛠️ Dzięki dopasowaniu do średnicy statywu oraz sposobu prowadzenia przewodów, klips stabilnie utrzymuje kable bez ich nadmiernego ściskania. To praktyczny detal, który realnie poprawia organizację pracy.
🔥 Prowadź kable pewnie i bez chaosu. Sprawdź Dual Clip oraz pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '10TNuUj_fg_-bIVPZLrN8ykikHqNXdrgI',
   null,
   null,
   'image'),
  ('ab320efe-d0c7-5001-877c-19b8669f6908',
   'ba13cf2c-d52a-58c5-baa9-5731f2238611',
   'instagram',
   '🎤 Mały element, który potrafi uporządkować cały setup.
🔌 Dual Clip pomaga prowadzić przewody przy statywie mikrofonowym tak, żeby stanowisko było czystsze, wygodniejsze i bezpieczniejsze w codziennej pracy.
🛠️ Sprawdza się podczas nagrań, prób i realizacji live - szczególnie tam, gdzie przy jednym statywie pojawia się kilka kabli, które łatwo zaczynają żyć własnym życiem.
📐 W jego konstrukcji liczy się nie tylko kształt, ale też odpowiednia sprężystość. Dlatego parametry druku dobieramy tak, aby klips wygodnie trzymał przewody, ale nie pękał przy regularnym użytkowaniu.
🔥 Mniej chaosu przy statywie, więcej kontroli nad setupem. Sprawdź Dual Clip na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '16eAL172o8IbYS4AdI9EX4oFD9NrX99ct',
   null,
   null,
   'video'),
  ('23eb3ce5-f9c9-5c5d-ad52-c65ea4a3b600',
   'ba13cf2c-d52a-58c5-baa9-5731f2238611',
   'facebook',
   '🎤 Mały element, który potrafi uporządkować cały setup.
🔌 Dual Clip pomaga prowadzić przewody przy statywie mikrofonowym tak, żeby stanowisko było czystsze, wygodniejsze i bezpieczniejsze w codziennej pracy.
🛠️ Sprawdza się podczas nagrań, prób i realizacji live - szczególnie tam, gdzie przy jednym statywie pojawia się kilka kabli, które łatwo zaczynają żyć własnym życiem.
📐 W jego konstrukcji liczy się nie tylko kształt, ale też odpowiednia sprężystość. Dlatego parametry druku dobieramy tak, aby klips wygodnie trzymał przewody, ale nie pękał przy regularnym użytkowaniu.
🔥 Mniej chaosu przy statywie, więcej kontroli nad setupem. Sprawdź Dual Clip na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '16eAL172o8IbYS4AdI9EX4oFD9NrX99ct',
   null,
   null,
   'video'),
  ('25c9a348-a530-5863-b309-20520747be39',
   'ba13cf2c-d52a-58c5-baa9-5731f2238611',
   'tiktok',
   '🎤 Mały element, który potrafi uporządkować cały setup.
🔌 Dual Clip pomaga prowadzić przewody przy statywie mikrofonowym tak, żeby stanowisko było czystsze, wygodniejsze i bezpieczniejsze w codziennej pracy.
🛠️ Sprawdza się podczas nagrań, prób i realizacji live - szczególnie tam, gdzie przy jednym statywie pojawia się kilka kabli, które łatwo zaczynają żyć własnym życiem.
📐 W jego konstrukcji liczy się nie tylko kształt, ale też odpowiednia sprężystość. Dlatego parametry druku dobieramy tak, aby klips wygodnie trzymał przewody, ale nie pękał przy regularnym użytkowaniu.
🔥 Mniej chaosu przy statywie, więcej kontroli nad setupem. Sprawdź Dual Clip na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '16eAL172o8IbYS4AdI9EX4oFD9NrX99ct',
   null,
   null,
   'video'),
  ('dc269c4f-15a6-5098-8d57-e15d309b06dc',
   '110751ab-f664-55d5-8193-39f68fdba7a5',
   'instagram',
   '🎛️ MixMount Shelf to uchwyt ścienny zaprojektowany z myślą o pełnej kompatybilności z mikserem osobistym Behringer P16.
🛠️ Stabilna pozycja urządzenia, szybki dostęp do kontrolerów i lepsze wykorzystanie dostępnej przestrzeni sprawiają, że cały setup staje się bardziej ergonomiczny - zarówno na scenie, w sali prób, jak i w studiu.
📐 Uchwyt pozwala wygodnie umieścić mikser w stałym, łatwo dostępnym miejscu, bez zajmowania dodatkowej przestrzeni na statywach, stołach czy stanowisku realizatorskim.
💡 Dzięki technologii druku 3D mogliśmy precyzyjnie prototypować kształt podstawy oraz sposób jej połączenia z uchwytem do konsoli P16. Każdy element został dopasowany co do milimetra, aby urządzenie stabilnie współpracowało z całą konstrukcją.
🔥 Zadbaj o wygodny dostęp do swojego miksera - bez zajmowania dodatkowej przestrzeni. Sprawdź MixMount Shelf i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1vWbA-yIgAd08GRiRRhXfCyY3CRTtY1Jp',
   null,
   null,
   'image'),
  ('828839fd-cf8d-556a-95fa-938c51cba947',
   '110751ab-f664-55d5-8193-39f68fdba7a5',
   'facebook',
   '🎛️ MixMount Shelf to uchwyt ścienny zaprojektowany z myślą o pełnej kompatybilności z mikserem osobistym Behringer P16.
🛠️ Stabilna pozycja urządzenia, szybki dostęp do kontrolerów i lepsze wykorzystanie dostępnej przestrzeni sprawiają, że cały setup staje się bardziej ergonomiczny - zarówno na scenie, w sali prób, jak i w studiu.
📐 Uchwyt pozwala wygodnie umieścić mikser w stałym, łatwo dostępnym miejscu, bez zajmowania dodatkowej przestrzeni na statywach, stołach czy stanowisku realizatorskim.
💡 Dzięki technologii druku 3D mogliśmy precyzyjnie prototypować kształt podstawy oraz sposób jej połączenia z uchwytem do konsoli P16. Każdy element został dopasowany co do milimetra, aby urządzenie stabilnie współpracowało z całą konstrukcją.
🔥 Zadbaj o wygodny dostęp do swojego miksera - bez zajmowania dodatkowej przestrzeni. Sprawdź MixMount Shelf i pozostałe rozwiązania na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1vWbA-yIgAd08GRiRRhXfCyY3CRTtY1Jp',
   null,
   null,
   'image'),
  ('fb72a160-7e90-551d-81e6-4a2e498c734a',
   '23c855ac-f1a7-5b7a-9617-295761189513',
   'instagram',
   '🎛️ Mikser na ścianie, przestrzeń odzyskana, setup bardziej uporządkowany.
🛠️ MixMount Shelf pozwala zamocować Behringer P16 na ścianie, dzięki czemu urządzenie ma swoje stałe miejsce i nie zajmuje dodatkowej przestrzeni na stanowisku.
📐 To rozwiązanie stworzone z myślą o setupach, w których liczy się porządek, ergonomia i szybka kontrola nad ustawieniami - w studiu, sali prób albo w magazynie.
⚙️ Dzięki drukowi 3D mogliśmy precyzyjnie dopracować kształt podstawy oraz sposób połączenia z uchwytem, tak aby całość była stabilna i dobrze spasowana z mikserem.
🔥 Mniej szukania sprzętu, więcej wygody w pracy. Sprawdź MixMount Shelf na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '18q7Z1ZTp0xuOkuaaFbuDe5s70MnaekfT',
   null,
   null,
   'video'),
  ('4fd06735-9028-53c3-aa96-924ab0d219a7',
   '23c855ac-f1a7-5b7a-9617-295761189513',
   'facebook',
   '🎛️ Mikser na ścianie, przestrzeń odzyskana, setup bardziej uporządkowany.
🛠️ MixMount Shelf pozwala zamocować Behringer P16 na ścianie, dzięki czemu urządzenie ma swoje stałe miejsce i nie zajmuje dodatkowej przestrzeni na stanowisku.
📐 To rozwiązanie stworzone z myślą o setupach, w których liczy się porządek, ergonomia i szybka kontrola nad ustawieniami - w studiu, sali prób albo w magazynie.
⚙️ Dzięki drukowi 3D mogliśmy precyzyjnie dopracować kształt podstawy oraz sposób połączenia z uchwytem, tak aby całość była stabilna i dobrze spasowana z mikserem.
🔥 Mniej szukania sprzętu, więcej wygody w pracy. Sprawdź MixMount Shelf na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '18q7Z1ZTp0xuOkuaaFbuDe5s70MnaekfT',
   null,
   null,
   'video'),
  ('fa61045a-156c-5656-a65d-c16d92258a9b',
   '23c855ac-f1a7-5b7a-9617-295761189513',
   'tiktok',
   '🎛️ Mikser na ścianie, przestrzeń odzyskana, setup bardziej uporządkowany.
🛠️ MixMount Shelf pozwala zamocować Behringer P16 na ścianie, dzięki czemu urządzenie ma swoje stałe miejsce i nie zajmuje dodatkowej przestrzeni na stanowisku.
📐 To rozwiązanie stworzone z myślą o setupach, w których liczy się porządek, ergonomia i szybka kontrola nad ustawieniami - w studiu, sali prób albo w magazynie.
⚙️ Dzięki drukowi 3D mogliśmy precyzyjnie dopracować kształt podstawy oraz sposób połączenia z uchwytem, tak aby całość była stabilna i dobrze spasowana z mikserem.
🔥 Mniej szukania sprzętu, więcej wygody w pracy. Sprawdź MixMount Shelf na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '18q7Z1ZTp0xuOkuaaFbuDe5s70MnaekfT',
   null,
   null,
   'video'),
  ('010cd05a-addc-5bbe-a581-53c8003fb687',
   'a206002b-0baa-53cd-b4a8-63d6d4699902',
   'instagram',
   '🎛️ MixMount Base to płytka montażowa, która pozwala stabilnie zamocować mikser osobisty Behringer P16 na statywie i wygodnie włączyć go w setup nagraniowy lub sceniczny.
🛠️ Sama możliwość montażu to jednak nie wszystko. Konstrukcję uzupełniliśmy o zintegrowany uchwyt na słuchawki, dzięki któremu pozostają one zawsze pod ręką, ale nie zajmują przestrzeni roboczej ani nie przeszkadzają podczas pracy.
🎧 To praktyczne rozwiązanie dla osób, które chcą uporządkować stanowisko odsłuchowe, poprawić ergonomię pracy i mieć najważniejsze elementy setupu w jednym, dobrze zaplanowanym miejscu.
💡 Kąt podstawy oraz nachylenie uchwytu na słuchawki zostały dopracowane tak, aby połączyć wygodny dostęp do miksera z uporządkowanym i estetycznym stanowiskiem.
🔥 Uporządkuj swój setup i zyskaj wygodny dostęp do miksera oraz słuchawek. Sprawdź MixMount Base na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1YltrSmfYXn4LarB6PWdHeVN9ZjlJasZO',
   null,
   null,
   'image'),
  ('aa286ba4-9f1d-57fe-a170-f1da9a579103',
   'a206002b-0baa-53cd-b4a8-63d6d4699902',
   'facebook',
   '🎛️ MixMount Base to płytka montażowa, która pozwala stabilnie zamocować mikser osobisty Behringer P16 na statywie i wygodnie włączyć go w setup nagraniowy lub sceniczny.
🛠️ Sama możliwość montażu to jednak nie wszystko. Konstrukcję uzupełniliśmy o zintegrowany uchwyt na słuchawki, dzięki któremu pozostają one zawsze pod ręką, ale nie zajmują przestrzeni roboczej ani nie przeszkadzają podczas pracy.
🎧 To praktyczne rozwiązanie dla osób, które chcą uporządkować stanowisko odsłuchowe, poprawić ergonomię pracy i mieć najważniejsze elementy setupu w jednym, dobrze zaplanowanym miejscu.
💡 Kąt podstawy oraz nachylenie uchwytu na słuchawki zostały dopracowane tak, aby połączyć wygodny dostęp do miksera z uporządkowanym i estetycznym stanowiskiem.
🔥 Uporządkuj swój setup i zyskaj wygodny dostęp do miksera oraz słuchawek. Sprawdź MixMount Base na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1YltrSmfYXn4LarB6PWdHeVN9ZjlJasZO',
   null,
   null,
   'image'),
  ('09de0578-8434-5aa8-bb0e-be8e38232c83',
   '449a20e8-d2c2-5ccb-84d5-57a1b05494b1',
   'instagram',
   '🎧 Ergonomia zaczyna się tam, gdzie sprzęt ma swoje miejsce.
🎛️ MixMount Base pozwala zamontować Behringer P16 na statywie i wygodnie włączyć go w setup nagraniowy, próbny albo sceniczny.
🛠️ Konstrukcję uzupełniliśmy o zintegrowany uchwyt na słuchawki, który zapewnia ich wygodne przechowywanie w zasięgu ręki, bez zajmowania przestrzeni roboczej i zakłócania organizacji stanowiska.
📐 Kąt ustawienia miksera oraz nachylenie uchwytu zostały dopracowane tak, aby połączyć wygodę, stabilność i estetykę stanowiska.
🔥 Jeden element, więcej porządku w setupie. Sprawdź MixMount Base na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '16Y6_Pi02iwmWphS4elukuTzpVHYrdvQC',
   null,
   null,
   'video'),
  ('75229bcc-fe4a-58be-ac69-5659ee523638',
   '449a20e8-d2c2-5ccb-84d5-57a1b05494b1',
   'facebook',
   '🎧 Ergonomia zaczyna się tam, gdzie sprzęt ma swoje miejsce.
🎛️ MixMount Base pozwala zamontować Behringer P16 na statywie i wygodnie włączyć go w setup nagraniowy, próbny albo sceniczny.
🛠️ Konstrukcję uzupełniliśmy o zintegrowany uchwyt na słuchawki, który zapewnia ich wygodne przechowywanie w zasięgu ręki, bez zajmowania przestrzeni roboczej i zakłócania organizacji stanowiska.
📐 Kąt ustawienia miksera oraz nachylenie uchwytu zostały dopracowane tak, aby połączyć wygodę, stabilność i estetykę stanowiska.
🔥 Jeden element, więcej porządku w setupie. Sprawdź MixMount Base na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '16Y6_Pi02iwmWphS4elukuTzpVHYrdvQC',
   null,
   null,
   'video'),
  ('c8a7389e-5223-5abc-8ebe-b55f319e6cf9',
   '449a20e8-d2c2-5ccb-84d5-57a1b05494b1',
   'tiktok',
   '🎧 Ergonomia zaczyna się tam, gdzie sprzęt ma swoje miejsce.
🎛️ MixMount Base pozwala zamontować Behringer P16 na statywie i wygodnie włączyć go w setup nagraniowy, próbny albo sceniczny.
🛠️ Konstrukcję uzupełniliśmy o zintegrowany uchwyt na słuchawki, który zapewnia ich wygodne przechowywanie w zasięgu ręki, bez zajmowania przestrzeni roboczej i zakłócania organizacji stanowiska.
📐 Kąt ustawienia miksera oraz nachylenie uchwytu zostały dopracowane tak, aby połączyć wygodę, stabilność i estetykę stanowiska.
🔥 Jeden element, więcej porządku w setupie. Sprawdź MixMount Base na: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '16Y6_Pi02iwmWphS4elukuTzpVHYrdvQC',
   null,
   null,
   'video'),
  ('efbc9a3e-1cb3-5e30-aef4-b0b22732c6a3',
   '18e334ea-ecc8-5590-bdbb-263bbe15c03b',
   'instagram',
   '🛠️ Nie każdą część da się dziś bez problemu kupić. Czasem jest niedostępna, zbyt droga albo po prostu nie pasuje do konkretnego sprzętu czy setupu.
📐 W Tetra Wave Solutions możemy pomóc odtworzyć uszkodzony lub brakujący element na podstawie zdjęcia, szkicu albo podstawowych wymiarów.
⚙️ Analizujemy kształt i sposób działania części, przygotowujemy model 3D, dobieramy odpowiedni materiał i produkujemy gotowy detal dopasowany do Twoich potrzeb.
🔩 To rozwiązanie sprawdza się między innymi przy obudowach, uchwytach, zaślepkach, mocowaniach oraz innych elementach technicznych, których trudno szukać bez końca na rynku.
🔥 Masz element do odtworzenia? Uzupełnij formularz na naszej stronie i pozwól nam stworzyć to, czego Ci brakuje: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1eDie0ODwG-Fzusp8HFRlfzjSSxu6nHZV',
   null,
   null,
   'image'),
  ('3e5fbf75-3cf3-5b5f-858b-267bf649c95f',
   '18e334ea-ecc8-5590-bdbb-263bbe15c03b',
   'facebook',
   '🛠️ Nie każdą część da się dziś bez problemu kupić. Czasem jest niedostępna, zbyt droga albo po prostu nie pasuje do konkretnego sprzętu czy setupu.
📐 W Tetra Wave Solutions możemy pomóc odtworzyć uszkodzony lub brakujący element na podstawie zdjęcia, szkicu albo podstawowych wymiarów.
⚙️ Analizujemy kształt i sposób działania części, przygotowujemy model 3D, dobieramy odpowiedni materiał i produkujemy gotowy detal dopasowany do Twoich potrzeb.
🔩 To rozwiązanie sprawdza się między innymi przy obudowach, uchwytach, zaślepkach, mocowaniach oraz innych elementach technicznych, których trudno szukać bez końca na rynku.
🔥 Masz element do odtworzenia? Uzupełnij formularz na naszej stronie i pozwól nam stworzyć to, czego Ci brakuje: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1eDie0ODwG-Fzusp8HFRlfzjSSxu6nHZV',
   null,
   null,
   'image'),
  ('3c1980cf-4c60-5a6a-b811-84e05d633b38',
   '5e150a05-badc-5926-a8cf-cd7ab4e63408',
   'instagram',
   '🛠️ Część niedostępna? To jeszcze nie znaczy, że temat jest zamknięty.
📐 W Tetra Wave Solutions możemy odtworzyć brakujący lub uszkodzony element techniczny na podstawie zdjęć, szkicu albo podstawowych wymiarów.
⚙️ Sprawdzamy kształt, funkcje i ergonomię części, a następnie przygotowujemy model 3D, dobieramy materiał i wykonujemy gotowy detal.
🔩 To dobre rozwiązanie przy obudowach, uchwytach, zaślepkach, mocowaniach i nietypowych częściach, których nie da się łatwo kupić albo których cena kompletnie mija się z sensem.
🔥 Masz coś do odtworzenia? Wyślij nam zdjęcie lub szkic przez formularz na stronie, a my sprawdzimy, co możemy dla Ciebie wykonać: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1ITHpP7sMTZkdVxi2CFiJZTvyPWQ6K5hu',
   null,
   null,
   'video'),
  ('9c3f7772-6edf-5a46-8b1d-238aa2af743b',
   '5e150a05-badc-5926-a8cf-cd7ab4e63408',
   'facebook',
   '🛠️ Część niedostępna? To jeszcze nie znaczy, że temat jest zamknięty.
📐 W Tetra Wave Solutions możemy odtworzyć brakujący lub uszkodzony element techniczny na podstawie zdjęć, szkicu albo podstawowych wymiarów.
⚙️ Sprawdzamy kształt, funkcje i ergonomię części, a następnie przygotowujemy model 3D, dobieramy materiał i wykonujemy gotowy detal.
🔩 To dobre rozwiązanie przy obudowach, uchwytach, zaślepkach, mocowaniach i nietypowych częściach, których nie da się łatwo kupić albo których cena kompletnie mija się z sensem.
🔥 Masz coś do odtworzenia? Wyślij nam zdjęcie lub szkic przez formularz na stronie, a my sprawdzimy, co możemy dla Ciebie wykonać: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1ITHpP7sMTZkdVxi2CFiJZTvyPWQ6K5hu',
   null,
   null,
   'video'),
  ('d7d331a4-259d-50c1-bc21-25cf4ae0d22e',
   '5e150a05-badc-5926-a8cf-cd7ab4e63408',
   'tiktok',
   '🛠️ Część niedostępna? To jeszcze nie znaczy, że temat jest zamknięty.
📐 W Tetra Wave Solutions możemy odtworzyć brakujący lub uszkodzony element techniczny na podstawie zdjęć, szkicu albo podstawowych wymiarów.
⚙️ Sprawdzamy kształt, funkcje i ergonomię części, a następnie przygotowujemy model 3D, dobieramy materiał i wykonujemy gotowy detal.
🔩 To dobre rozwiązanie przy obudowach, uchwytach, zaślepkach, mocowaniach i nietypowych częściach, których nie da się łatwo kupić albo których cena kompletnie mija się z sensem.
🔥 Masz coś do odtworzenia? Wyślij nam zdjęcie lub szkic przez formularz na stronie, a my sprawdzimy, co możemy dla Ciebie wykonać: tetrawavesolutions.pl',
   '{}'::text[],
   false,
   null,
   'gdrive',
   '1ITHpP7sMTZkdVxi2CFiJZTvyPWQ6K5hu',
   null,
   null,
   'video')
on conflict (id) do nothing;
