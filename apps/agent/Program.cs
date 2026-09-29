using System.Globalization;
using Speechpad.Agent;
using Speechpad.Agent.Insertion;
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

using var log = new AgentLog(AgentLog.DefaultPath, options.Verbose);
log.Info($"speechpad-agent starting, settings {settingsPath}");

var insertion = new InsertionService(InsertionSchemes.Create(options.InsertScheme));
new TrayApplication(options, log, insertion).Run();
insertion.Dispose();
return 0;

internal sealed record CommandLineOptions
{
    public bool ShowHelp { get; init; }

    public bool ListWindows { get; init; }

    public bool InstallAutostart { get; init; }

    public bool UninstallAutostart { get; init; }

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
          --help                    эта справка

        Ключи:
          --port <число>            порт локального сервера (по умолчанию 8787)
          --web-root <путь>         папка со собранным вебом (apps/web/dist)
          --scheme clipboard|unicode способ вставки текста
          --settings <путь>         файл настроек (по умолчанию settings.json рядом с exe)
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
