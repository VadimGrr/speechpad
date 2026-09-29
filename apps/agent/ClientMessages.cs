using System.Text.Json;

namespace Speechpad.Agent;

public static class ClientMessages
{
    public sealed record Hello
    {
        public string? Type { get; init; }

        public int? Version { get; init; }
    }

    public sealed record Insert
    {
        public string? Type { get; init; }

        public string? Text { get; init; }

        public int? Seq { get; init; }
    }

    public sealed record CommandMessage
    {
        public string? Type { get; init; }

        public string? Name { get; init; }
    }

    public static bool IsHello(string? json, out int version)
    {
        version = 0;
        var parsed = Parse<Hello>(json);
        if (parsed?.Type != "hello")
        {
            return false;
        }

        version = parsed.Version ?? 0;
        return true;
    }

    public static bool IsInsert(string? json, out string text, out int seq)
    {
        text = string.Empty;
        seq = 0;
        var parsed = Parse<Insert>(json);
        if (parsed?.Type != "insert" || string.IsNullOrWhiteSpace(parsed.Text))
        {
            return false;
        }

        text = parsed.Text;
        seq = parsed.Seq ?? 0;
        return true;
    }

    public static bool IsCommand(string? json, out string command)
    {
        command = string.Empty;
        var parsed = Parse<CommandMessage>(json);
        if (parsed?.Type != "command" || string.IsNullOrWhiteSpace(parsed.Name))
        {
            return false;
        }

        command = parsed.Name.Trim().ToLowerInvariant();
        return true;
    }

    public static bool IsValidJson(string? json) => Parse<object>(json) is not null;

    private static T? Parse<T>(string? json)
        where T : class
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > 64 * 1024)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(json, Protocol.Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
