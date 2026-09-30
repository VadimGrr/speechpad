using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speechpad.Agent.Licensing;

public sealed record LicensePayload
{
    public const int CurrentVersion = 1;

    [JsonPropertyName("v")]
    public int Version { get; init; } = CurrentVersion;

    [JsonPropertyName("product")]
    public string Product { get; init; } = LicenseLimits.Product;

    [JsonPropertyName("licensee")]
    public string Licensee { get; init; } = "unknown";

    [JsonPropertyName("issued")]
    public DateTimeOffset Issued { get; init; }

    [JsonPropertyName("expires")]
    public DateTimeOffset? Expires { get; init; }

    [JsonPropertyName("features")]
    public string[] Features { get; init; } = [];

    [JsonPropertyName("machine")]
    public string? Machine { get; init; }

    [JsonIgnore]
    public bool IsPerpetual => Expires is null;

    public byte[] ToBytes() => JsonSerializer.SerializeToUtf8Bytes(this, LicenseJson.Options);
}

public static class LicenseJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };
}

public static class LicenseLimits
{
    public const string Product = "speechpad-agent";

    public const string FeatureInsert = "insert";

    public const string FeatureExtension = "extension";

    public const string FeatureTopmost = "topmost";
}

public sealed record LicenseEnvelope
{
    [JsonPropertyName("payload")]
    public string Payload { get; init; } = string.Empty;

    [JsonPropertyName("signature")]
    public string Signature { get; init; } = string.Empty;
}
