using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speechpad.LicensePortal;

internal sealed class AdminCredentials
{
    [JsonPropertyName("login")]
    public string Login { get; init; } = "admin";

    [JsonPropertyName("salt")]
    public required string Salt { get; init; }

    [JsonPropertyName("hash")]
    public required string Hash { get; init; }

    [JsonPropertyName("iterations")]
    public int Iterations { get; init; }

    [JsonPropertyName("updated")]
    public DateTimeOffset Updated { get; init; }
}

internal static class PasswordHasher
{
    internal const int DefaultIterations = 210_000;
    internal const int SaltBytes = 16;
    internal const int HashBytes = 32;
    internal const int MinLength = 8;

    public static AdminCredentials Create(string login, string password, int iterations = DefaultIterations)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(login);
        Validate(password);

        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        return new AdminCredentials
        {
            Login = login,
            Salt = Convert.ToBase64String(salt),
            Hash = Convert.ToBase64String(Derive(password, salt, iterations)),
            Iterations = iterations,
            Updated = DateTimeOffset.Now,
        };
    }

    public static bool Verify(AdminCredentials credentials, string login, string password)
    {
        ArgumentNullException.ThrowIfNull(credentials);

        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(credentials.Login),
                Encoding.UTF8.GetBytes(login ?? string.Empty)))
        {
            return false;
        }

        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromBase64String(credentials.Salt);
            expected = Convert.FromBase64String(credentials.Hash);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Derive(password ?? string.Empty, salt, credentials.Iterations);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    public static void Validate(string password)
    {
        ArgumentNullException.ThrowIfNull(password);

        if (password.Length < MinLength)
        {
            throw new ArgumentException($"пароль короче {MinLength} символов");
        }

        if (password.Length > 256)
        {
            throw new ArgumentException("пароль длиннее 256 символов");
        }
    }

    private static byte[] Derive(string password, byte[] salt, int iterations)
        => Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            iterations,
            HashAlgorithmName.SHA256,
            HashBytes);
}

internal sealed class CredentialStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string path;

    public CredentialStore(string path) => this.path = path;

    public string Path => path;

    public bool Exists => File.Exists(path);

    public AdminCredentials Load()
    {
        var json = File.ReadAllText(path, Encoding.UTF8);
        return JsonSerializer.Deserialize<AdminCredentials>(json, Options)
            ?? throw new InvalidDataException("файл администратора не читается");
    }

    public void Save(AdminCredentials credentials)
    {
        var directory = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, JsonSerializer.Serialize(credentials, Options), Encoding.UTF8);
        RestrictToOwner(path);
    }

    internal static void RestrictToOwner(string file)
    {
        if (OperatingSystem.IsWindows())
        {
            NativeProtect.HideFromOtherUsers(file);
        }
    }
}
