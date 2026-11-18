# Procedura testowa statystyk: PostHog + Vimeo

Cel: potwierdzić **u celu**, w danych PostHog i w liczniku Vimeo, że wizyty są naprawdę zliczane.
To, że strona coś wysyła, niczego nie dowodzi, bo blokery (np. Brave) mogą to po drodze odrzucić.

Od 6.8.11 obowiązuje zasada: **wszystko pełne dopiero po „Accept”**.

## 1. Co ma być zliczane

| Zgoda | PostHog | Vimeo |
|---|---|---|
| brak wyboru albo Decline | anonimowo, wprost do `eu.i.posthog.com` (`via = direct`). **W Brave dochodzi tylko `$pageview`.** To wybór odwiedzającego i tego nie obchodzimy. | **nie liczy** (odtwarzacz z `dnt=1`) |
| Accept | wszystko przez adres strony `/akx` (`via = site`), **także w Brave**. Do tego mapy cieplne i nagranie sesji. | **liczy** (odtwarzacz bez `dnt`, `showreel_open.vimeo_stats = true`). **W Brave niepewne:** Brave blokuje część adresów statystyk Vimeo (`vimeo.com/add/`, `vimeo.com/ablincoln/`) wewnątrz odtwarzacza i tego nie da się obejść. Wynik ustalamy testem. |

## 2. Przygotowanie

1. **ID testu** w postaci `t<miesiącdzień>-<przeglądarka>-<zgoda>`, np. `t1118-brave-acc`. Każde zdarzenie z tej karty dostaje w PostHog właściwość `test_run = <ID>`.
2. **Vimeo przed testem:** zapisz liczbę *Views* filmu z dzisiaj (Vimeo → film → Analytics).
3. **Czysty start:** okno prywatne albo wyczyszczone dane strony, żeby była to „pierwsza wizyta” bez zapisanej zgody.
4. **Adres:**
   - lokalnie: `http://localhost:3123/?track&testrun=<ID>`
   - na żywo: `https://www.arturkalinowski.com/?track&testrun=<ID>`

   `?track` zdejmuje znacznik `?notrack`. Jeśli nie chcesz, żeby Twoje zwykłe wizyty się liczyły, otwórz po testach stronę raz z `?notrack`.

## 3. Scenariusz (jeden przebieg)

1. Otwórz adres testowy.
2. W okienku **Privacy**: nic nie klikaj (wariant **A**), kliknij **Accept** (wariant **B**) albo **Decline** (wariant **C**).
3. Tylko w wariancie B: **przeładuj stronę (F5)**. To sprawdza start strony z zapisaną zgodą.
4. Przewiń do samego dołu i z powrotem na górę.
5. Kliknij w menu **Manifesto**, potem **Contact**.
6. Kliknij **5 razy** w animację 3D.
7. Otwórz **Showreel**, oglądaj co najmniej **20 s**, zamknij **×**.
8. **Zamknij kartę** (wtedy idzie `$pageleave`).
9. Zapisz godzinę i ID.

**Przebiegi:**

| # | Przeglądarka | Wariant | Kto |
|---|---|---|---|
| R1 | wbudowana przeglądarka (Chromium) | A | Claude |
| R2 | wbudowana przeglądarka (Chromium) | B | Claude |
| R3 | Brave na Windows | A | Ty |
| R4 | Brave na Windows | B | Ty |
| R5 | Brave na Windows | C | Ty (opcjonalnie) |
| R6 | iPhone, Safari | B | Ty (opcjonalnie) |

## 4. Sprawdzenie w PostHog (robi Claude przez łącznik PostHog)

- **Odczekaj 5 minut po przebiegu.** PostHog pokazuje zdarzenia z opóźnieniem: 18.11 część zdarzeń showreela pojawiła się dopiero po około 2 minutach. Brak zdarzenia zaraz po teście nie oznacza jeszcze błędu.
- **Kraj sprawdzaj tylko na Vercel**, nie lokalnie. Na `localhost` zdarzenia przez `/akx` nie mają kraju, bo lokalny serwer przekazuje do PostHog adres `localhost`.

Najpierw lista zdarzeń jednego przebiegu:

```sql
SELECT
  event,
  count() AS n,
  any(properties.$browser) AS browser,
  any(properties.consent) AS consent,
  any(properties.via) AS via,
  any(properties.$geoip_country_code) AS country
FROM events
WHERE timestamp >= now() - INTERVAL 1 DAY
  AND properties.test_run = '<ID>'
GROUP BY event
ORDER BY event
```

**Zaliczone, gdy:**

| Wariant | Muszą być |
|---|---|
| A, Chromium | `$pageview`, `$autocapture`, `scroll_depth` (25/50/75/100), `section_view` (manifesto, contact), `menu_click` ×2, `visual_clicks` (1, 5), `showreel_open` (`vimeo_stats = false`), `showreel_start`, `showreel_progress` 25, `showreel_close`, `$pageleave`; `via = direct` |
| A, Brave | **tylko `$pageview`**, i to jest wynik oczekiwany |
| B (każda przeglądarka) | wszystko z wiersza „A, Chromium” po przeładowaniu, do tego `consent_choice` (accept); `via = site`; `showreel_open.vimeo_stats = true`; **kraj = PL** (tylko na Vercel), co dowodzi, że adres IP przechodzi przez `/akx`; **nagranie sesji** w PostHog (Replay) |

Sprawdzenie, czy jest nagranie sesji (same dane o nagraniu, bez treści):

```sql
SELECT session_id, min(start_time) AS started, max(end_time) AS ended,
       sum(click_count) AS clicks, any(first_url) AS first_url
FROM session_replay_events
WHERE start_time >= now() - INTERVAL 2 HOUR
GROUP BY session_id
ORDER BY started DESC
LIMIT 10
```
| C | jak A, plus `consent_choice` (decline) |

Zdarzenia sprzed kliknięcia Accept w Brave przepadają. To jest oczekiwane, bo zgody jeszcze nie było.

## 5. Sprawdzenie w Vimeo (robisz Ty)

1. Vimeo → film → Analytics: liczba *Views* z dzisiaj.
2. Oczekiwany wynik: wzrost **o co najmniej liczbę przebiegów B z Chromium** (R2). Przebiegi A i C nie mogą niczego dodać.
3. R4 (Brave, Accept) zapisz osobno: dodało albo nie dodało. To jest właśnie niewiadoma z tabeli 1.
4. Opóźnienie statystyk Vimeo nie jest znane. Sprawdź po około 1 godzinie i jeszcze raz następnego dnia, a faktyczne opóźnienie dopisz do wyników poniżej.

## 6. Po publikacji

- Powtórz R1–R4 na żywej stronie (skrót: kroki 1, 2, 7, 8).
- Raz w tygodniu Claude sprawdza w PostHog zdarzenia z podziałem na przeglądarki z ostatnich 7 dni. Jeśli jakaś przeglądarka ma same `$pageview`, to znaczy, że coś blokuje dane.

## 7. Wyniki

| Data | ID | Przeglądarka | Wariant | PostHog | Kraj | Nagranie | Vimeo | Uwagi |
|---|---|---|---|---|---|---|---|---|
| 18.11, lokalnie | t1118-pane-none | wbudowana (Chromium) | A | ✅ wszystkie zdarzenia, `via = direct` | PL | nie dotyczy | nie powinno liczyć (`dnt=1`) | |
| 18.11, lokalnie | t1118-pane-accept | wbudowana (Chromium) | B | ✅ wszystkie zdarzenia przez `/akx`, `vimeo_stats = true` | brak (localhost) | ✅ 3,5 min, 14 kliknięć | ✅ Vimeo: 2 wyświetlenia 18.11 przed testami w Brave (R2 i przebieg kontrolny, oba po Accept) | zdarzenia showreela doszły po około 2 min |
| 18.11, lokalnie | t1118-brave-none (bez znacznika*) | Brave, okno prywatne | A | ✅ tylko `$pageview`, czyli tak jak powinno | PL | nie dotyczy | nie powinno liczyć | inna kolejność kroków, bez 5 kliknięć |
| 18.11, lokalnie | t1118-brave-acc (bez znacznika*) | Brave, okno prywatne | B | ✅ **wszystkie** zdarzenia przez `/akx` (wcześniej Brave wysyłał tylko `$pageview`), `vimeo_stats = true` | brak (localhost) | ✅ 2 min, 16 kliknięć | **do sprawdzenia**: czy Vimeo pokazuje 3. wyświetlenie z 18.11 | |
| | | | | | | | | |

| 18.11, **na żywo** (6.8.11) | t1118-live-pane-none | wbudowana (Chromium) | A (krótko) | ✅ wszystkie zdarzenia, `via = direct` | PL, Gdańsk | nie dotyczy | nie powinno liczyć | |
| 18.11, **na żywo** (6.8.11) | t1118-live-pane-acc | wbudowana (Chromium) | B (krótko) | ✅ zdarzenia przez `/akx`, `vimeo_stats = true` | ✅ **PL, Gdańsk także przez `/akx`**, czyli adres IP przechodzi poprawnie | nagrywanie włączone | do sprawdzenia w Vimeo | |

\* Adres skopiowany razem z kropką kończącą zdanie (`...brave-acc.`), więc znacznik się nie zapisał. Przebiegi znalezione po przeglądarce i sesji. Od tej poprawki kropka i inne znaki po ID są ignorowane.
