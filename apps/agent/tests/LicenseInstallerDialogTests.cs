using Speechpad.Agent.Licensing;
using Speechpad.Agent.Licensing.Install;
using Speechpad.Agent.Tray;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class LicenseInstallerDialogTests
{
    private static LicenseInstallResult Installed() => new()
    {
        Installed = true,
        State = LicenseState.Valid,
        Message = "бессрочная лицензия",
        Licensee = "Иван Иванов",
        Expires = "бессрочно",
        Features = "insert, extension",
        Machine = "любой компьютер",
    };

    [Fact]
    public void ConfirmsInstallationInTheTitle()
    {
        Assert.Contains("установлена", LicenseInstallerDialog.Title(Installed()), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void WarnsInTheTitleWhenTheFileIsRefused()
    {
        var title = LicenseInstallerDialog.Title(LicenseInstaller.Reject("подпись не прошла проверку"));

        Assert.Contains("не установлена", title, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ShowsWhoTheLicenseIsFor()
    {
        var message = LicenseInstallerDialog.Message(Installed());

        Assert.Contains("Иван Иванов", message, StringComparison.Ordinal);
    }

    [Fact]
    public void ShowsTheTerm()
    {
        Assert.Contains("бессрочно", LicenseInstallerDialog.Message(Installed()), StringComparison.Ordinal);
    }

    [Fact]
    public void ShowsTheTermAsADateWhenItExpires()
    {
        var result = Installed() with { Expires = "2027-10-01" };

        Assert.Contains("2027-10-01", LicenseInstallerDialog.Message(result), StringComparison.Ordinal);
    }

    [Fact]
    public void ShowsWhatTheLicenseAllows()
    {
        Assert.Contains("insert", LicenseInstallerDialog.Message(Installed()), StringComparison.Ordinal);
    }

    [Fact]
    public void ExplainsAReplacementWhenOneWasAlreadyInstalled()
    {
        var result = Installed() with { Previous = "действует до 2026-01-01" };

        var message = LicenseInstallerDialog.Message(result);

        Assert.Contains("Прежняя лицензия заменена", message, StringComparison.Ordinal);
        Assert.Contains("2026-01-01", message, StringComparison.Ordinal);
    }

    [Fact]
    public void KeepsTheProgramWorkingWhenTheFileIsRefused()
    {
        var message = LicenseInstallerDialog.Message(LicenseInstaller.Reject("подпись не прошла проверку"));

        Assert.Contains("без изменений", message, StringComparison.Ordinal);
        Assert.Contains("подпись", message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SkipsTheMachineLineWhenItIsNotRelevant()
    {
        var result = Installed() with { Machine = string.Empty };

        Assert.DoesNotContain("Компьютер:", LicenseInstallerDialog.Message(result), StringComparison.Ordinal);
    }
}
