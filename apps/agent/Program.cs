using System.Globalization;
using Speechpad.Agent;
using Speechpad.Agent.Insertion;
using Speechpad.Agent.Licensing;
using Speechpad.Agent.Licensing.Install;
using Speechpad.Agent.Startup;
using Speechpad.Agent.Tray;
using Speechpad.Agent.Windows;

var cli = CommandLine.Parse(args);

if (cli.ShowHelp)
{
    Console.WriteLine(CommandLine.Help);
    return 0;
}

if (cli.ListWindows)
{
    foreach (var window in WindowTools.ListVisible())
    {
        Console.WriteLine($"{window.ProcessId,6}  {window.Title}");
    }

    return 0;
}

if (cli.InstallAutostart)
{
    AutoStart.Enable();
    Console.WriteLine($"автозапуск включён: {AutoStart.CommandLine}");
    return 0;
}

if (cli.UninstallAutostart)
{
    AutoStart.Disable();
    Console.WriteLine("автозапуск выключен");
    return 0;
}

var settingsPath = cli.SettingsPath ?? OptionsStore.DefaultPath;
var options = OptionsStore.Load(settingsPath);
cli.Apply(options);

var problems = options.Validate();
if (problems.Count > 0)
{
    foreach (var problem in problems)
    {
        Console.Error.WriteLine($"ошибка настроек: {problem}");
    }

    Console.Error.WriteLine($"файл настроек: {settingsPath}");
    return 2;
}

var licensePath = cli.LicensePath ?? options.LicensePath ?? LicenseLocations.DefaultPath;

if (cli.InstallLicense is { } licenseToInstall)
{
    var installer = new LicenseInstaller(
        licensePath,
        KeyPair.PublicKeyPem,
        machineId: () => cli.MachineId ?? MachineId.Detect());
    var outcome = installer.Install(licenseToInstall);
    return LicenseInstallerDialog.Show(outcome).Installed ? 0 : 1;
}

var licenseGate = new LicenseGate(
    licensePath,
    KeyPair.PublicKeyPem,
    log: null,
    machineId: cli.MachineId,
    trialDays: options.RequireLicense ? 0 : options.TrialDays);

if (cli.LicenseInfo)
{
    Console.WriteLine($"файл: {licenseGate.Path}");
    Console.WriteLine($"компьютер: {licenseGate.MachineId ?? "не определён"}");
    Console.WriteLine($"состояние: {licenseGate.State.ToString().ToLowerInvariant()}");
    Console.WriteLine($"причина: {licenseGate.Message}");
    Console.WriteLine($"вставка: {(licenseGate.AllowsInsert ? "разрешена" : "запрещена")}");
    Console.WriteLine($"расширение: {(licenseGate.AllowsExtension ? "разрешено" : "запрещено")}");
    return licenseGate.IsValid || licenseGate.InTrial ? 0 : 1;
}

if (options.RequireLicense && !licenseGate.IsValid && !licenseGate.InTrial)
{
    Console.Error.WriteLine($"требуется действующая лицензия: {licenseGate.Message}");
    Console.Error.WriteLine($"файл лицензии: {licenseGate.Path}");
    return 3;
}

using var agentLog = new AgentLog(AgentLog.DefaultPath, options.Verbose);
agentLog.Info($"speechpad-agent starting, settings {settingsPath}");

var insertionQueue = new InsertionService(InsertionSchemes.Create(options.InsertScheme));
new TrayApplication(options, agentLog, insertionQueue, licenseGate).Run();
insertionQueue.Dispose();
return 0;

internal sealed record CommandLineOptions
{
    public bool ShowHelp { get; init; }

    public bool ListWindows { get; init; }

    public bool InstallAutostart { get; init; }

    public bool UninstallAutostart { get; init; }

    public bool LicenseInfo { get; init; }

    public string? InstallLicense { get; init; }

    public string? LicensePath { get; init; }

    public string? MachineId { get; init; }

    public string? SettingsPath { get; init; }

    public int? Port { get; init; }

    public string? WebRoot { get; init; }

    public string? Scheme { get; init; }

    public bool NoTray { get; init; }

    public bool Verbose { get; init; }

    public void Apply(AgentOptions options)
    {
        if (Port is not null)
        {
            options.Port = Port.Value;
        }

        if (WebRoot is not null)
        {
            options.WebRoot = WebRoot;
        }

        if (Scheme is not null)
        {
            options.InsertScheme = Scheme.ToLowerInvariant() switch
            {
                "unicode" => InsertScheme.UnicodeInput,
                "clipboard" => InsertScheme.ClipboardPaste,
                _ => options.InsertScheme,
            };
        }

        if (NoTray)
        {
            options.TrayIcon = false;
        }

        if (Verbose)
        {
            options.Verbose = true;
        }

        if (LicensePath is not null)
        {
            options.LicensePath = LicensePath;
        }
    }
}

internal static class CommandLine
{
    public const string Help = """
        speechpad-agent — локальный помощник Speechpad

        Использование: speechpad-agent [команды] [ключи]

        Команды:
          --list-windows            показать видимые окна (нужно для проверки заголовков)
          --install-autostart       включить автозапуск при входе в Windows
          --uninstall-autostart     выключить автозапуск
          --license-info            показать состояние лицензии и выйти
          --install-license <путь>  установить лицензию из файла .lic и выйти
          --help                    эта справка

        Ключи:
          --port <число>            порт локального сервера (по умолчанию 8787)
          --web-root <путь>         папка со собранным вебом (apps/web/dist)
          --scheme clipboard|unicode способ вставки текста
          --settings <путь>         файл настроек (по умолчанию settings.json рядом с exe)
          --license <путь>          файл лицензии (по умолчанию %APPDATA%\SpeechPad\license.json)
          --machine-id <идентификатор> подменить id компьютера при проверке лицензии
          --no-tray                 не показывать иконку в трее
          --verbose                 подробный журнал
        """;

    public static CommandLineOptions Parse(string[] args)
    {
        var options = new CommandLineOptions();
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--help" or "-h" or "/?":
                    return options with { ShowHelp = true };
                case "--list-windows":
                    return options with { ListWindows = true };
                case "--install-autostart":
                    return options with { InstallAutostart = true };
                case "--uninstall-autostart":
                    return options with { UninstallAutostart = true };
                case "--license-info":
                    options = options with { LicenseInfo = true };
                    break;
                case "--install-license" when i + 1 < args.Length:
                    options = options with { InstallLicense = args[++i] };
                    break;
                case "--license" when i + 1 < args.Length:
                    options = options with { LicensePath = args[++i] };
                    break;
                case "--machine-id" when i + 1 < args.Length:
                    options = options with { MachineId = args[++i] };
                    break;
                case "--no-tray":
                    options = options with { NoTray = true };
                    break;
                case "--verbose":
                    options = options with { Verbose = true };
                    break;
                case "--port" when i + 1 < args.Length:
                    if (int.TryParse(args[++i], NumberStyles.Integer, CultureInfo.InvariantCulture, out var port))
                    {
                        options = options with { Port = port };
                    }

                    break;
                case "--web-root" when i + 1 < args.Length:
                    options = options with { WebRoot = args[++i] };
                    break;
                case "--scheme" when i + 1 < args.Length:
                    options = options with { Scheme = args[++i] };
                    break;
                case "--settings" when i + 1 < args.Length:
                    options = options with { SettingsPath = args[++i] };
                    break;
                default:
                    break;
            }
        }

        return options;
    }
}
