using Speechpad.Agent.Licensing;

namespace Speechpad.Agent.Licensing.Install;

public sealed record LicenseInstallResult
{
    public required bool Installed { get; init; }

    public required LicenseState State { get; init; }

    public required string Message { get; init; }

    public string Licensee { get; init; } = string.Empty;

    public string Expires { get; init; } = string.Empty;

    public string Features { get; init; } = string.Empty;

    public string Machine { get; init; } = string.Empty;

    public string Previous { get; init; } = string.Empty;
}

public sealed class LicenseInstaller
{
    private readonly LicenseVerifier verifier;
    private readonly string destination;
    private readonly Func<DateTimeOffset> clock;
    private readonly Func<string?> machineId;
    private readonly Action<string>? log;

    public LicenseInstaller(
        string destination,
        string publicKeyPem,
        Func<DateTimeOffset>? clock = null,
        Func<string?>? machineId = null,
        Action<string>? log = null)
    {
        this.destination = destination;
        this.clock = clock ?? (() => DateTimeOffset.Now);
        this.machineId = machineId ?? MachineId.Detect;
        this.log = log;
        verifier = new LicenseVerifier(publicKeyPem);
    }

    public string Destination => destination;

    public static bool LooksLikeLicenseFile(string path)
        => string.Equals(Path.GetExtension(path), ".lic", StringComparison.OrdinalIgnoreCase);

    public static LicenseInstallResult Reject(string message)
        => new()
        {
            Installed = false,
            State = LicenseState.Invalid,
            Message = message,
        };

    public LicenseInstallResult Read(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return Reject("файл лицензии не найден");
        }

        string text;
        try
        {
            text = File.ReadAllText(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Reject($"не удалось прочитать файл: {ex.Message}");
        }

        var check = verifier.Verify(text, clock(), machineId());
        if (!check.IsValid)
        {
            return new LicenseInstallResult
            {
                Installed = false,
                State = check.State,
                Message = check.Message,
            };
        }

        var payload = check.Payload!;
        return new LicenseInstallResult
        {
            Installed = true,
            State = check.State,
            Message = check.Message,
            Licensee = payload.Licensee,
            Expires = payload.IsPerpetual
                ? "бессрочно"
                : payload.Expires!.Value.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            Features = string.Join(", ", payload.Features),
            Machine = string.IsNullOrWhiteSpace(payload.Machine) ? "любой компьютер" : payload.Machine,
        };
    }

    public LicenseInstallResult Install(string path)
    {
        var inspection = Read(path);
        if (!inspection.Installed)
        {
            return inspection;
        }

        string text;
        try
        {
            text = File.ReadAllText(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Reject($"не удалось прочитать файл: {ex.Message}");
        }

        string? previous = null;
        if (File.Exists(destination))
        {
            try
            {
                var current = verifier.Verify(File.ReadAllText(destination), clock(), machineId());
                previous = current.IsValid ? current.Message : null;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                previous = null;
            }
        }

        try
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(destination));
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var temporary = destination + ".new";
            File.WriteAllText(temporary, text.Trim());
            File.Copy(temporary, destination, overwrite: true);
            File.Delete(temporary);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Reject($"не удалось сохранить лицензию: {ex.Message}");
        }

        log?.Invoke($"license installed for {inspection.Licensee}: {inspection.Message}");

        return new LicenseInstallResult
        {
            Installed = true,
            State = inspection.State,
            Message = inspection.Message,
            Licensee = inspection.Licensee,
            Expires = inspection.Expires,
            Features = inspection.Features,
            Machine = inspection.Machine,
            Previous = previous ?? string.Empty,
        };
    }
}
