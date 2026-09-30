using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speechpad.Agent;

public enum InsertScheme
{
    ClipboardPaste,
    UnicodeInput,
}

public sealed class AgentOptions
{
    public int Port { get; set; } = 8787;

    public string? WebRoot { get; set; }

    public InsertScheme InsertScheme { get; set; } = InsertScheme.ClipboardPaste;

    public string ToggleHotkey { get; set; } = "Ctrl+Alt+Space";

    public string TopmostHotkey { get; set; } = "Ctrl+Alt+T";

    public string ClearHotkey { get; set; } = "Ctrl+Alt+D";

    public string MainWindowTitle { get; set; } = "Speechpad — голосовой ввод";

    public string CompactWindowTitle { get; set; } = "Speechpad — компактное окно";

    public bool TrayIcon { get; set; } = true;

    public bool Verbose { get; set; }

    public string? LicensePath { get; set; }

    public bool RequireLicense { get; set; }

    public int TrialDays { get; set; } = 2;

    public IReadOnlyList<string> Validate()
    {
        var problems = new List<string>();
        if (Port is < 1024 or > 65535)
        {
            problems.Add($"порт {Port} вне диапазона 1024..65535");
        }

        problems.AddRange(ValidateHotkey("ToggleHotkey", ToggleHotkey));
        problems.AddRange(ValidateHotkey("TopmostHotkey", TopmostHotkey));
        problems.AddRange(ValidateHotkey("ClearHotkey", ClearHotkey));
        return problems;
    }

    private static IReadOnlyList<string> ValidateHotkey(string name, string value)
        => Hotkey.TryParse(value, out _)
            ? []
            : [$"{name}: не удалось разобрать горячую клавишу «{value}»"];
}

public static class OptionsStore
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "settings.json");

    public static AgentOptions Load(string path)
    {
        if (!File.Exists(path))
        {
            return new AgentOptions();
        }

        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AgentOptions>(json, Json) ?? new AgentOptions();
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return new AgentOptions();
        }
    }

    public static void Save(string path, AgentOptions options)
        => File.WriteAllText(path, JsonSerializer.Serialize(options, Json));
}
