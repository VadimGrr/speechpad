using System.Security.Cryptography;
using Speechpad.Agent.Licensing;

namespace Speechpad.Agent.Tests;

internal static class LicenseFixture
{
    private static readonly Lazy<(string PrivatePem, string PublicPem)> Keys = new(Generate);

    public static string PublicPem => Keys.Value.PublicPem;

    public static LicenseGate Valid()
        => WithFeatures(
            LicenseLimits.FeatureInsert,
            LicenseLimits.FeatureExtension,
            LicenseLimits.FeatureTopmost);

    public static LicenseGate WithoutLicense()
        => new(
            MissingPath(),
            Keys.Value.PublicPem,
            machineId: "TEST-MACHINE");

    public static LicenseGate WithFeatures(params string[] features)
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-lic-{Guid.NewGuid():N}.json");
        File.WriteAllText(
            path,
            LicenseSigner.Sign(
                new LicensePayload
                {
                    Issued = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
                    Expires = new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero),
                    Features = features,
                },
                Keys.Value.PrivatePem));
        return new LicenseGate(path, Keys.Value.PublicPem, machineId: "TEST-MACHINE");
    }

    private static string MissingPath()
        => Path.Combine(Path.GetTempPath(), $"speechpad-none-{Guid.NewGuid():N}.json");

    private static (string PrivatePem, string PublicPem) Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (key.ExportPkcs8PrivateKeyPem(), key.ExportSubjectPublicKeyInfoPem());
    }
}
