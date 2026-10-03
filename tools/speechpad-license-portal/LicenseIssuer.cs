using System.Globalization;
using Speechpad.Agent.Licensing;

namespace Speechpad.LicensePortal;

internal sealed record LoginRequest
{
    public string Login { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;
}

internal sealed record IssueRequest
{
    public string Licensee { get; init; } = string.Empty;

    public string? Expires { get; init; }

    public int? Days { get; init; }

    public string? Machine { get; init; }

    public bool AllMachines { get; init; }

    public string[] Features { get; init; } = [];

    public string Note { get; init; } = string.Empty;
}

internal sealed record IssuedResult
{
    public required string LicenseJson { get; init; }

    public required IssuedLicense Record { get; init; }
}

internal sealed class LicenseIssuer
{
    private const int MaxLicenseeLength = 120;
    private const int MaxNoteLength = 500;
    private const int MaxMachineLength = 128;

    private static readonly string[] AllFeatures =
    [
        LicenseLimits.FeatureInsert,
        LicenseLimits.FeatureExtension,
        LicenseLimits.FeatureTopmost,
    ];

    private readonly Func<DateTimeOffset> clock;

    public LicenseIssuer(Func<DateTimeOffset>? clock = null) => this.clock = clock ?? (() => DateTimeOffset.Now);

    public IssuedResult Issue(IssueRequest request, string privateKeyPem, HistoryStore history)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(history);
        ArgumentException.ThrowIfNullOrWhiteSpace(privateKeyPem);

        var licensee = request.Licensee.Trim();
        if (licensee.Length == 0 || licensee.Length > MaxLicenseeLength)
        {
            throw new ArgumentException($"имя получателя должно быть от 1 до {MaxLicenseeLength} символов");
        }

        var now = clock();
        var expires = ResolveExpiry(request, now);
        var features = ResolveFeatures(request.Features);
        var machine = ResolveMachine(request);
        var note = request.Note.Trim();

        var payload = new LicensePayload
        {
            Licensee = licensee,
            Issued = now,
            Expires = expires,
            Features = features,
            Machine = machine,
        };

        var json = LicenseSigner.Sign(payload, privateKeyPem);

        var record = history.Add(new IssuedLicense
        {
            Id = BuildId(now, licensee),
            Licensee = licensee,
            Issued = now,
            Expires = expires,
            Features = features,
            Machine = machine,
            Note = note.Length > MaxNoteLength ? note[..MaxNoteLength] : note,
        });

        return new IssuedResult
        {
            LicenseJson = json,
            Record = record,
        };
    }

    private DateTimeOffset? ResolveExpiry(IssueRequest request, DateTimeOffset now)
    {
        if (request.Expires is { Length: > 0 } rawDate)
        {
            if (!DateOnly.TryParse(rawDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            {
                throw new ArgumentException($"не понял дату: {rawDate}");
            }

var end = new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue).AddDays(1).AddSeconds(-1), TimeSpan.Zero);
            if (end <= now)
            {
                throw new ArgumentException("дата окончания уже прошла");
            }

            return end;
        }

        return request.Days is > 0 ? now.AddDays(request.Days.Value) : null;
    }

    private static string[] ResolveFeatures(string[]? requested)
    {
        var selected = (requested ?? [])
            .Where(feature => !string.IsNullOrWhiteSpace(feature))
            .Select(feature => feature.Trim().ToLowerInvariant())
            .Distinct(StringComparer.Ordinal)
            .Where(AllFeatures.Contains)
            .ToArray();

        return selected.Length == 0 ? [.. AllFeatures] : selected;
    }

    private static string? ResolveMachine(IssueRequest request)
    {
        if (request.AllMachines)
        {
            return null;
        }

        var machine = request.Machine?.Trim();
        if (string.IsNullOrEmpty(machine))
        {
            return null;
        }

        if (machine.Length > MaxMachineLength)
        {
            throw new ArgumentException($"идентификатор компьютера длиннее {MaxMachineLength} символов");
        }

        return machine;
    }

    private static string BuildId(DateTimeOffset now, string licensee)
    {
        var stamp = now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
        var slug = new string(licensee
            .Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-')
            .ToArray());

        while (slug.Contains("--", StringComparison.Ordinal))
        {
            slug = slug.Replace("--", "-", StringComparison.Ordinal);
        }

        slug = slug.Trim('-');
        if (slug.Length > 24)
        {
            slug = slug[..24].Trim('-');
        }

        return $"{stamp}-{(slug.Length == 0 ? "license" : slug)}";
    }
}
