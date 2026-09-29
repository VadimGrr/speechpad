# Speechpad API (SDK)

Ядро распознавания доступно как обычный скрипт: глобальный объект `Speechpad`.
Движок не зависит от DOM приложения — только события и колбэки, кастомный рендер
остаётся на стороне интегратора.

## Подключение

```html
<script src="speechpad.js"></script>
```

Требуется Chrome или Edge и защищённый контекст (`https`, `http://localhost`,
`http://127.0.0.1`). Доступ к микрофону запрашивается только после действия
пользователя.

Глобальный объект `Speechpad` экспортирует `SpeechpadEngine`, `createEngine`,
`version` и диагностические константы `DEFAULT_OPTIONS`, `DEFAULT_DEDUPE`,
`ERROR_MESSAGES`, `FATAL_ERRORS`, `RETRYABLE_ERRORS`. Для сборщиков есть
ESM-версия `speechpad.esm.js` с теми же именами.

## Готовый пример

`examples/embed` — посторонняя страница заметок, которая подключает ядро одним
тегом `<script>` и не зависит ни от агента, ни от главного окна приложения.

Онлайн: **https://vadimgrr.github.io/speechpad/** — сайт собирается из этого же
каталога и `packages/core/dist` рабочим процессом
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) при каждом
пуше в `master`.

Локально, если нужно править код и проверять без интернета:

```
npm run build
npm run example:embed
```

Затем откройте `http://127.0.0.1:5174/`, нажмите «Диктовать» и разрешите
микрофон. Оба адреса работают: страница отдаётся по `https`, поэтому
`isSecureContext` истинный и браузер разрешает микрофон. Пример показывает все
события SDK, метрики и очистку текста.

Текст заметки пример хранит в `localStorage` и после загрузки подставляет его
в движок через `syncTranscript(text)`, поэтому перезагрузка страницы не стирает
диктовку, а дедупликация видит хвост предыдущей речи. Сбросить текст можно
кнопкой «Очистить».

## Минимальный пример

```js
const sp = new Speechpad.SpeechpadEngine({ lang: 'ru-RU', continuous: true });

sp.on('partial', (text) => renderGhost(text));
sp.on('final', (text) => appendToTranscript(text));
sp.on('state', (state) => setState(state));
sp.on('error', (info) => showError(info.message));

document.querySelector('#start').addEventListener('click', () => sp.start());
```

## Конструктор

`new Speechpad.SpeechpadEngine(options?)`

| Опция | По умолчанию | Смысл |
| --- | --- | --- |
| `lang` | `'ru-RU'` | язык распознавания |
| `continuous` | `true` | непрерывный режим |
| `interimResults` | `true` | нужны промежуточные гипотезы |
| `maxAlternatives` | `1` | количество альтернатив |
| `restartDelayMs` | `400` | базовая задержка автоперезапуска |
| `maxRestartDelayMs` | `3000` | потолок экспоненциальной задержки |
| `silentEndLimit` | `3` | столько тихих `onend` подряд переключает на паузу |
| `silentEndDelayMs` | `1500` | пауза при серии тихих `onend` |
| `minRestartGapMs` | `300` | минимальный интервал между попытками старта |
| `watchdogMs` | `12000` | тишина, после которой включается рестарт |
| `watchdogCooldownMs` | `5000` | минимальный интервал между рестартами |
| `watchdogMaxMs` | `60000` | потолок растущего порога watchdog |
| `watchdogCheckMs` | `1000` | как часто watchdog проверяет тишину |
| `recycleAfterMs` | `1500000` | пересоздание распознавателя раз в 25 мин |
| `recycleQuietMs` | `1500` | пауза в речи, в которой делается пересоздание |
| `dedupe` | см. ниже | настройки защиты от повторов |
| `clock` | внутренний | подмена часов, только для тестов |
| `factory` | внутренний | подмена распознавателя, только для тестов |

`dedupe` (все поля опциональны):

| Поле | По умолчанию | Смысл |
| --- | --- | --- |
| `tailWindowChars` | `200` | размер окна хвоста для сравнения |
| `minOverlapChars` | `4` | минимальная длина перекрытия |
| `minDropChars` | `5` | короче этого фрагмент не выбрасывается целиком |
| `minContainChars` | `12` | минимальная длина для поиска внутри хвоста |
| `stripPunctuation` | `true` | игнорировать пунктуацию при сравнении |
| `lowercase` | `true` | игнорировать регистр |
| `yoAsE` | `true` | считать `ё` и `е` одинаковыми |
| `collapseWhitespace` | `true` | схлопывать пробелы |

## События

| Событие | Полезная нагрузка | Когда |
| --- | --- | --- |
| `partial` | `string` | промежуточная гипотеза текущей фразы |
| `final` | `string` | фрагмент принят и добавлен в стенограмму |
| `duplicate` | `{ text, reason }` | фрагмент отброшен защитой от повторов |
| `state` | `'idle' \| 'listening' \| 'paused' \| 'error'` | смена состояния |
| `error` | `{ code, fatal, message, at }` | ошибка распознавания |
| `restart` | `{ reason, delayMs, attempt }` | автоперезапуск сессии |
| `metrics` | `Metrics` | счётчики движка |

`reason` у `duplicate`: `exact-tail`, `suffix-overlap`, `contained-in-tail`,
`recent-repeat`, `empty`.

`reason` у `restart`: `start`, `end`, `watchdog`, `error`, `recycle`, `lang`.

Каждый `on()` возвращает функцию отписки.

## Методы

| Метод | Действие |
| --- | --- |
| `start()` | начать/продолжить распознавание |
| `pause()` | остановить сессию, стенограмма сохраняется |
| `stop()` | полная остановка, состояние `idle` |
| `toggle()` | `pause()`, если слушаем, иначе `start()` |
| `clear()` | очистить стенограмму движка |
| `setLang(lang)` | сменить язык, активная сессия перезапускается |
| `syncTranscript(text)` | подставить внешний текст (после ручной правки) |
| `destroy()` | снять все слушатели и освободить ресурсы |

## Свойства

| Свойство | Тип | Смысл |
| --- | --- | --- |
| `state` | `PublicState` | текущее состояние |
| `transcript` | `string` | накопленный текст |
| `interim` | `string` | текущая промежуточная гипотеза |
| `metrics` | `Metrics` | снимок метрик |
| `isSupported` | `boolean` | есть ли Web Speech API |
| `unsupportedReason` | `string \| null` | `not-supported` или `insecure-context` |
| `lang` | `string` | текущий язык |

`Speechpad.SpeechpadEngine.isSupported(scope?)` — статическая проверка.

## Метрики

| Поле | Смысл |
| --- | --- |
| `restarts` | всего перезапусков сессии |
| `watchdogRestarts` | из них по watchdog |
| `recycles` | из них по плановому пересозданию |
| `silentEnds` | сколько раз сессия завершилась сама |
| `duplicatesBlocked` | сколько повторов отброшено |
| `finals` | сколько фрагментов попало в стенограмму |
| `firstInterimAfterStartMs` | задержка до первого результата от старта |
| `lastInterimAfterRestartMs` | задержка до первого результата после рестарта |
| `avgInterimIntervalMs` | средний интервал между обновлениями интерма |
| `maxSilenceGapMs` | самая длинная тишина без результата |
| `lastResultAt`, `lastRestartAt`, `startedAt` | метки времени (мс) |
| `state` | снимок состояния |

## Гарантии непрерывности

Движок сам перезапускает сессию, если Chrome её закрыл, отбрасывает повторно
пришедший хвост фразы, следит за зависанием по watchdog и пересоздаёт
распознаватель на длинных сессиях. Приложению не нужно реализовывать ретраи:
достаточно подписаться на `final` и рисовать текст.
