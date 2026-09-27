# Deadline Radar

Студентський менеджер дедлайнів українською. Плануйте завдання, відстежуйте статуси, переглядайте календар та отримуйте браузерні нагадування. Акаунт підтримує Google OAuth та email/password з підтвердженням адреси й відновленням пароля. Дані синхронізуються через Supabase або зберігаються у чітко позначеному локальному режимі.

## Локальний запуск

Потрібен Node.js 18+.

```bash
npm install
npm run dev
```

Без налаштування Supabase застосунок запускається у **локальному режимі**: дані зберігаються тільки у `localStorage` поточного браузера. На екрані є попередження про це та кнопки експорту/імпорту резервної копії JSON. Не очищайте дані браузера без попереднього експорту. Щоб отримати демонстраційні завдання, відкрийте застосунок у браузері без збереженого списку.

## Увімкнення акаунтів і синхронізації

1. Створіть проєкт у [Supabase](https://supabase.com/).
2. У **SQL Editor** виконайте SQL-файли з `supabase/migrations/` за хронологічним порядком. Вони створюють `public.tasks`, політики RLS для власника, та захищену функцію видалення лише власного акаунта.
3. У Supabase відкрийте **Project Settings → API** і скопіюйте Project URL та **publishable key** (або legacy anon key). Публічний ключ призначений для клієнтського застосунку; ніколи не використовуйте `service_role` key у фронтенді.
4. Скопіюйте `.env.example` у `.env.local` та підставте значення:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-publishable-or-anon-key
   ```

   Не комітьте `.env.local` або інші секрети. Перезапустіть `npm run dev` після зміни env.
5. У **Authentication → URL Configuration** задайте Site URL і дозвольте redirect URLs для застосунку. Для локальної розробки це `http://localhost:5173/**`; для опублікованого сайту див. GitHub Pages нижче. У **Authentication → Providers → Email** увімкніть email/password і email confirmation. Налаштуйте production SMTP у **Project Settings → Auth → SMTP Settings**: вбудована пошта Supabase призначена для тестування та обмежена, а не для надійного масового підтвердження. Після реєстрації користувач підтверджує адресу з листа; форма також дозволяє надіслати його повторно. Паролі для нових акаунтів мають містити щонайменше 8 символів.
6. Для Google: створіть OAuth 2.0 **Web application** credentials у [Google Cloud Console](https://console.cloud.google.com/apis/credentials), налаштуйте OAuth consent screen / branding, додайте адресу сайту до authorized JavaScript origins, а callback Supabase `https://<PROJECT_REF>.supabase.co/auth/v1/callback` — до authorized redirect URIs. У Supabase відкрийте **Authentication → Providers → Google**, увімкніть провайдера та внесіть Client ID і Client Secret із Google. Client Secret зберігається тільки в Supabase — ніколи не додавайте його в `.env`, GitHub Actions variables чи frontend. У Google OAuth consent screen вкажіть актуальні посилання на privacy та terms зі свого домену.
7. Відкрийте застосунок, створіть акаунт або увійдіть email/password чи Google. Є відновлення пароля поштою, повторне надсилання підтвердження і встановлення нового пароля після переходу за листом. Локальні й хмарні списки розділені; імпорт JSON додає копії завдань до активного простору.

Якщо налаштована лише одна з двох змінних Supabase або запит завершується помилкою, застосунок показує помилку й не підміняє хмарні дані локальними. Для відновлення синхронізації перевірте URL, ключ, міграцію, мережу та RLS.

## Можливості

- Створення, редагування, видалення і зміна статусу завдань.
- Групування за простроченими, сьогоднішніми, тижневими та пізнішими дедлайнами; підсумкові фільтри за найближчими датами.
- Календар місяця з планом на обраний день.
- Пріоритет, повторення щодня/щотижня/щомісяця та предмет; пошук, фільтрація і сортування.
- Нагадування браузера за 30 хвилин до дедлайну. Дозвіл запитується лише після явної дії; вкладка має бути відкрита для перевірки нагадувань.
- Експорт/імпорт JSON для резервування та перенесення між режимами.
- Вхід через Google або email/password, підтвердження пошти, повторне надсилання листа та відновлення пароля.
- Самостійне видалення акаунта з видаленням його хмарних завдань (після застосування SQL-міграцій).
- Сторінки умов користування й приватності для прозорого налаштування OAuth.
- Адаптивний інтерфейс із темною фіолетовою палітрою та українською локалізацією.

У хмарному режимі зміни записуються в акаунт одразу, а список оновлюється після повернення до вкладки, щоб підхопити зміни з інших пристроїв.

## Перевірки та збірка

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

## Публічний запуск через GitHub Pages

У репозиторії вже є workflow `.github/workflows/deploy-pages.yml`: після злиття в `main` він запускає lint, typecheck і тести, збирає SPA з правильним шляхом `/deadline-radar/` і публікує його в GitHub Pages. Його також можна запустити вручну з **Actions → Deploy Deadline Radar → Run workflow**.

Перед першим запуском відкрийте **Settings → Pages** та виберіть **Source: GitHub Actions**. Для акаунтів і синхронізації додайте в **Settings → Secrets and variables → Actions → Variables**:

- `VITE_SUPABASE_URL` — Project URL вашого Supabase-проєкту.
- `VITE_SUPABASE_ANON_KEY` — публічний publishable/anon key. Ніколи не додавайте `service_role` key.

Спочатку застосуйте SQL-міграцію зі кроків вище. У **Authentication → URL Configuration** у Supabase додайте `https://solonetsavipz24-prog.github.io` як Site URL і `https://solonetsavipz24-prog.github.io/deadline-radar/` як Redirect URL. Для локального запуску додайте також `http://localhost:5173/`.

У Google Cloud OAuth client задайте authorized JavaScript origin `https://solonetsavipz24-prog.github.io` та callback URL `https://<PROJECT_REF>.supabase.co/auth/v1/callback` (це URL Supabase-проєкту, а не GitHub Pages). Додайте URL публічних сторінок `https://solonetsavipz24-prog.github.io/deadline-radar/privacy.html` і `https://solonetsavipz24-prog.github.io/deadline-radar/terms.html` до consent screen. Звичайний `github.io` хост є спільним доменом: для зовнішнього OAuth-застосунку Google може вимагати домен, яким ви володієте, і верифікацію. Для запуску Google OAuth на широку аудиторію налаштуйте власний домен для GitHub Pages, підтвердьте домен у Google Search Console/consent screen і використовуйте його як origin, Privacy Policy URL та Terms URL. До публікації OAuth consent screen у режимі Testing вхід буде доступний лише тестовим користувачам.

Для власного домену налаштуйте DNS та HTTPS у **Settings → Pages**, задайте GitHub Actions repository variable `VITE_BASE_PATH` зі значенням `/`, після чого запустіть deployment workflow повторно. Без цієї змінної залишається типовий шлях `/deadline-radar/`.

Email confirmation потребує production SMTP у Supabase; перевірте sender domain, DNS/SPF/DKIM та шаблон листа. Листи підтвердження й відновлення мають вести на URL застосунку. Після додавання GitHub Actions variables повторно запустіть deployment workflow, щоб налаштування потрапили у статичну збірку.

Після виконання міграцій користувачі можуть керувати завданнями та акаунтом з інтерфейсу: в меню профілю є вихід, лист для зміни пароля й незворотне видалення акаунта разом із його завданнями. До злиття міграцій у production застосунку ці дії акаунта будуть недоступні. Політика приватності й умови доступні зі сторінки входу та у корінні `public/privacy.html` і `public/terms.html`.

Якщо variables не задані, публічний сайт усе одно запуститься в чітко позначеному локальному режимі; email-акаунти та синхронізація будуть недоступні. Змінні вбудовуються у frontend build, тому тут дозволено лише публічний Supabase key, захищений RLS-політиками.
