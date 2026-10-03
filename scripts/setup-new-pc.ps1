param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

Write-Host 'Speechpad: проверка окружения' -ForegroundColor Cyan

$problems = @()

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $problems += 'Node.js не найден. Установите Node.js 20 или новее: https://nodejs.org'
} else {
    $nodeVersion = (& node -v).TrimStart('v')
    Write-Host "  Node.js $nodeVersion"
    $major = [int]($nodeVersion -split '\.')[0]
    if ($major -lt 20) {
        $problems += "Node.js $nodeVersion слишком старый, нужен 20 или новее"
    }
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    $problems += '.NET SDK не найден. Установите .NET SDK 10.0.x: https://dotnet.microsoft.com/download'
} else {
    $sdks = & dotnet --list-sdks
    if (-not ($sdks | Select-String -Pattern '^10\.')) {
        $problems += "Установлен .NET SDK: $($sdks -join ', '). Нужен 10.0.x"
    } else {
        Write-Host "  .NET $(& dotnet --version)"
    }
}

if ($problems.Count -gt 0) {
    foreach ($problem in $problems) {
        Write-Host "  ОШИБКА: $problem" -ForegroundColor Red
    }
    exit 1
}

if (-not $SkipInstall) {
    Write-Host 'Установка зависимостей (npm install)' -ForegroundColor Cyan
    & npm install
    if ($LASTEXITCODE -ne 0) {
        throw 'npm install завершился с ошибкой'
    }
}

Write-Host 'Проверка сборкой и тестами' -ForegroundColor Cyan
& npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'typecheck провалился' }

& npm run test
if ($LASTEXITCODE -ne 0) { throw 'тесты web провалились' }

& npm run test:agent
if ($LASTEXITCODE -ne 0) { throw 'тесты агента провалились' }

& npm run portal:test
if ($LASTEXITCODE -ne 0) { throw 'тесты портала провалились' }

Write-Host ''
Write-Host 'Готово. Что дальше:' -ForegroundColor Green
Write-Host '  запуск агента:    npm run agent     затем http://127.0.0.1:8787/'
Write-Host '  портал выдачи:    npm run portal:init, затем npm run portal'
Write-Host '  релиз покупателю: npm run release'
Write-Host ''
Write-Host 'Приватный ключ в проекте отсутствует. Если нужно выпускать лицензии,'
Write-Host 'скопируйте папку speechpad-secrets отдельно и укажите путь через'
Write-Host '--private-key (по умолчанию C:\Users\<вы>\Documents\speechpad-secrets\license-private.pem).'
