using Microsoft.Win32;

namespace Speechpad.Agent.Startup;

public static class LicenseFileAssociation
{
    public const string Extension = ".lic";

    public const string ProgId = "Speechpad.LicenseFile";

    public const string ClassesRoot = @"Software\Classes";

    public const string DisplayName = "Лицензия Speechpad";

    public const string Description = "Лицензия Speechpad";

    public static string CommandFor(string executable, string argument = "--install-license")
        => $"\"{executable}\" {argument} \"%1\"";

    public static bool IsEnabled(string? classesRoot = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath(Extension, classesRoot));
        return string.Equals(key?.GetValue(null) as string, ProgId, StringComparison.Ordinal);
    }

    public static void Enable(string executable, string? classesRoot = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executable);

        using (var extensionKey = Registry.CurrentUser.CreateSubKey(KeyPath(Extension, classesRoot), writable: true))
        {
            if (extensionKey is null)
            {
                throw new InvalidOperationException("не удалось создать ключ для расширения .lic");
            }

            extensionKey.SetValue(null, ProgId, RegistryValueKind.String);
        }

        using var progId = Registry.CurrentUser.CreateSubKey(KeyPath(ProgId, classesRoot), writable: true)
            ?? throw new InvalidOperationException("не удалось создать ключ типа файла");
        progId.SetValue(null, DisplayName, RegistryValueKind.String);

        using (var icon = progId.CreateSubKey("DefaultIcon", writable: true))
        {
            icon?.SetValue(null, $"\"{executable}\",0", RegistryValueKind.String);
        }

        using var command = progId.CreateSubKey("shell\\open\\command", writable: true)
            ?? throw new InvalidOperationException("не удалось создать команду открытия .lic");
        command.SetValue(null, CommandFor(executable), RegistryValueKind.String);
    }

    public static void Disable(string? classesRoot = null)
    {
        using (var extensionKey = Registry.CurrentUser.OpenSubKey(KeyPath(Extension, classesRoot), writable: true))
        {
            extensionKey?.DeleteValue(string.Empty, throwOnMissingValue: false);
        }

        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(KeyPath(ProgId, classesRoot));
        }
        catch (System.Security.SecurityException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
        catch (IOException)
        {
        }
    }

    private static string KeyPath(string name, string? classesRoot)
        => classesRoot is null
            ? $@"{ClassesRoot}\{name}"
            : $@"{classesRoot}\{name}";
}
