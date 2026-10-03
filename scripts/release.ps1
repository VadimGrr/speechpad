param(
    [string]$Configuration = 'Release',
    [string]$Runtime = 'win-x64',
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Invoke-Step([string]$Name, [scriptblock]$Action) {
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

try {
    $version = (Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
    $stage = Join-Path $root "release\Speechpad-$version"
    $zip = Join-Path $root "release\Speechpad-$version-win-x64.zip"

    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    if (-not $SkipTests) {
        Invoke-Step 'tests: web' { npm run test }
        Invoke-Step 'tests: agent' { dotnet test apps/agent/tests/Speechpad.Agent.Tests.csproj }
        Invoke-Step 'tests: portal' { dotnet test tools/speechpad-license-portal/tests/Speechpad.LicensePortal.Tests.csproj }
    }

    Invoke-Step 'build: web' { npm run build -w @speechpad/web }
    Invoke-Step 'build: extension' { npm run build -w @speechpad/extension }

    Invoke-Step 'publish: agent' {
        dotnet publish apps/agent/Speechpad.Agent.csproj -c $Configuration -r $Runtime `
            --self-contained true `
            -p:PublishSingleFile=true `
            -p:IncludeNativeLibrariesForSelfExtract=true `
            -p:EnableCompressionInSingleFile=true `
            -p:DebugType=none `
            -p:DebugSymbols=false `
            -p:SatelliteResourceLanguages=ru `
            -o "release\publish\$Runtime"
    }

    Invoke-Step 'stage: agent' {
        Copy-Item -LiteralPath "release\publish\$Runtime\speechpad-agent.exe" -Destination (Join-Path $stage 'Speechpad.exe')
        foreach ($extra in @('web.config', 'speechpad-agent.staticwebassets.endpoints.json')) {
            $noise = Join-Path "release\publish\$Runtime" $extra
            if (Test-Path -LiteralPath $noise) {
                Remove-Item -LiteralPath $noise -Force
            }
        }
    }

    Invoke-Step 'stage: web' {
        Copy-Item -LiteralPath 'apps\web\dist' -Destination (Join-Path $stage 'web') -Recurse
    }

    $extension = Join-Path $root 'apps\extension\dist'
    if (Test-Path -LiteralPath $extension) {
        Invoke-Step 'stage: extension' {
            Copy-Item -LiteralPath $extension -Destination (Join-Path $stage 'extension') -Recurse
        }
    }

    Invoke-Step 'stage: readme' {
        Copy-Item -LiteralPath 'docs\BUYER-START.md' -Destination (Join-Path $stage 'КАК-УСТАНОВИТЬ.txt')
    }

    if (Test-Path -LiteralPath $zip) {
        Remove-Item -LiteralPath $zip -Force
    }

    Invoke-Step 'zip' {
        Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
    }

    $sizeMb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
    Write-Host "release ready: $zip ($sizeMb MB)" -ForegroundColor Green
    Write-Host "buyer flow: extract, run Speechpad.exe, double-click the .lic file" -ForegroundColor Green
}
finally {
    Pop-Location
}
