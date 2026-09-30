using System.Security.Cryptography;
using Speechpad.Agent.Licensing;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class LicenseToolTests
{
    private static readonly Lazy<(string PrivatePem, string PublicPem)> Keys = new(Generate);

    [Fact]
    public void IssuedLicenseIsAcceptedByTheVerifier()
    {
        var license = Issue(new LicensePayload { Features = [LicenseLimits.FeatureInsert] });
        var check = new LicenseVerifier(Keys.Value.PublicPem).Verify(license, DateTimeOffset.Now);
        Assert.True(check.IsValid);
        Assert.True(check.Allows(LicenseLimits.FeatureInsert));
        Assert.False(check.Allows(LicenseLimits.FeatureExtension));
    }

    [Fact]
    public void LicenseFromAnotherKeyIsRejected()
    {
        var license = Issue(new LicensePayload { Features = [LicenseLimits.FeatureInsert] });
        using var other = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var check = new LicenseVerifier(other.ExportSubjectPublicKeyInfoPem()).Verify(license, DateTimeOffset.Now);
        Assert.Equal(LicenseState.Invalid, check.State);
    }

    [Fact]
    public void ExpiredLicenseIsReportedAsExpired()
    {
        var license = Issue(new LicensePayload
        {
            Features = [LicenseLimits.FeatureInsert],
            Expires = DateTimeOffset.Now.AddDays(-1),
        });
        var check = new LicenseVerifier(Keys.Value.PublicPem).Verify(license, DateTimeOffset.Now);
        Assert.Equal(LicenseState.Expired, check.State);
    }

    [Fact]
    public void MachineBindingIsEnforced()
    {
        var license = Issue(new LicensePayload
        {
            Features = [LicenseLimits.FeatureInsert],
            Machine = "OTHER-MACHINE",
        });
        var check = new LicenseVerifier(Keys.Value.PublicPem).Verify(license, DateTimeOffset.Now, "THIS-MACHINE");
        Assert.Equal(LicenseState.Invalid, check.State);
        Assert.Contains("другой компьютер", check.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TamperedPayloadIsRejected()
    {
        var license = Issue(new LicensePayload { Features = [LicenseLimits.FeatureInsert] });
        var envelope = System.Text.Json.JsonSerializer.Deserialize<LicenseEnvelope>(license, LicenseJson.Options)!;
        var raw = System.Text.Encoding.UTF8.GetString(Base64Url.Decode(envelope.Payload));
        var swapped = raw.Replace(LicenseLimits.FeatureInsert, LicenseLimits.FeatureTopmost, StringComparison.Ordinal);
        Assert.NotEqual(raw, swapped);
        envelope = envelope with { Payload = Base64Url.Encode(System.Text.Encoding.UTF8.GetBytes(swapped)) };
        var tampered = System.Text.Json.JsonSerializer.Serialize(envelope, LicenseJson.Options);
        var check = new LicenseVerifier(Keys.Value.PublicPem).Verify(tampered, DateTimeOffset.Now);
        Assert.Equal(LicenseState.Invalid, check.State);
    }

    private static string Issue(LicensePayload payload)
        => LicenseSigner.Sign(
            new LicensePayload
            {
                Licensee = payload.Licensee ?? "Тест",
                Issued = payload.Issued,
                Expires = payload.Expires,
                Features = payload.Features,
                Machine = payload.Machine,
            },
            Keys.Value.PrivatePem);

    private static (string PrivatePem, string PublicPem) Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (key.ExportPkcs8PrivateKeyPem(), key.ExportSubjectPublicKeyInfoPem());
    }
}
