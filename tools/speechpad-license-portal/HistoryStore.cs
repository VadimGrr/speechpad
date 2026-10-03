using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speechpad.LicensePortal;

internal sealed record IssuedLicense
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("licensee")]
    public required string Licensee { get; init; }

    [JsonPropertyName("issued")]
    public required DateTimeOffset Issued { get; init; }

    [JsonPropertyName("expires")]
    public DateTimeOffset? Expires { get; init; }

    [JsonPropertyName("features")]
    public required string[] Features { get; init; }

    [JsonPropertyName("machine")]
    public string? Machine { get; init; }

    [JsonPropertyName("revoked")]
    public bool Revoked { get; set; }

    [JsonPropertyName("revokedAt")]
    public DateTimeOffset? RevokedAt { get; set; }

    [JsonPropertyName("note")]
    public string Note { get; init; } = string.Empty;

    [JsonIgnore]
    public bool Perpetual => Expires is null;
}

internal sealed class HistoryStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly object gate = new();
    private readonly string path;
    private List<IssuedLicense>? cache;

    public HistoryStore(string path) => this.path = path;

    public string Path => path;

    public IReadOnlyList<IssuedLicense> All()
    {
        lock (gate)
        {
            var items = Load().ToList();
            return items.OrderByDescending(item => item.Issued).ToList();
        }
    }

    public IssuedLicense Add(IssuedLicense license)
    {
        lock (gate)
        {
            var items = Load().ToList();
            items.Add(license);
            Save(items);
            return license;
        }
    }

    public bool Revoke(string id, DateTimeOffset now)
    {
        lock (gate)
        {
            var items = Load().ToList();
            var index = items.FindIndex(item => string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase));
            if (index < 0)
            {
                return false;
            }

            if (items[index].Revoked)
            {
                return false;
            }

            items[index].Revoked = true;
            items[index].RevokedAt = now;
            Save(items);
            return true;
        }
    }

    private List<IssuedLicense> Load()
    {
        if (cache is not null)
        {
            return cache;
        }

        if (!File.Exists(path))
        {
            cache = [];
            return cache;
        }

        var json = File.ReadAllText(path, Encoding.UTF8);
        cache = JsonSerializer.Deserialize<List<IssuedLicense>>(json, Options) ?? [];
        return cache;
    }

    private void Save(List<IssuedLicense> items)
    {
        var directory = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(items, Options), Encoding.UTF8);
        File.Move(temp, path, overwrite: true);
        cache = items;
        CredentialStore.RestrictToOwner(path);
    }
}
