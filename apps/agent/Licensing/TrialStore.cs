using System.Globalization;

namespace Speechpad.Agent.Licensing;

public sealed class TrialStore
{
    private readonly string path;
    private readonly int days;
    private readonly Func<DateTimeOffset> clock;
    private readonly AgentLog? log;

    public TrialStore(string path, int days, Func<DateTimeOffset> clock, AgentLog? log = null)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(days, 1);
        this.path = path;
        this.days = days;
        this.clock = clock;
        this.log = log;
    }

    public LicenseCheck Evaluate()
    {
        var now = clock();
        var started = Read();
        if (started is null)
        {
            started = now;
            Write(now);
        }

        var until = started.Value.AddDays(days);
        if (now > until)
        {
            return new LicenseCheck
            {
                State = LicenseState.Expired,
                Message = $"пробный период {days} дн. закончился {until:yyyy-MM-dd}",
            };
        }

        var left = Math.Max(0, days - (int)(now - started.Value).TotalDays);
        return new LicenseCheck
        {
            State = LicenseState.Trial,
            Message = $"пробный период: осталось {left} дн. из {days}",
        };
    }

    private DateTimeOffset? Read()
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            var text = File.ReadAllText(path).Trim();
            return DateTimeOffset.TryParse(
                text,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var parsed)
                ? parsed
                : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            log?.Warn($"trial state unreadable: {ex.Message}");
            return null;
        }
    }

    private void Write(DateTimeOffset started)
    {
        try
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(path));
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            File.WriteAllText(path, started.ToString("O", CultureInfo.InvariantCulture));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            log?.Warn($"trial state not saved: {ex.Message}");
        }
    }
}
