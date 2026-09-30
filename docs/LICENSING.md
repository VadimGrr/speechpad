# Лицензирование

Speechpad работает без сервера: распознавание идёт в браузере через Web Speech API, проверка лицензии — локально, по подписи. Никакой сервер не участвует в распознавании и не видит текст.

## Как это устроено

1. Лицензия — это JSON-файл `license.json` с двумя полями: `payload` (данные в base64url) и `signature` (подпись ECDSA P-256, SHA-256).
2. Агент хранит только публичный ключ (`apps/agent/Licensing/KeyPair.cs`) и проверяет подпись при каждом чтении файла.
3. Приватный ключ хранится только у вас, в репозитории его нет и не должно быть.
4. Подделать или продлить лицензию на чужом компьютере нельзя: любое изменение `payload` ломает подпись.

## Где лежит файл лицензии

По умолчанию `%APPDATA%\SpeechPad\license.json`. Путь меняется в `settings.json` (`licensePath`) или ключом `--license <путь>`.

## Что проверяется

- версия формата и продукт `speechpad-agent`;
- срок действия (`expires` пустой — бессрочная лицензия);
- привязка к компьютеру (`machine`, если задан);
- наличие нужной возможности: `insert`, `extension`, `topmost`.

Идентификатор компьютера: `sha256("speechpad|<имя компьютера>|<пользователь>|<MachineGuid>")`. Посмотреть можно командой:

```powershell
speechpad-agent.exe --license-info
```

## Пробный период

Если лицензии нет, агент даёт пробный период (`trialDays` в настройках, по умолчанию 2 дня) и записывает дату первого запуска в `license.json.trial`. Действующая лицензия всегда важнее пробного периода. Чтобы требовать лицензию без пробного периода, поставьте `requireLicense: true`.

## Проверка состояния

```powershell
speechpad-agent.exe --license-info
```

Код возврата `0` — лицензия или пробный период в порядке, `1` — лицензии нет.

Ответ агента `GET /health` содержит `licenseState`, `licenseMessage`, `insertAllowed`, `extensionAllowed`.

## Выпуск лицензии покупателю

Инструмент `tools/speechpad-license` (приватный ключ в него не входит).

```powershell
# выпуск на год для конкретного компьютера
dotnet run --project tools/speechpad-license -- issue C:\secrets\license-private.pem D:\Ivanov.json --licensee "Иван Иванов" --days 365 --machine 441377b2...

# бессрочная лицензия, работает на любом компьютере
dotnet run --project tools/speechpad-license -- issue C:\secrets\license-private.pem D:\Ivanov.json --licensee "Иван Иванов" --all-machines

# только вставка, без расширения и поверх-поверх окон
dotnet run --project tools/speechpad-license -- issue C:\secrets\license-private.pem D:\Ivanov.json --features insert

# посмотреть, что внутри
dotnet run --project tools/speechpad-license -- show D:\Ivanov.json
```

Дальше отправляете покупателю `Ivanov.json`, он кладёт файл в `%APPDATA%\SpeechPad\license.json`.

## Смена ключей

```powershell
dotnet run --project tools/speechpad-license -- keygen C:\secrets\license-private.pem C:\secrets\license-public.pem
```

Публичный ключ из `license-public.pem` вставьте в `apps/agent/Licensing/KeyPair.cs` и пересоберите агента. Старые лицензии после смены ключа перестают работать.

## Приватный ключ

Приватный ключ — единственный секрет продукта. Требования:

- не коммитить, не класть в архивы релиза и не отправлять покупателям;
- хранить вне репозитория (текущая копия: `C:\Users\vadim\Documents\speechpad-secrets\license-private.pem`);
- сделать резервную копию в другом месте: потеря ключа означает невозможность выпускать новые лицензии;
- при подозрении на утечку — сгенерировать новый ключ по инструкции выше.
