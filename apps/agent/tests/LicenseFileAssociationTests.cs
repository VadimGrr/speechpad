using Speechpad.Agent.Startup;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class LicenseFileAssociationTests : IDisposable
{
    private readonly string root = $@"Software\SpeechpadTests\{Guid.NewGuid():N}";

    public void Dispose()
    {
        try
        {
            Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree($@"Software\SpeechpadTests", throwOnMissingSubKey: false);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
        }
    }

    [Fact]
    public void BuildsACommandThatPassesTheDoubleClickedFile()
    {
        var command = LicenseFileAssociation.CommandFor(@"C:\Program Files\Speechpad\Speechpad.exe");

        Assert.Equal("\"C:\\Program Files\\Speechpad\\Speechpad.exe\" --install-license \"%1\"", command);
    }

    [Fact]
    public void IsNotEnabledBeforeAnythingIsWritten()
    {
        Assert.False(LicenseFileAssociation.IsEnabled(root));
    }

    [Fact]
    public void BindsTheExtensionToTheProgram()
    {
        LicenseFileAssociation.Enable(@"C:\tmp\Speechpad.exe", root);

        Assert.True(LicenseFileAssociation.IsEnabled(root));
        using var extensionKey = Microsoft.Win32.Registry.CurrentUser.OpenSubKey($@"{root}\.lic");
        Assert.Equal(LicenseFileAssociation.ProgId, extensionKey?.GetValue(null) as string);
    }

    [Fact]
    public void WritesTheOpenCommandWindowsWillRun()
    {
        LicenseFileAssociation.Enable(@"C:\tmp\Speechpad.exe", root);

        using var command = Microsoft.Win32.Registry.CurrentUser.OpenSubKey($@"{root}\{LicenseFileAssociation.ProgId}\shell\open\command");
        Assert.Equal("\"C:\\tmp\\Speechpad.exe\" --install-license \"%1\"", command?.GetValue(null) as string);
    }

    [Fact]
    public void QuotesTheProgramPathSoSpacesDoNotBreakIt()
    {
        LicenseFileAssociation.Enable(@"C:\Program Files\Speechpad\Speechpad.exe", root);

        using var command = Microsoft.Win32.Registry.CurrentUser.OpenSubKey($@"{root}\{LicenseFileAssociation.ProgId}\shell\open\command");
        Assert.StartsWith("\"C:\\Program Files\\", command?.GetValue(null) as string, StringComparison.Ordinal);
    }

    [Fact]
    public void RefusesAnEmptyProgramPath()
    {
        Assert.Throws<ArgumentException>(() => LicenseFileAssociation.Enable("   ", root));
    }

    [Fact]
    public void UnbindsTheExtensionOnRequest()
    {
        LicenseFileAssociation.Enable(@"C:\tmp\Speechpad.exe", root);

        LicenseFileAssociation.Disable(root);

        Assert.False(LicenseFileAssociation.IsEnabled(root));
    }

    [Fact]
    public void RepeatedBindingIsSafe()
    {
        LicenseFileAssociation.Enable(@"C:\tmp\Speechpad.exe", root);
        LicenseFileAssociation.Enable(@"C:\tmp\other\Speechpad.exe", root);

        Assert.True(LicenseFileAssociation.IsEnabled(root));
        using var command = Microsoft.Win32.Registry.CurrentUser.OpenSubKey($@"{root}\{LicenseFileAssociation.ProgId}\shell\open\command");
        Assert.Contains("other", command?.GetValue(null) as string, StringComparison.Ordinal);
    }
}
