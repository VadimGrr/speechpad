using Microsoft.Win32;
using Speechpad.Agent.Startup;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class AutoStartTests : IDisposable
{
    private readonly string _scratchKey = $@"Software\Speechpad\tests\{Guid.NewGuid():N}";

    public void Dispose()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Speechpad\tests", writable: true);
            key?.DeleteSubKeyTree(_scratchKey.Split('\\')[^1], throwOnMissingSubKey: false);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException)
        {
        }
    }

    [Fact]
    public void DefaultKeyIsThePerUserRunKey()
    {
        Assert.Equal(@"Software\Microsoft\Windows\CurrentVersion\Run", AutoStart.RunKeyPath);
        Assert.Equal("SpeechpadAgent", AutoStart.ValueName);
    }

    [Fact]
    public void CommandLineQuotesExecutablePath()
    {
        Assert.Equal(
            "\"C:\\Program Files\\Speechpad\\speechpad-agent.exe\"",
            AutoStart.CommandLineFor(@"C:\Program Files\Speechpad\speechpad-agent.exe"));
    }

    [Fact]
    public void EnableWritesQuotedExeAndIsIdempotent()
    {
        Assert.False(AutoStart.IsEnabled(_scratchKey));

        AutoStart.Enable(_scratchKey);
        AutoStart.Enable(_scratchKey);

        Assert.True(AutoStart.IsEnabled(_scratchKey));
        var value = AutoStart.Status(_scratchKey);
        Assert.StartsWith("\"", value);
        Assert.EndsWith("\"", value);
        Assert.Contains(".exe", value, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void DisableRemovesValueAndToleratesMissingKey()
    {
        AutoStart.Enable(_scratchKey);
        AutoStart.Disable(_scratchKey);
        AutoStart.Disable(_scratchKey);

        Assert.False(AutoStart.IsEnabled(_scratchKey));
        Assert.Equal(string.Empty, AutoStart.Status(_scratchKey));
    }

    [Fact]
    public void ForeignValueIsNotTreatedAsEnabled()
    {
        using var key = Registry.CurrentUser.CreateSubKey(_scratchKey, writable: true);
        key.SetValue(AutoStart.ValueName, "not-an-executable", RegistryValueKind.String);

        Assert.False(AutoStart.IsEnabled(_scratchKey));
    }

    [Fact]
    public void ProductionRunKeyIsNotTouchedByTests()
    {
        var before = AutoStart.Status();

        AutoStart.Enable(_scratchKey);
        AutoStart.Disable(_scratchKey);

        Assert.Equal(before, AutoStart.Status());
    }
}
