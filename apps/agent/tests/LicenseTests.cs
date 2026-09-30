using System.Security.Cryptography;
using System.Text.Json;
using Speechpad.Agent.Licensing;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class LicenseTests : IDisposable
{
    private const string Machine = "MACHINE-1";

    private readonly string dir = Path.Combine(Path.GetTempPath(), $"speechpad-lic-{Guid.NewGuid():N}");
    private readonly (string PrivatePem, string PublicPem) keys;
    private readonly LicenseVerifier verifier;

    public LicenseTests()
    {
        Directory.CreateDirectory(dir);
        keys = GenerateKeys();
        verifier = new LicenseVerifier(keys.PublicPem);
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(dir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private static (string PrivatePem, string PublicPem) GenerateKeys()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (key.ExportPkcs8PrivateKeyPem(), key.ExportSubjectPublicKeyInfoPem());
    }

    private LicensePayload Payload(
        DateTimeOffset? expires = null,
        string[]? features = null,
        string? machine = null,
        string product = LicenseLimits.Product) => new()
        {
            Issued = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
            Expires = expires,
            Features = features ?? [LicenseLimits.FeatureInsert],
            Machine = machine,
            Product = product,
        };

    private string Sign(LicensePayload payload) => LicenseSigner.Sign(payload, keys.PrivatePem);

    [Fact]
    public void ValidSignedLicenseIsAccepted()
    {
        var json = Sign(Payload(expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero)));

        var result = verifier.Verify(json, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), Machine);

        Assert.True(result.IsValid);
        Assert.Equal(LicenseState.Valid, result.State);
        Assert.True(result.Allows(LicenseLimits.FeatureInsert));
        Assert.False(result.Allows(LicenseLimits.FeatureExtension));
    }

    [Fact]
    public void MissingLicenseIsReported()
    {
        Assert.Equal(LicenseState.Missing, verifier.Verify(null, DateTimeOffset.UnixEpoch, Machine).State);
        Assert.Equal(LicenseState.Missing, verifier.Verify("   ", DateTimeOffset.UnixEpoch, Machine).State);
    }

    [Fact]
    public void PerpetualLicenseNeverExpires()
    {
        var json = Sign(Payload(expires: null));
        var result = verifier.Verify(json, new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero), Machine);

        Assert.True(result.IsValid);
        Assert.Contains("бессрочная", result.Message);
    }

    [Fact]
    public void ExpiredLicenseIsRejected()
    {
        var json = Sign(Payload(expires: new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero)));
        var result = verifier.Verify(json, new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero), Machine);

        Assert.Equal(LicenseState.Expired, result.State);
        Assert.False(result.Allows(LicenseLimits.FeatureInsert));
    }

    [Fact]
    public void TamperedPayloadIsRejected()
    {
        var json = Sign(Payload(expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero)));
        using var document = JsonDocument.Parse(json);
        var envelope = document.RootElement.GetProperty("payload").GetString()!;
        var lifted = new LicensePayload
        {
            Issued = DateTimeOffset.UnixEpoch,
            Expires = null,
            Features = [LicenseLimits.FeatureInsert, LicenseLimits.FeatureExtension],
        };
        var forged = JsonSerializer.Serialize(
            new { payload = Convert.ToBase64String(lifted.ToBytes()).TrimEnd('=').Replace('+', '-').Replace('/', '_'), signature = document.RootElement.GetProperty("signature").GetString() },
            LicenseJson.Options);

        Assert.NotEqual(envelope, forged);
        var result = verifier.Verify(forged, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), Machine);
        Assert.Equal(LicenseState.Invalid, result.State);
    }

    [Fact]
    public void LicenseSignedByForeignKeyIsRejected()
    {
        var other = GenerateKeys();
        var json = LicenseSigner.Sign(
            Payload(expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero)),
            other.PrivatePem);

        Assert.Equal(LicenseState.Invalid, verifier.Verify(json, DateTimeOffset.UnixEpoch, Machine).State);
    }

    [Fact]
    public void LicenseForAnotherMachineIsRejected()
    {
        var json = Sign(Payload(expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero), machine: Machine));

        Assert.True(verifier.Verify(json, DateTimeOffset.UnixEpoch, Machine).IsValid);
        var other = verifier.Verify(json, DateTimeOffset.UnixEpoch, "MACHINE-2");
        Assert.Equal(LicenseState.Invalid, other.State);
        Assert.Contains("другой компьютер", other.Message);
    }

    [Fact]
    public void LicenseForAnotherProductIsRejected()
    {
        var json = Sign(Payload(expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero), product: "something-else"));

        Assert.Equal(LicenseState.Invalid, verifier.Verify(json, DateTimeOffset.UnixEpoch, Machine).State);
    }

    [Theory]
    [InlineData("")]
    [InlineData("{ not json")]
    [InlineData("{}")]
    [InlineData("""{"payload":"###","signature":"###"}""")]
    public void MalformedFilesAreRejectedWithoutThrowing(string json)
    {
        var result = verifier.Verify(json, DateTimeOffset.UnixEpoch, Machine);
        Assert.NotEqual(LicenseState.Valid, result.State);
    }

    [Fact]
    public void EmbeddedPublicKeyIsUsable()
    {
        var other = new LicenseVerifier(KeyPair.PublicKeyPem);
        Assert.Throws<ArgumentException>(() => new LicenseVerifier("not a pem"));
        Assert.NotNull(other);
    }

    [Fact]
    public void GateReadsFileFromDiskAndCachesResult()
    {
        var path = Path.Combine(dir, "license.json");
        var gate = new LicenseGate(
            path,
            keys.PublicPem,
            machineId: Machine,
            clock: () => new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero));

        Assert.Equal(LicenseState.Missing, gate.State);

        File.WriteAllText(path, Sign(Payload(expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero))));
        Assert.Equal(LicenseState.Missing, gate.State);

        Assert.Equal(LicenseState.Valid, gate.Refresh().State);
        Assert.True(gate.AllowsInsert);
        Assert.False(gate.AllowsExtension);
    }

    [Fact]
    public void GateBecomesExpiredAfterTheClockMoves()
    {
        var path = Path.Combine(dir, "license.json");
        File.WriteAllText(path, Sign(Payload(expires: new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero))));
        var now = new DateTimeOffset(2026, 1, 15, 0, 0, 0, TimeSpan.Zero);
        var gate = new LicenseGate(
            path,
            keys.PublicPem,
            machineId: Machine,
            clock: () => now);

        Assert.True(gate.AllowsInsert);
        now = new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal(LicenseState.Expired, gate.Refresh().State);
        Assert.False(gate.AllowsInsert);
    }

    [Fact]
    public async Task InsertIsRejectedWithoutALicenseAndAllowedWithOne()
    {
        var withLicense = await Harness.RunAsync(LicenseFixture.WithFeatures(LicenseLimits.FeatureInsert), null);
        Assert.True(withLicense.Ok);
        Assert.True(string.IsNullOrEmpty(withLicense.Error));

        var without = await Harness.RunAsync(LicenseFixture.WithoutLicense(), null);
        Assert.False(without.Ok);
        Assert.Contains("лицензии", without.Error ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        var wrongFeature = await Harness.RunAsync(LicenseFixture.WithFeatures(LicenseLimits.FeatureExtension), null);
        Assert.False(wrongFeature.Ok);
        Assert.Contains("лицензии", wrongFeature.Error ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TrialAllowsFeaturesAndStopsAfterTheDeadline()
    {
        var path = Path.Combine(dir, "trial.txt");
        var now = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var start = now;

        var fresh = new Licensing.LicenseGate(
            Path.Combine(dir, "none.json"),
            keys.PublicPem,
            machineId: Machine,
            trialDays: 3,
            trialStatePath: path,
            clock: () => start);
        Assert.Equal(Licensing.LicenseState.Trial, fresh.State);
        Assert.True(fresh.AllowsInsert);
        Assert.True(fresh.InTrial);

        var later = new Licensing.LicenseGate(
            Path.Combine(dir, "none.json"),
            keys.PublicPem,
            machineId: Machine,
            trialDays: 3,
            trialStatePath: path,
            clock: () => start.AddDays(5));
        Assert.Equal(Licensing.LicenseState.Expired, later.State);
        Assert.False(later.AllowsInsert);
    }

    [Fact]
    public void ValidLicenseWinsOverTrial()
    {
        var licensePath = Path.Combine(dir, "license-trial.json");
        File.WriteAllText(licensePath, Sign(Payload(
            expires: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero),
            features: [LicenseLimits.FeatureInsert],
            machine: Machine)));
        var path = Path.Combine(dir, "trial2.txt");
        var start = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var gate = new Licensing.LicenseGate(
            licensePath,
            keys.PublicPem,
            machineId: Machine,
            trialDays: 3,
            trialStatePath: path,
            clock: () => start);
        Assert.Equal(Licensing.LicenseState.Valid, gate.State);
        Assert.False(gate.InTrial);
        Assert.True(gate.AllowsInsert);
        Assert.False(gate.AllowsExtension);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void HealthReportsLicenseState()
    {
        Assert.True(LicenseFixture.Valid().IsValid);
        Assert.True(LicenseFixture.WithoutLicense().AllowsInsert == false);
        Assert.Equal(LicenseState.Missing, LicenseFixture.WithoutLicense().State);
    }

    private sealed class Harness
    {
        public static async Task<(bool Ok, string? Error)> RunAsync(
            Licensing.LicenseGate license,
            AgentOptions? options)
        {
            var connection = new AgentConnection(
                new ThrowingSocket(),
                new AcceptingQueue(),
                options ?? new AgentOptions(),
                new AgentLog(null, verbose: false),
                new SilentActions(),
                license);

            await connection.HandleAsync("""{"type":"insert","text":"привет","seq":7}""", CancellationToken.None);

            var json = connection.TryDequeue() ?? string.Empty;
            using var document = JsonDocument.Parse(json);
            var ok = document.RootElement.GetProperty("ok").GetBoolean();
            string? error = null;
            if (connection.TryDequeue() is { } second)
            {
                using var next = JsonDocument.Parse(second);
                if (next.RootElement.GetProperty("type").GetString() == "error")
                {
                    error = next.RootElement.GetProperty("message").GetString();
                }
            }

            return (ok, error);
        }
    }

    private sealed class AcceptingQueue : Insertion.IInsertionQueue
    {
        public string SchemeName => "clipboard";

        public Task<Insertion.InsertResult> InsertAsync(string text, CancellationToken cancellationToken = default)
            => Task.FromResult(new Insertion.InsertResult(true, "clipboard"));
    }

    private sealed class SilentActions : IAgentActions
    {
        public void BroadcastHotkey(string action)
        {
        }

        public void ToggleTopmostCompact()
        {
        }

        public void ToggleTopmostMain()
        {
        }

        public void FocusMainWindow()
        {
        }

        public void ShowBalloon(string title, string text)
        {
        }

        public void Quit()
        {
        }
    }

    private sealed class ThrowingSocket : System.Net.WebSockets.WebSocket
    {
        public override System.Net.WebSockets.WebSocketCloseStatus? CloseStatus => null;

        public override string? CloseStatusDescription => null;

        public override System.Net.WebSockets.WebSocketState State => System.Net.WebSockets.WebSocketState.Open;

        public override string? SubProtocol => null;

        public override void Abort()
        {
        }

        public override Task CloseAsync(
            System.Net.WebSockets.WebSocketCloseStatus closeStatus,
            string? statusDescription,
            CancellationToken cancellationToken) => Task.CompletedTask;

        public override Task CloseOutputAsync(
            System.Net.WebSockets.WebSocketCloseStatus closeStatus,
            string? statusDescription,
            CancellationToken cancellationToken) => Task.CompletedTask;

        public override void Dispose()
        {
        }

        public override Task<System.Net.WebSockets.WebSocketReceiveResult> ReceiveAsync(
            ArraySegment<byte> buffer,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public override Task SendAsync(
            ArraySegment<byte> buffer,
            System.Net.WebSockets.WebSocketMessageType messageType,
            bool endOfMessage,
            CancellationToken cancellationToken) => Task.CompletedTask;
    }

    [Fact]
    public void Base64UrlRoundTrips()
    {
        var bytes = new byte[] { 0, 1, 2, 250, 251, 252, 253, 254, 255 };
        var encoded = Base64Url.Encode(bytes);

        Assert.DoesNotContain('=', encoded);
        Assert.DoesNotContain('+', encoded);
        Assert.DoesNotContain('/', encoded);
        Assert.Equal(bytes, Base64Url.Decode(encoded));
    }

    [Fact]
    public void MachineIdIsStable()
    {
        var first = MachineId.Detect();
        var second = MachineId.Detect();
        Assert.Equal(first, second);
        Assert.Equal(MachineId.Hash("speechpad|PC|VADIM|" + Guid.Empty), MachineId.Hash("speechpad|PC|VADIM|" + Guid.Empty));
    }
}
