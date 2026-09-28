# DESKTOP-01 — Windows Analyze projects

Дата перевірки: 28.09.2026. Статус: реалізовано й інтерактивно перевірено Windows test build; потрібне приймання Івана. Це не підписаний публічний реліз і не підтвердження історичних наукових Gates D–H.

## 1. Межа й Git

- Гілка: `codex/desktop-foundation`.
- Base: `2a099f142f2760d2b0e9b08fa6923a4c67d8419b`, із `codex/claude-handoff-audit`, а не застарілого main.
- Implementation/build SHA: `678b0c071d6834006065513847a25c4d7b0b55b0`.
- Main залишається `c469b5846beeebaf02a0e17cb71dd608cdc82dbc`; merge/force-push/reset/clean не виконувалися.
- Вхідну `CODEX_DESKTOP_01_WINDOWS_PROJECTS.md` збережено в Git навмисно.
- OSIRIS, solver, транспортні правила, costs, defaults, Design-науку не змінено. Web Design залишився; desktop Design явно недоступний.
- Наступний коміт додає лише цей звіт і read-only verifier; installer містить наведений implementation SHA, не пізніший documentation SHA.

## 2. Research → constraints → рішення

Поточний Next застосунок використовує серверний `src/app/api/osm/route.ts`, `src/osm/server-client.ts`, браузерний acquisition coordinator, MapLibre та окремі Web Workers. Static export втратив би API routes. Electron 44.4.5 повторно використовує React/Next, Chromium/WebGL і workers без переписування науки. Tauri вимагав би окремого backend sidecar або перенесення routes; його не реалізовано.

Обрано Electron + Electron Forge 7.11.2/Squirrel x64 + production Next `output: standalone`. Next/React/MapLibre версії з baseline не оновлено. Додано прямі pinned Zod 4.6.5 та esbuild 0.28.2 для документа/оболонки. Lockfile містить npm relocation build-залежностей, а не навмисне оновлення математичного стеку.

```text
Ярлик → Electron main (нативні діалоги, сесія документа, атомарні файли)
                   ├─ utilityProcess → bundled Next server.js / API OSM
                   │                    127.0.0.1:<вільний порт>, token
                   └─ sandbox renderer → React / MapLibre
                         ├─ вузький preload: project + basemap settings
                         ├─ MapLibre worker + shared asset
                         └─ чинний Analyze Worker
```

`desktop/main.ts` керує single-instance, readiness (20 s), splash/error, lifecycle і власним child. `desktop/backend.ts` обирає loopback port. Порт 3000 не використовується як залежність. `scripts/prepare-desktop.mjs` копіює traced production dependencies, `public`, `.next/static`, workers і записує build-info. `.env*` та cache зі staging виключаються. Shell у ASAR, production runtime — у resources/runtime, без source-tree lookup.

Squirrel bootstrapper/rcedit не створив installer у кириличному build-output. Виправлено лише staging: `%TEMP%/physarum-desktop-build`. Запуск packaged app із кириличного шляху repo та кириличні project filenames перевірено; обмеження кирилиці користувачу не нав’язано.

Орієнтири: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [Forge Squirrel](https://www.electronforge.io/config/makers/squirrel.windows), локальні Next output/custom-server/CSP docs встановленої версії.

## 3. Документ v1 і транзакції

Авторитетне джерело — `snapshot.dataset` (normalized anchor-aware GIS); graph перебудовується чинним builder. `src/project/document.ts` містить strict schema, перевірку геометрій через штатний ingest, refs, SHA-256 graph/input/result fingerprints, розміру й вкладеності.

У `.physarum.json` входять:

- format/schemaVersion=1, identity/name/appVersion, createdAt/savedAt, Analyze mode, CRS EPSG:4326;
- AOI, camera/projection/layer visibility;
- повні geometry/properties/OSM IDs/ordered lineTopology anchors, provenance та context status;
- scenario terminals/magnitudes/constraints/profile/cost model, фактичні parameters і spatial policy;
- algorithmVersion `analyze-2a099f1`, graphVersion `anchored-2a099f1`, snap tolerance;
- лише узгоджений completed result (`converged` або `maxIterations`) без помилки; running/paused не є живим відновлюваним станом.

Ліміти: 32 MiB, 20 000 features, depth 48, загальний JSON budget 2 000 000 values. Невідомі/несумісні версії, refs, fingerprints, некоректні числа/anchors відхиляються до commit state. URL у provenance не виконується. Немає автоматичного refetch/default reset/migration. Рух камери/visibility не змінюють scientific input fingerprint.

`ProjectController` відокремлює capture/validate/prepare/commit від injected DesktopBridge. Cancel Open/Save не замінює документ. Save failure не дозволяє Close/New. Busy + revision comparison захищають від async save, що помилково позначає нові правки clean. Main serialized queue та document session не приймають старий Save. Атомарний запис: same-directory temp, flush/fsync, close, rename; target не truncate/unlink. Windows failure injection перевіряє збереження попереднього файлу.

При New/Open `MapWorkspace` abort/null старий OSM controller, скидає raw transport ref, збільшує import epoch; `usePhysarumRuntime.restore` cancels old run, reducer відкидає старі run IDs. Open не запускає solver. Для відкритого incomplete snapshot Retry urban context недоступний, бо raw OSM response не збережений; `Load OSM network` — окрема явна заміна snapshot, не прихований refetch.

Не зберігаються: API keys, access token, handles, DOM, worker, весь store, basemap tiles, Design, undo/redo/session history. CARTO key задається у вікні програми та зберігається окремо в userData/basemap.json. Ключ не налаштовано під час QA; попередження видно. Тайли не кешуються масово.

### Числова сумісність runtime

На реальному snapshot graph fingerprint у Node 24.15/V8 13.6 відрізняється від Electron 44.4.5/V8 15.2. Діагностика: hashes вузлів та ребер без `lengthMeters` однакові; input/result fingerprints теж однакові. Різняться floating-point довжини, обчислені різними V8. Це не виправлялося зміною формул або ослабленням checksum. Desktop runtime pinned; у ньому Open і повторний результат збігаються точно. Оновлення runtime потребує явного compatibility gate/міграції, не обіцянки bitwise-переносимості між довільними JS engines.

## 4. Security

`nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`; немає generic fs/shell/execute bridge. IPC перевіряє sender/mainFrame/origin/session і payload. Renderer отримує текст та opaque ticket, не arbitrary filepath. Save прив’язаний до вибору main native dialog. Навігація й нові вікна обмежені; external HTTPS allowlist. Permissions denied. Nonce CSP у `src/proxy.ts` і dynamic page; script unsafe-eval не увімкнений. Backend token випадковий для запуску, додається лише app session. Сторонній HTTP `/api/osm` без token фактично повернув 403.

Немає certificate bypass, вимкнення Windows protection чи auto-update. Runtime log не містить query/header secrets. npm audit: production 0; повний dev/build tree 29 (3 low, 3 moderate, 21 high, 2 critical), зокрема Forge/Vitest transitive tooling. Автоматичний audit fix не запускався. Це unsigned локальний test build, не security certification.

## 5. Реальний QA dataset

Отримано через штатний packaged `/api/osm` → adapter, не scratch converter:

- bbox `[24.024407157678354,49.839564988007936,24.039263283258293,49.84585558087346]`, близько 0.74 km², центр Львова;
- provider `https://overpass-api.de/api/interpreter`;
- OSM snapshot `2026-09-28T20:26:11Z`;
- transport fetched `2026-09-28T20:27:23.246Z`, context `2026-09-28T20:27:23.955Z`;
- 854 transport ways + 835 urban features = 1689 features; 834 polygons;
- graph 1903 nodes / 2288 edges, 1777 anchored / 126 synthetic boundary/geometric nodes; missing anchors=0, coordinate conflicts=0, geometric intersections=0, rejected invalid edge=1;
- Pedestrian: 2242 prepared usable edges; Motor: 369. Counts не є обіцянкою для майбутнього live OSM.

| Profile | Source `[lon,lat]` / OSM node | Sink `[lon,lat]` / OSM node | Результат |
|---|---|---|---|
| Pedestrian | `[24.0300692,49.8430591]` / 30525911 | `[24.0305173,49.844968]` / 7051411893 | converged, 93 iterations |
| Motor | `[24.032746,49.8398226]` / 923385113 | `[24.0386755,49.8446008]` / 8125306431 | converged, 90 iterations |

Локальні QA-файли (не Git): `C:/Users/semes/Documents/Physarum QA/Квартал Львів.physarum.json` (Pedestrian), `Квартал Львів — тест.physarum.json` (Motor), та навмисно `Пошкоджений.physarum.json`.

## 6. Перевірки

### Автоматичні

- Baseline: 490/490, 37 files, 254.17 s.
- Повний набір після реалізації: 506/506, 40 files, 365.93 s; фінальний повтор після додаткового тесту локалізації file errors: **507/507, 40 files, 371.37 s**.
- Targeted document/controller/files/worker: 25/25 після додаткового тесту.
- lint: 0 errors, 9 попередніх warnings у scratch (не приховано й не виправлялося сторонньо).
- TypeScript, production Next build, Forge package/make, git diff check: passed.
- Окремий production web HTTP smoke без desktop token на власному тимчасовому `127.0.0.1:45009`: 200, Physarum HTML, desktop-only CSP не застосовано. Цей QA server завершено; чужий порт 3000 не чіпали.
- Документ tests: anchors/properties/IDs/constraints/non-default params/completed result round-trip, no-fetch, same numerical result, invalid refs/schema/size/depth/keys, cancelled/failed/revision saves, deferred commands.
- Worker RESTORE regression: старе COMPLETED не перезаписує новий документ. OSM abort covered чинними client/acquisition tests; native race Open vs active live OSM не інжектувався.
- Resource checks: server.js/BUILD_ID/public MapLibre worker/shared file/Analyze chunk присутні. Atomic rename і failure preservation реально виконано на Windows/кириличному temp path. IPC helper checks і bounded failed readiness passed.
- Read-only verifier з реальними saved projects і забороненим fetch: Pedestrian і Motor exact full-result equality (tolerance 0 у pinned runtime).

### Native Windows, не Chrome

Використано Computer Use skill для вікна Physarum/native dialogs; shell лише для install/build/process/HTTP diagnostics. Звичайний браузер не зараховувався як desktop QA.

Підтверджено:

1. Packaged exe запускає власний backend без localhost:3000; кириличний source/output path працює.
2. Squirrel installer встановлено per-user; створено Desktop shortcut. Запуск через цей shortcut і повторний запуск — одне вікно/один backend.
3. MapLibre/WebGL, layers, live штатний OSM pipeline, Analyze Worker.
4. Pedestrian Run/Pause (iteration 15)/Resume → 93. Motor Run → 90, Reset → IDLE, повтор Run → 90.
5. Native Save, Save As із кирилицею/пробілами, повне закриття, Open із збереженим результатом й provenance без нового snapshot.
6. New + Cancel, Cancel Open, Cancel Save As, Close + Save, New + Discard. Пошкоджений файл не руйнує поточний документ.
7. Зміна profile/terminal очищає результат і робить dirty. Невалідна/роз’єднана пара не запускається.
8. Cold offline: нова ephemeral Electron session, `--offline-test` блокує remote HTTP(S) renderer/worker traffic, local style замість remote; власні геометрії, cached result, Motor rerun і Save працюють. PATH тільки Windows/System32, cwd поза repo. OS network settings не змінювалися, зовнішній backend network не відключався; Open не робить OSM запитів.
9. Власні PID/backend listener зникають після штатного виходу. Інші Node/Chrome не завершувалися. Пізніший installed запуск співіснував зі стороннім listener на 3000, використовуючи 64244/53685.
10. Інстальований runtime/resources незалежні від working directory; нових записів у installation tree під час перевірки не виявлено.

Не підтверджено інтерактивно: clean Windows VM/інший профіль без фізичного доступу до repo; повне OS-level відключення мережі; read-only Program Files install (Squirrel per-user); forced crash recovery/OS shutdown; native disk-full/ACL error (є unit failure injection); Motor Pause/Resume окремо (надто швидко завершився, Pedestrian перевірено); всі комбінації unsaved-підтверджень для кожної команди; web UI у зовнішньому браузері після зміни (автоматичні тести/build не замінюють це); keyed CARTO access.

### Вимірювання, не оцінки

- Перший packaged runtime ready 748 ms / loadURL 996 ms; installed shortcut 1169 / 1495 ms; cold offline 1507 / 1871 ms. Від `app.whenReady`, не від кліку інсталятора; не включає remote tiles.
- Working sets п’яти app processes: online із dataset/result 1 008 910 336 bytes сумарно (~962 MiB; shared pages можуть рахуватися кілька разів); offline після Open 731 901 952 bytes, після кількох runs 1 128 927 232 bytes. Це не peak і не private-memory benchmark.
- Pedestrian file 1 281 883 bytes; parse/validate/rebuild 2038.87 ms, повторний solver 15029.64 ms.
- Motor file 1 075 657 bytes; parse/validate/rebuild 637.53 ms; Save preparation/serialization 491.93 ms, atomic replacement 18.18 ms; повторний solver 1997.29 ms.
- Останні timings — read-only/temporary-file harness того самого pinned runtime; не latency нативного діалогу з часом вибору користувача. На машині паралельно працювали tests/інші програми.

## 7. Збірка й артефакт

```powershell
npm ci
npm run desktop:dev       # production bundle + власний Electron runtime, не Next dev prerequisite
npm run desktop:package   # Next build + shell/resources + Forge/Squirrel Windows x64
```

Web development лишається `npm run dev`; для кінцевого користувача ці команди не потрібні.

Installer: `out/desktop-01/Physarum-0.1.0 Setup.exe` — копія результату `%TEMP%/physarum-desktop-build/make/squirrel.windows/x64/Physarum-0.1.0 Setup.exe`.

- Size: **163 136 512 bytes**.
- SHA-256: **1D45B58F1E432025CBB442A16B0FB1F2B6BAA2916B9866AE9CAEC4D9F670A190**.
- Authenticode: **NotSigned / unsigned test build**. Сертифікат не надано. Захист Windows не обходився.
- Installed: `%LOCALAPPDATA%/Physarum/app-0.1.0/Physarum.exe`; shortcut `Desktop/Physarum.lnk`.
- App data/log/settings: `%APPDATA%/physarum-transport-model-2`. Projects — у вибраному користувачем каталозі.
- Installer, datasets, staging, scratch, keys до desktop-коміту не входять.

Read-only numerical verification developer command (PowerShell):

```powershell
npx esbuild scripts/verify-desktop-project.ts --bundle --platform=node --format=esm --outfile=.desktop/verify-project.mjs
$env:ELECTRON_RUN_AS_NODE='1'
& ./node_modules/electron/dist/electron.exe .desktop/verify-project.mjs 'C:/path/project.physarum.json' --io-benchmark | Out-String
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

`--io-benchmark` пише лише окремий тимчасовий benchmark file, не переданий проєкт. Без прапорця verifier лише читає. Глобальний Node із іншим V8 не є сумісним bitwise verifier цього build.

## 8. Коротке приймання для Івана

1. Відкрити installer або вже створений **Physarum** на Desktop. Власне вікно, порожній Analyze, без PowerShell/Chrome. За попередження Windows про unsigned build не вимикати захист; рішення про запуск приймає користувач.
2. За потреби ввести власний CARTO key → **Застосувати ключ**. Без підкладки збережені геометрії/Analyze залишаються доступні.
3. Для нового snapshot: наблизити малу територію → **Select current view** → **Load OSM network**. Чекати transport/context statuses і timestamps. Не плутати failed context із відсутністю об’єктів. Не натискати **Load synthetic demo** для реального сценарію.
4. **Pedestrian** або **Motor** → **Select source** / **Select sink** й вузли на карті (або Source/Sink dropdown). Очікувати **VALID / Connected**, потім **Run**. **Pause / Resume**, **Reset runtime** зберігають чинні semantics.
5. **Файл → Зберегти** / Ctrl+S → `.physarum.json`. Закрити → ярлик → **Файл → Відкрити…** / Ctrl+O. Очікувати ті самі дані, profile, terminals, camera й completed result; новий OSM запит не потрібний.
6. Для точного тесту цього snapshot відкрити QA-файл із розділу 5. Motor dropdown Source `node-a-10600n1xbfkvn`, Sink `node-a-106dtrz15ecefb`; координати наведено вище. За незвичного fit через великий парк: **↺**, потім zoom над центром Львова; viewport не змінює scientific input.
7. Змінити profile/terminal: старий результат має зникнути, з’явитися ●. При New/Open/Close спробувати **Скасувати** — поточна робота залишається. Оригінальний файл не змінюється до успішного Save.

## 9. Відомі межі й STOP

Analyze лишається undirected: one-way restrictions не enforced, rail solver відсутній, OSM relation multipolygons не реконструюються. Це не маршрутизатор для навігації і не прогноз фактичних поїздок. Urban way polygon може виходити далеко за AOI; чинний Fit to dataset тоді показує великий парк і відсуває вулиці — це baseline UX limitation, не обрізалося зі зміною GIS snapshot.

Для малих AOI JSON v1 достатній; validation/graph preparation у renderer можуть коротко блокувати UI, solver залишається Worker. Немає crash autosave, історії, file association, auto-update або гарантії engine-independent bitwise graph lengths.

Наступна рекомендована задача — приймання цього installer на чистому Windows-профілі/VM та перевірка deployment security/dependency tooling перед публічним релізом. Новий редактор/Design/Prediction не починати. STOP перед merge в main.
