# eStudia — Plan zajęć (Informatyka Techniczna, Politechnika Lubelska)

Statyczna aplikacja PWA do planu zajęć, zadań i notatek z przedmiotów na kierunku Informatyka Techniczna na Politechnice Lubelskiej.
Działa bez bundlera i bez zewnętrznych zależności (`npm`).

## Komputer i iPad poziomo

Na szerokim ekranie (od 900 px, orientacja pozioma) aplikacja przełącza się na układ desktopowy w stylu Kalendarza Google; w pionie i na telefonie wygląda jak dotąd:

- boczne menu zamiast dolnego paska, maksymalnie wykorzystujące poziomy ekran dla siatki tygodnia,
- kalendarz miesiąca chowa się do wyskakującego okienka po kliknięciu daty (zakresu tygodnia nad tabelą lub dzisiejszej daty pod tytułem): wybrany tydzień jest podświetlony z literą A/B, a kropki oznaczają dni z nieukończonymi zadaniami (czerwona: po terminie),
- plan to siatka godzinowa tygodnia (sobota i niedziela pojawiają się tylko, gdy mają zajęcia), ze wskaźnikiem bieżącej godziny (kropka z linią postępu dnia) oraz oznaczeniami „Teraz” / „Następne”,
- po kliknięciu w dany przedmiot na planie widać prowadzącego, salę, rodzaj zajęć oraz szybki skrót do wymagań i notatek przedmiotu,
- okna zajęć, zadań i ustawień wysuwają się jako panel z prawej strony,
- skróty klawiszowe: `1–3` zakładki, `←`/`→` tydzień, `T` dziś, `E` edycja, `N` nowe zajęcia / zadanie, `C` kalendarz miesiąca, `/` szukaj zadań, `K` Sesja / Kolokwia, `H` ukryj ukończone, `,` ustawienia, `R` synchronizuj, `⌘Z`/`Ctrl+Z` cofnij, `?` ściągawka,
- instalacja jako aplikacja (PWA) z ikon 192/512 px.

## Termin powiadomień

Każde zadanie może mieć własny termin powiadomienia (formularz zadania, pole „Powiadomienie”):

- **Domyślne**: reguła z Ustawień → „Domyślne powiadomienia” (start: zadania stacjonarne dzień przed zajęciami o 18:00, online 24 godziny przed terminem),
- **Przed terminem**: 5, 10, 15, 30 min, 1, 2 lub 5 godz. przed terminem zadania,
- **Data i godzina**: konkretny moment (musi być przed terminem zadania).

Pod polem widać na żywo, kiedy dokładnie przyjdzie powiadomienie. Własny termin zapisuje się w zadaniu (`rem`), a domyślne reguły w planie (`notif`) w `plan.json`.
Aplikacja i skrypt wysyłający powiadomienia importują dokładnie ten sam moduł `js/core.js`, więc zawsze liczą ten sam moment. Zadanie, któremu przesunięto termin powiadomienia na później niż poprzednie wysłanie, dostaje powiadomienie ponownie.

## Powiadomienia przy zamkniętej aplikacji

Aplikacja jest statyczna (GitHub Pages), więc powiadomienia przy zamkniętej aplikacji wysyła workflow `.github/workflows/notify.yml`:

- Uruchamia się co godzinę oraz **natychmiast po zmianie `plan.json`** (obsługuje nawet przypomnienia ustawione na „za 5 minut”).
- Jeśli żadne zadanie nie wymaga powiadomienia w najbliższych 75 minutach, przebieg kończy się od razu po kilku sekundach (oszczędność minut GitHub Actions).
- Stan wysyłki (`push-state.json`) oraz subskrypcje urządzeń (`push-subscriptions.json`) przechowywane są na osobnej gałęzi technicznej `push-state`, dzięki czemu gałąź `main` pozostaje czysta i nie wyzwala zbędnych przebudów GitHub Pages.

Jednorazowa konfiguracja:

1. W repozytorium: **Settings → Secrets and variables → Actions → New repository secret**, nazwa `VAPID_PRIVATE_KEY` (wartość to klucz prywatny pasujący do `VAPID_PUBLIC` w `js/config.js`).
2. W aplikacji (z tokenem GitHub w Ustawieniach) włącz powiadomienia — urządzenie zapisze się w `push-subscriptions.json` na gałęzi `push-state`. Na iPhonie aplikacja musi być dodana do ekranu głównego (iOS 16.4+).
3. Test: **Actions → Powiadomienia o zadaniach → Run workflow** z zaznaczonym „test”.

## Testy

```bash
node --test tests/*.test.mjs
```
