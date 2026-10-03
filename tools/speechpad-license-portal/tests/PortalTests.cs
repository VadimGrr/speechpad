using System.Security.Cryptography;
using System.Text.Json;
using Speechpad.Agent.Licensing;

namespace Speechpad.LicensePortal.Tests;

internal sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(
        System.IO.Path.GetTempPath(),
        "speechpad-portal-tests-" + Guid.NewGuid().ToString("N"));

    public TempDir() => Directory.CreateDirectory(Path);

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}

internal static class TestKey
{
    public static (string PrivatePem, string PublicPem) Create()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (key.ExportPkcs8PrivateKeyPem(), key.ExportSubjectPublicKeyInfoPem());
    }
}

public class PasswordHasherTests
{
    [Fact]
    public void VerifiesTheOriginalPasswordOnly()
    {
        var credentials = PasswordHasher.Create("admin", "correct-horse");

        Assert.True(PasswordHasher.Verify(credentials, "admin", "correct-horse"));
        Assert.False(PasswordHasher.Verify(credentials, "admin", "wrong-horse"));
        Assert.False(PasswordHasher.Verify(credentials, "someone", "correct-horse"));
    }

    [Fact]
    public void NeverStoresThePasswordItself()
    {
        var credentials = PasswordHasher.Create("admin", "correct-horse");

        Assert.DoesNotContain("correct-horse", credentials.Hash, StringComparison.Ordinal);
        Assert.DoesNotContain("correct-horse", credentials.Salt, StringComparison.Ordinal);
    }

    [Fact]
    public void UsesASaltSoIdenticalPasswordsDiffer()
    {
        var first = PasswordHasher.Create("admin", "correct-horse");
        var second = PasswordHasher.Create("admin", "correct-horse");

        Assert.NotEqual(first.Salt, second.Salt);
        Assert.NotEqual(first.Hash, second.Hash);
    }

    [Fact]
    public void RejectsShortAndOverlongPasswords()
    {
        Assert.Throws<ArgumentException>(() => PasswordHasher.Create("admin", "short"));
        Assert.Throws<ArgumentException>(() => PasswordHasher.Create("admin", new string('x', 257)));
    }

    [Fact]
    public void SurvivesASaveAndLoadRoundTrip()
    {
        using var dir = new TempDir();
        var store = new CredentialStore(dir.File("admin.json"));
        store.Save(PasswordHasher.Create("admin", "correct-horse"));

        Assert.True(PasswordHasher.Verify(store.Load(), "admin", "correct-horse"));
    }
}

public class LoginThrottleTests
{
    [Fact]
    public void AllowsTheFirstFewAttempts()
    {
        var throttle = new LoginThrottle();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal(TimeSpan.Zero, throttle.RecordFailure("admin", now));
        Assert.Equal(TimeSpan.Zero, throttle.RecordFailure("admin", now));
    }

    [Fact]
    public void BlocksAfterRepeatedFailures()
    {
        var throttle = new LoginThrottle();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

        TimeSpan delay = TimeSpan.Zero;
        for (var i = 0; i < 5; i++)
        {
            delay = throttle.RecordFailure("admin", now);
        }

        Assert.True(delay > TimeSpan.Zero);
        Assert.True(throttle.CheckDelay("admin", now) > TimeSpan.Zero);
    }

    [Fact]
    public void DoublesTheDelayOnEachFurtherFailure()
    {
        var throttle = new LoginThrottle();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < 5; i++)
        {
            throttle.RecordFailure("admin", now);
        }

        var first = throttle.RecordFailure("admin", now);
        var second = throttle.RecordFailure("admin", now);

        Assert.True(second > first, $"ожидали рост задержки, получили {first} и {second}");
    }

    [Fact]
    public void KeepsLoginsIndependent()
    {
        var throttle = new LoginThrottle();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < 6; i++)
        {
            throttle.RecordFailure("admin", now);
        }

        Assert.Equal(TimeSpan.Zero, throttle.CheckDelay("other", now));
    }

    [Fact]
    public void ForgetsTheFailureAfterASuccessfulLogin()
    {
        var throttle = new LoginThrottle();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < 6; i++)
        {
            throttle.RecordFailure("admin", now);
        }

        throttle.RecordSuccess("admin");

        Assert.Equal(TimeSpan.Zero, throttle.CheckDelay("admin", now));
    }

    [Fact]
    public void StopsBlockingOnceTheDelayHasPassed()
    {
        var throttle = new LoginThrottle();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < 6; i++)
        {
            throttle.RecordFailure("admin", now);
        }

        var later = now.AddHours(1);

        Assert.Equal(TimeSpan.Zero, throttle.CheckDelay("admin", later));
    }
}

public class SessionStoreTests
{
    [Fact]
    public void FindsALiveSessionByToken()
    {
        var store = new SessionStore();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var session = store.Create(now);

        Assert.NotNull(store.Find(session.Token, now));
        Assert.NotNull(store.Find(session.Token, now.AddMinutes(30)));
    }

    [Fact]
    public void RejectsAnUnknownToken()
    {
        var store = new SessionStore();
        Assert.Null(store.Find("nope", DateTimeOffset.Now));
        Assert.Null(store.Find(null, DateTimeOffset.Now));
    }

    [Fact]
    public void ExpiresAnOldSession()
    {
        var store = new SessionStore();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var session = store.Create(now);

        Assert.Null(store.Find(session.Token, now.AddHours(3)));
    }

    [Fact]
    public void DropEndsTheSessionImmediately()
    {
        var store = new SessionStore();
        var now = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var session = store.Create(now);

        store.Drop(session.Token);

        Assert.Null(store.Find(session.Token, now));
    }

    [Fact]
    public void GivesEachSessionItsOwnCsrfToken()
    {
        var store = new SessionStore();
        var now = DateTimeOffset.Now;

        Assert.NotEqual(store.Create(now).Csrf, store.Create(now).Csrf);
    }
}

public class HistoryStoreTests
{
    private static IssuedLicense Sample(string licensee = "Тест") => new()
    {
        Id = "id-" + Guid.NewGuid().ToString("N"),
        Licensee = licensee,
        Issued = DateTimeOffset.Now,
        Features = [LicenseLimits.FeatureInsert],
    };

    [Fact]
    public void AddsAndReturnsNewestFirst()
    {
        using var dir = new TempDir();
        var store = new HistoryStore(dir.File("history.json"));
        var older = Sample("Старый") with { Issued = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero) };
        var newer = Sample("Новый") with { Issued = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero) };

        store.Add(older);
        store.Add(newer);

        var all = store.All();

        Assert.Equal(2, all.Count);
        Assert.Equal("Новый", all[0].Licensee);
        Assert.Equal("Старый", all[1].Licensee);
    }

    [Fact]
    public void PersistsAcrossInstances()
    {
        using var dir = new TempDir();
        var path = dir.File("history.json");
        new HistoryStore(path).Add(Sample());

        Assert.Single(new HistoryStore(path).All());
    }

    [Fact]
    public void RevokesOnceAndOnlyOnce()
    {
        using var dir = new TempDir();
        var store = new HistoryStore(dir.File("history.json"));
        var license = Sample();

        store.Add(license);

        Assert.True(store.Revoke(license.Id, DateTimeOffset.Now));
        Assert.False(store.Revoke(license.Id, DateTimeOffset.Now));
        Assert.True(store.All()[0].Revoked);
    }

    [Fact]
    public void ReportsAnUnknownLicense()
    {
        using var dir = new TempDir();
        Assert.False(new HistoryStore(dir.File("history.json")).Revoke("missing", DateTimeOffset.Now));
    }
}

public class LicenseIssuerTests
{
    private static readonly DateTimeOffset Now = new(2027, 3, 1, 12, 0, 0, TimeSpan.Zero);

    private static (LicenseIssuer Issuer, HistoryStore History, string PrivatePem, string PublicPem) Setup(TempDir dir)
    {
        var (privatePem, publicPem) = TestKey.Create();
        return (
            new LicenseIssuer(() => Now),
            new HistoryStore(dir.File("history.json")),
            privatePem,
            publicPem);
    }

    [Fact]
    public void ProducesALicenseTheAgentVerifierAccepts()
    {
        using var dir = new TempDir();
        var (issuer, history, privatePem, publicPem) = Setup(dir);

        var result = issuer.Issue(
            new IssueRequest { Licensee = "Иван Петров", Days = 365 },
            privatePem,
            history);

        var check = new LicenseVerifier(publicPem).Verify(
            result.LicenseJson,
            Now.AddDays(10),
            machineId: null);

        Assert.True(check.IsValid, check.Message);
        Assert.Equal("Иван Петров", check.Payload!.Licensee);
    }

    [Fact]
    public void GrantsEveryFeatureWhenNoneAreChosen()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        var result = issuer.Issue(new IssueRequest { Licensee = "П" }, pem, history);

        Assert.Equal(
            new[] { LicenseLimits.FeatureInsert, LicenseLimits.FeatureExtension, LicenseLimits.FeatureTopmost },
            result.Record.Features);
    }

    [Fact]
    public void GrantsOnlyTheChosenFeatures()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, publicPem) = Setup(dir);

        var result = issuer.Issue(
            new IssueRequest { Licensee = "П", Features = [LicenseLimits.FeatureInsert, "insert"] },
            pem,
            history);

        Assert.Equal(new[] { LicenseLimits.FeatureInsert }, result.Record.Features);

        var check = new LicenseVerifier(publicPem).Verify(result.LicenseJson, Now, null);
        Assert.True(check.Allows(LicenseLimits.FeatureInsert));
        Assert.False(check.Allows(LicenseLimits.FeatureTopmost));
    }

    [Fact]
    public void DropsUnknownFeaturesInsteadOfTrustingThem()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        var result = issuer.Issue(
            new IssueRequest { Licensee = "П", Features = ["admin", "root", LicenseLimits.FeatureInsert] },
            pem,
            history);

        Assert.Equal(new[] { LicenseLimits.FeatureInsert }, result.Record.Features);
    }

    [Fact]
    public void MakesAPerpetualLicenseWithNoExpiry()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, publicPem) = Setup(dir);

        var result = issuer.Issue(new IssueRequest { Licensee = "П" }, pem, history);

        Assert.True(result.Record.Perpetual);
        Assert.True(new LicenseVerifier(publicPem).Verify(result.LicenseJson, Now.AddYears(20), null).IsValid);
    }

    [Fact]
    public void ExpiresOnTheLastMomentOfTheChosenDay()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, publicPem) = Setup(dir);

        var result = issuer.Issue(new IssueRequest { Licensee = "П", Expires = "2027-12-31" }, pem, history);
        var verifier = new LicenseVerifier(publicPem);

        Assert.True(verifier.Verify(result.LicenseJson, new DateTimeOffset(2027, 12, 31, 23, 0, 0, TimeSpan.Zero), null).IsValid);
        Assert.False(verifier.Verify(result.LicenseJson, new DateTimeOffset(2028, 1, 1, 0, 30, 0, TimeSpan.Zero), null).IsValid);
    }

    [Fact]
    public void RefusesAnExpiryDateInThePast()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        Assert.Throws<ArgumentException>(() =>
            issuer.Issue(new IssueRequest { Licensee = "П", Expires = "2020-01-01" }, pem, history));
    }

    [Fact]
    public void BindsToOneMachineWhenAsked()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, publicPem) = Setup(dir);

        var result = issuer.Issue(
            new IssueRequest { Licensee = "П", Machine = "MACHINE-1" },
            pem,
            history);

        var verifier = new LicenseVerifier(publicPem);
        Assert.True(verifier.Verify(result.LicenseJson, Now, "MACHINE-1").IsValid);
        Assert.False(verifier.Verify(result.LicenseJson, Now, "MACHINE-2").IsValid);
    }

    [Fact]
    public void IgnoresTheMachineWhenAnyComputerIsAllowed()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, publicPem) = Setup(dir);

        var result = issuer.Issue(
            new IssueRequest { Licensee = "П", Machine = "MACHINE-1", AllMachines = true },
            pem,
            history);

        Assert.Null(result.Record.Machine);
        Assert.True(new LicenseVerifier(publicPem).Verify(result.LicenseJson, Now, "ANY-MACHINE").IsValid);
    }

    [Fact]
    public void RefusesAnEmptyLicensee()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        Assert.Throws<ArgumentException>(() =>
            issuer.Issue(new IssueRequest { Licensee = "   " }, pem, history));
    }

    [Fact]
    public void RefusesAnOverlongLicensee()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        Assert.Throws<ArgumentException>(() =>
            issuer.Issue(new IssueRequest { Licensee = new string('x', 121) }, pem, history));
    }

    [Fact]
    public void RecordsEveryIssueInHistory()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        issuer.Issue(new IssueRequest { Licensee = "Первый" }, pem, history);
        issuer.Issue(new IssueRequest { Licensee = "Второй" }, pem, history);

        Assert.Equal(2, history.All().Count);
    }

    [Fact]
    public void BuildsAReadableIdFromTheDateAndName()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        var result = issuer.Issue(new IssueRequest { Licensee = "Иван Петров!" }, pem, history);

        Assert.Equal("20270301-120000-иван-петров", result.Record.Id);
    }

    [Fact]
    public void KeepsUnusualNamesUsable()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        foreach (var name in new[] { "!!!", "🙂", new string('я', 90) })
        {
            var result = issuer.Issue(new IssueRequest { Licensee = name }, pem, history);
            Assert.False(string.IsNullOrWhiteSpace(result.Record.Id));
            Assert.DoesNotContain("--", result.Record.Id, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void ProducesJsonTheAgentCanParse()
    {
        using var dir = new TempDir();
        var (issuer, history, pem, _) = Setup(dir);

        var result = issuer.Issue(new IssueRequest { Licensee = "П" }, pem, history);
        using var document = JsonDocument.Parse(result.LicenseJson);

        Assert.True(document.RootElement.TryGetProperty("payload", out _));
        Assert.True(document.RootElement.TryGetProperty("signature", out _));
    }
}

public class PortalDefaultsTests
{
    [Fact]
    public void UsesTheSecretsFolderNextToTheAgent()
    {
        var defaults = Program.DefaultPaths();

        Assert.EndsWith("license-private.pem", defaults.PrivateKey, StringComparison.Ordinal);
        Assert.Contains("speechpad-secrets", defaults.PrivateKey, StringComparison.Ordinal);
    }

    [Fact]
    public void DefaultsToAPortAboveTheAgentPort()
    {
        var options = Program.Parse([]);

        Assert.Equal(8790, options.Port);
    }

    [Fact]
    public void RejectsAPortOutsideTheAllowedRange()
    {
        Assert.Throws<ArgumentException>(() => Program.Parse(["--port", "80"]));
        Assert.Throws<ArgumentException>(() => Program.Parse(["--port", "70000"]));
    }

    [Fact]
    public void DetectsTheInitFlag()
    {
        Assert.True(Program.Parse(["--init"]).Init);
        Assert.False(Program.Parse([]).Init);
    }

    [Fact]
    public void NeverKeepsAPasswordInTheOptions()
    {
        var options = Program.Parse(["--init", "secret-pass"]);

        Assert.DoesNotContain("secret-pass", System.Text.Json.JsonSerializer.Serialize(options), StringComparison.Ordinal);
    }

    [Fact]
    public void ExplainsAnUnreadablePortInsteadOfCrashing()
    {
        var error = Assert.Throws<ArgumentException>(() => Program.Parse(["--port", "абв"]));

        Assert.Contains("абв", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void HasAStableFingerprintForTheSameKey()
    {
        var (_, publicPem) = TestKey.Create();

        Assert.Equal(Program.Fingerprint(publicPem), Program.Fingerprint(publicPem));
        Assert.Equal(16, Program.Fingerprint(publicPem).Length);
    }
}
