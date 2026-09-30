using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace Speechpad.Agent.Licensing;

public static class MachineId
{
    public static string? Detect()
    {
        var guid = ReadMachineGuid();
        if (string.IsNullOrWhiteSpace(guid))
        {
            return null;
        }

        return Hash($"speechpad|{Environment.MachineName}|{Environment.UserName}|{guid}");
    }

    public static string Hash(string raw)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

    private static string? ReadMachineGuid()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            return key?.GetValue("MachineGuid") as string;
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            return null;
        }
    }
}

public static class LicenseLocations
{
    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "SpeechPad",
        "license.json");
}

public sealed class LicenseGate
{
    public static string DefaultPath => LicenseLocations.DefaultPath;

    private readonly string path;
    private readonly LicenseVerifier verifier;
    private readonly string? machineId;
    private readonly Func<DateTimeOffset> clock;
    private readonly AgentLog? log;
    private readonly TrialStore? trial;
    private LicenseCheck current;

    public LicenseGate(
        string path,
        string publicKeyPem,
        AgentLog? log = null,
        Func<DateTimeOffset>? clock = null,
        string? machineId = null,
        int trialDays = 0,
        string? trialStatePath = null)
    {
        this.path = path;
        this.log = log;
        this.clock = clock ?? (() => DateTimeOffset.Now);
        this.machineId = machineId ?? Licensing.MachineId.Detect();
        verifier = new LicenseVerifier(publicKeyPem);
        if (trialDays > 0)
        {
            trial = new TrialStore(trialStatePath ?? path + ".trial", trialDays, this.clock, log);
        }

        current = Evaluate();
    }

    public string Path => path;

    public string? MachineId => machineId;

    public LicenseCheck Current => current;

    public LicenseState State => current.State;

    public bool IsValid => current.IsValid;

    public bool AllowsInsert => Allows(LicenseLimits.FeatureInsert);

    public bool AllowsExtension => Allows(LicenseLimits.FeatureExtension);

    public bool AllowsTopmost => Allows(LicenseLimits.FeatureTopmost);

    public string Message => current.Message;

    public bool InTrial => current.State == LicenseState.Trial;

    public bool Allows(string feature)
    {
        if (current.IsValid)
        {
            return current.Allows(feature);
        }

        return InTrial && trial is not null;
    }

    public LicenseCheck Refresh() => current = Evaluate();

    private LicenseCheck Evaluate()
    {
        var text = Read();
        var result = verifier.Verify(text, clock(), machineId);
        if (!result.IsValid && trial is not null)
        {
            result = trial.Evaluate();
        }

        log?.Info($"license {result.State.ToString().ToLowerInvariant()}: {result.Message}");
        return result;
    }

    private string? Read()
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            return File.ReadAllText(path, Encoding.UTF8);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            log?.Warn($"license unreadable: {ex.Message}");
            return null;
        }
    }
}
