using System.Security.Cryptography;
using Speechpad.Agent.Licensing;
using Speechpad.Agent.Licensing.Install;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class LicenseInstallerTests : IDisposable
{
    private static readonly Lazy<(string PrivatePem, string PublicPem)> Keys = new(Generate);
    private readonly string directory = Path.Combine(Path.GetTempPath(), $"speechpad-inst-{Guid.NewGuid():N}");

    public LicenseInstallerTests() => Directory.CreateDirectory(directory);

    public void Dispose()
    {
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private static (string PrivatePem, string PublicPem) Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (key.ExportPkcs8PrivateKeyPem(), key.ExportSubjectPublicKeyInfoPem());
    }

    private string Destination => Path.Combine(directory, "license.json");

    private LicenseInstaller Installer(string? machineId = "TEST-MACHINE")
        => new(
            Destination,
            Keys.Value.PublicPem,
            clock: () => new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero),
            machineId: () => machineId);

    private string WriteSource(
        string fileName = "Speechpad-Иванов.lic",
        string? licensee = "Иван Иванов",
        string? machine = null,
        DateTimeOffset? expires = null,
        string[]? features = null)
    {
        var path = Path.Combine(directory, fileName);
        File.WriteAllText(
            path,
            LicenseSigner.Sign(
                new LicensePayload
                {
                    Licensee = licensee ?? "unknown",
                    Issued = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
                    Expires = expires,
                    Machine = machine,
                    Features = features ?? [LicenseLimits.FeatureInsert, LicenseLimits.FeatureExtension],
                },
                Keys.Value.PrivatePem));
        return path;
    }

    [Fact]
    public void InstallsAValidLicenseIntoTheAppDataPath()
    {
        var source = WriteSource();

        var result = Installer().Install(source);

        Assert.True(result.Installed);
        Assert.Equal(LicenseState.Valid, result.State);
        Assert.Equal("Иван Иванов", result.Licensee);
        Assert.True(File.Exists(Destination));
    }

    [Fact]
    public void InstalledLicenseIsAcceptedByTheGate()
    {
        var source = WriteSource();
        Installer().Install(source);

        var gate = new LicenseGate(Destination, Keys.Value.PublicPem, machineId: "TEST-MACHINE");

        Assert.True(gate.IsValid);
        Assert.True(gate.AllowsInsert);
        Assert.True(gate.AllowsExtension);
    }

    [Fact]
    public void CreatesTheAppDataFolderWhenItIsMissing()
    {
        var nested = Path.Combine(directory, "SpeechPad", "license.json");
        var source = WriteSource();
        var installer = new LicenseInstaller(
            nested,
            Keys.Value.PublicPem,
            machineId: () => "TEST-MACHINE");

        var result = installer.Install(source);

        Assert.True(result.Installed);
        Assert.True(File.Exists(nested));
    }

    [Fact]
    public void RefusesATamperedLicenseAndLeavesTheOldOneInPlace()
    {
        Installer().Install(WriteSource());
        var tampered = Path.Combine(directory, "broken.lic");
        var original = File.ReadAllText(Destination).Replace("\"signature\":\"", "\"signature\":\"x");
        File.WriteAllText(tampered, original);

        var result = Installer().Install(tampered);

        Assert.False(result.Installed);
        Assert.Contains("подпись", result.Message, StringComparison.OrdinalIgnoreCase);
        Assert.True(File.Exists(Destination));
        Assert.DoesNotContain(tampered, File.ReadAllText(Destination), StringComparison.Ordinal);
    }

    [Fact]
    public void RefusesALicenseIssuedForAnotherComputer()
    {
        var source = WriteSource(machine: "SOMEONE-ELSE");

        var result = Installer().Install(source);

        Assert.False(result.Installed);
        Assert.Contains("другой компьютер", result.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(File.Exists(Destination));
    }

    [Fact]
    public void AcceptsALicenseBoundToThisComputer()
    {
        var source = WriteSource(machine: "TEST-MACHINE");

        var result = Installer().Install(source);

        Assert.True(result.Installed);
    }

    [Fact]
    public void RefusesAnExpiredLicense()
    {
        var source = WriteSource(expires: new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero));

        var result = Installer().Install(source);

        Assert.False(result.Installed);
        Assert.Equal(LicenseState.Expired, result.State);
        Assert.False(File.Exists(Destination));
    }

    [Fact]
    public void ReportsAMissingFileWithoutThrowing()
    {
        var result = Installer().Install(Path.Combine(directory, "нет-такого.lic"));

        Assert.False(result.Installed);
        Assert.Contains("не найден", result.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ReportsAnUnreadableFileWithoutThrowing()
    {
        var junk = Path.Combine(directory, "junk.lic");
        File.WriteAllText(junk, "это не лицензия");

        var result = Installer().Install(junk);

        Assert.False(result.Installed);
        Assert.False(string.IsNullOrWhiteSpace(result.Message));
    }

    [Fact]
    public void KeepsTheTemporaryFileItWritesWhileInstalling()
    {
        var source = WriteSource();

        Installer().Install(source);

        Assert.False(File.Exists(Destination + ".new"));
    }

    [Fact]
    public void ReplacesAPreviousLicenseAndSaysWhatItWas()
    {
        Installer().Install(WriteSource(licensee: "Первый покупатель", expires: null));
        var second = WriteSource(fileName: "Speechpad-Второй.lic", licensee: "Второй покупатель");

        var result = Installer().Install(second);

        Assert.True(result.Installed);
        Assert.Equal("Второй покупатель", result.Licensee);
        Assert.Contains("бессрочная", result.Previous, StringComparison.OrdinalIgnoreCase);
        var gate = new LicenseGate(Destination, Keys.Value.PublicPem, machineId: "TEST-MACHINE");
        Assert.Equal("Второй покупатель", gate.Current.Payload?.Licensee);
    }

    [Fact]
    public void ReportsTheTermAsPerpetualWhenThereIsNoExpiry()
    {
        var source = WriteSource(expires: null);

        var result = Installer().Install(source);

        Assert.Equal("бессрочно", result.Expires);
    }

    [Fact]
    public void ReportsAnyComputerWhenTheLicenseIsNotBound()
    {
        var result = Installer().Install(WriteSource(machine: null));

        Assert.Equal("любой компьютер", result.Machine);
    }

    [Fact]
    public void ReadsWithoutWritingSoYouCanPreviewAFile()
    {
        var source = WriteSource();

        var result = Installer().Read(source);

        Assert.True(result.Installed);
        Assert.False(File.Exists(Destination));
    }

    [Fact]
    public void RecognizesTheLicExtensionCaseInsensitively()
    {
        Assert.True(LicenseInstaller.LooksLikeLicenseFile("C:\\tmp\\Ivan.LIC"));
        Assert.True(LicenseInstaller.LooksLikeLicenseFile("C:\\tmp\\Ivan.lic"));
        Assert.False(LicenseInstaller.LooksLikeLicenseFile("C:\\tmp\\Ivan.json"));
    }

    [Fact]
    public void WritesUtf8WithoutABomSoTheAgentReadsIt()
    {
        var source = WriteSource(licensee: "Иван Иванов");

        Installer().Install(source);

        var bytes = File.ReadAllBytes(Destination);
        Assert.Equal((byte)'{', bytes[0]);
    }
}
