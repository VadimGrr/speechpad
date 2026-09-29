using Microsoft.Win32;

namespace Speechpad.Agent.Startup;

public static class AutoStart
{
    public const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string ValueName = "SpeechpadAgent";

    public static string CommandLine => CommandLineFor(Environment.ProcessPath ?? AppContext.BaseDirectory);

    public static string CommandLineFor(string executable)
        => $"\"{executable}\"";

    public static bool IsEnabled(string? runKeyPath = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath(runKeyPath));
        return key?.GetValue(ValueName) is string value && value.Contains(".exe", StringComparison.OrdinalIgnoreCase);
    }

    public static void Enable(string? runKeyPath = null)
    {
        using var key = Registry.CurrentUser.CreateSubKey(KeyPath(runKeyPath), writable: true)
            ?? throw new InvalidOperationException("не удалось открыть ключ автозапуска");
        key.SetValue(ValueName, CommandLine, RegistryValueKind.String);
    }

    public static void Disable(string? runKeyPath = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath(runKeyPath), writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    public static string Status(string? runKeyPath = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath(runKeyPath));
        var value = key?.GetValue(ValueName) as string;
        return value ?? string.Empty;
    }

    private static string KeyPath(string? runKeyPath) => runKeyPath ?? RunKeyPath;
}
