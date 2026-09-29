using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speechpad.Agent;

public static class Protocol
{
    public const int Version = 1;

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static string Write(AgentMessage message) => JsonSerializer.Serialize(message, message.GetType(), Json);

    public static string WriteJson<T>(T value) => JsonSerializer.Serialize(value, Json);
}

public static class HotkeyActions
{
    public const string Toggle = "toggle";
    public const string Topmost = "topmost";
    public const string Clear = "clear";
}

public abstract record AgentMessage
{
    public abstract string Type { get; }
}

public sealed record ReadyMessage : AgentMessage
{
    public override string Type => "ready";

    public int Version { get; init; } = Protocol.Version;

    public required string InsertScheme { get; init; }

    public int ProcessId { get; init; }

    public required int Port { get; init; }
}

public sealed record InsertedMessage : AgentMessage
{
    public override string Type => "inserted";

    public required bool Ok { get; init; }

    public required string Scheme { get; init; }
}

public sealed record HotkeyMessage : AgentMessage
{
    public override string Type => "hotkey";

    public required string Action { get; init; }
}

public sealed record ErrorMessage : AgentMessage
{
    public override string Type => "error";

    public required string Message { get; init; }
}

public sealed record TokenResponse
{
    public required string Token { get; init; }

    public required int Port { get; init; }

    public required string InsertScheme { get; init; }

    public int Version { get; init; } = Protocol.Version;
}

public sealed record HealthResponse
{
    public required string Status { get; init; }

    public int Version { get; init; } = Protocol.Version;

    public int Sessions { get; init; }

    public required string InsertScheme { get; init; }

    public int ProcessId { get; init; }

    public required int Port { get; init; }
}
