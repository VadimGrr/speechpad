# Нативный агент Speechpad

`apps/agent` — маленький помощник на C#/.NET 10, который живёт в трее, поднимает
локальный сервер на `127.0.0.1`, отдаёт собранный веб, вставляет распознанный
текст в активное окно и держит горячие клавиши. В вебе это сделать нельзя:
`always on top`, глобальные хоткеи и ввод с клавиатуры требуют Win32.

## Сборка и запуск

```bash
npm run build                 # собрать веб в apps/web/dist
dotnet run --project apps/agent/Speechpad.Agent.csproj
```

Агент сам находит `apps/web/dist` рядом с собой: ищет вверх по дереву `dist`,
`apps/web/dist`, `web` и `apps/web` и берёт первый каталог, где есть `index.html`
без `src` и `package.json` (то есть именно сборку, а не исходники). Путь можно
задать явно: `--web-root <путь>`.

Главное окно: <http://127.0.0.1:8787/>. Компактное окно: `/float.html` — его нужно
открыть отдельно, лучше как popup из главного.

## Ключи командной строки

| Ключ | Смысл |
| --- | --- |
| `--port <число>` | порт сервера, по умолчанию `8787` |
| `--web-root <путь>` | папка со собранным вебом |
| `--scheme clipboard\|unicode` | способ вставки текста |
| `--settings <путь>` | файл настроек, по умолчанию `settings.json` рядом с exe |
| `--no-tray` | без иконки в трее (удобно для проверок и запуска из консоли) |
| `--verbose` | подробный журнал |
| `--list-windows` | показать видимые окна: так ищут заголовки для `--web-root`-настроек |
| `--install-autostart` / `--uninstall-autostart` | автозапуск при входе в Windows (HKCU Run) |
| `--license-info` | показать состояние лицензии и выйти, код `0` — можно работать |
| `--license <путь>` | файл лицензии, по умолчанию `%APPDATA%\SpeechPad\license.json` |
| `--machine-id <id>` | подменить идентификатор компьютера при проверке лицензии |
| `--help` | справка |

## HTTP

Сервер слушает только `127.0.0.1`, наружу не выставлен.

| Запрос | Ответ |
| --- | --- |
| `GET /health` | `{ status, version, sessions, insertScheme, processId, port, licenseState, licenseMessage, insertAllowed, extensionAllowed }` |
| `GET /token` | `{ token, port, insertScheme, version }`; проверяется `Origin` |
| `GET /ws?token=…` | WebSocket; без токена `401`, без заголовка Upgrade `400` |
| `GET /*.html` | страница с вставленным `<script>window.__SPEECHPAD_AGENT__=…</script>` перед `</head>` |
| остальное | статика из `apps/web/dist` как есть, токен в неё не попадает |

`Origin` для `/token` должен быть пустым (не браузер), `http://127.0.0.1:8787`,
`http://localhost:8787` или адресом дев-сервера `http://127.0.0.1:5173`.
Остальные origins получают `403`.

Токен — 24 случайных байта в hex (48 символов), он живёт только в памяти процесса
и меняется при каждом запуске. Веб получает его не через отдельный запрос, а из
инъекции в HTML, поэтому токен нельзя получить со стороннего сайта: такой запрос
пришёл бы с чужим `Origin` и получил `403`.

## WebSocket

Сообщения — JSON без переводов строк. Клиент шлёт:

| Сообщение | Поля |
| --- | --- |
| `hello` | `type`, `version` (сейчас `1`) |
| `insert` | `type`, `text`, `seq` — вставить текст в активное окно |
| `command` | `type`, `name`: `toggle`, `clear`, `topmost`, `ping` |

Агент шлёт:

| Сообщение | Поля |
| --- | --- |
| `ready` | `type`, `version`, `insertScheme`, `processId`, `port` — ответ на `hello` и `ping` |
| `inserted` | `type`, `ok`, `scheme` — результат вставки |
| `hotkey` | `type`, `action` — нажата глобальная клавиша |
| `error` | `type`, `message` — неизвестное сообщение, неизвестная команда, не найдено окно, ошибка вставки |

Ограничения: сообщение длиннее 64 КБ отбрасывается, не-JSON и неизвестные типы
дают `error`, вставка выполняется строго последовательно в одном STA-потоке.

## Вставка текста

- `clipboard` (по умолчанию) — текст кладётся в буфер обмена, отправляется
  `Ctrl+V`, после вставки прежнее содержимое возвращается в буфер.
- `unicode` — `SendInput` с `KEYEVENTF_UNICODE`, буфер обмена не трогается.
  Работает с любой раскладкой, но медленнее: вставка идёт порциями по 24 символа.

Символ `\n` в обоих режимах превращается в `Enter`, `\t` — в `Tab`, `\r`
пропускается. Эмодзи разбиваются на сурогатные пары и отправляются двумя
событиями. Переключение: `--scheme unicode` или `insertScheme` в `settings.json`.

## Окна и hotkeys

- `always on top` — `SetWindowPos(HWND_TOPMOST)`. Окно ищется по заголовку окна
  браузера: `mainWindowTitle` и `compactWindowTitle` в настройках. Узнать реальные
  заголовки: `speechpad-agent --list-windows`.
- Горячие клавиши по умолчанию: `Ctrl+Alt+Space` — пауза/продолжить,
  `Ctrl+Alt+T` — поверх всех окон, `Ctrl+Alt+D` — очистить стенограмму.
  Регистрируются глобально с `MOD_NOREPEAT`; если клавиша занята другим
  приложением, агент пишет об этом в журнал и продолжает работать.

## Настройки

`settings.json` рядом с exe (`--settings` — другой путь). Поля:

```json
{
  "port": 8787,
  "webRoot": null,
  "insertScheme": "ClipboardPaste",
  "toggleHotkey": "Ctrl+Alt+Space",
  "topmostHotkey": "Ctrl+Alt+T",
  "clearHotkey": "Ctrl+Alt+D",
  "mainWindowTitle": "Speechpad — голосовой ввод",
  "compactWindowTitle": "Speechpad — компактное окно",
  "trayIcon": true,
  "verbose": false,
  "licensePath": null,
  "requireLicense": false,
  "trialDays": 2
}
```

`licensePath` — файл лицензии, по умолчанию `%APPDATA%\SpeechPad\license.json`.
`requireLicense` — не запускаться без лицензии (пробный период отключается).
`trialDays` — пробный период в днях, когда лицензии нет. Подробности в
[licensing.md](licensing.md).

Битый файл не ломает запуск: агент берёт значения по умолчанию и пишет в журнал.
Горячие клавиши понимают `Ctrl`, `Alt`, `Shift`, `Win`, буквы, цифры, `F1`…`F24`
и имена `Space`, `Enter`, `Tab`, `Esc`, `Backspace`, `Delete`, `Home`, `End`,
`PageUp`, `PageDown`, стрелки, `Pause`, `PrintScreen`.

## Трей

Меню трея: открыть главное окно, компактное окно поверх, автозапуск вкл/выкл,
лицензия, открыть журнал, выход. Журнал — `%LOCALAPPDATA%\Speechpad\agent.log`.

## Тесты

```bash
dotnet test apps/agent/tests/Speechpad.Agent.Tests.csproj
npm run test:agent
```

122 теста: разбор и печать горячих клавиш, настройки, протокол, планы ввода
(буфер и юникод, сурогаты, `Enter`), очередь вставки, поиск веб-корня, лицензия
(подпись, срок, привязка к компьютеру, подделка, пробный период, запрет вставки
без лицензии) и живые HTTP + WebSocket проверки на случайном порту:
`Origin`-фильтр, инъекция токена в `/`, `/index.html` и `/float.html`, отказ по
токену, обход каталога и полный цикл `hello` → `insert` → `inserted` → `ping`.
