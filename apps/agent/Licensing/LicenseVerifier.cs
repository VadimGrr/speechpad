using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Speechpad.Agent.Licensing;

public sealed class LicenseVerifier
{
    private readonly ECDsa verifier;

    public LicenseVerifier(string publicKeyPem)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(publicKeyPem);
        verifier = ECDsa.Create();
        try
        {
            verifier.ImportFromPem(publicKeyPem);
        }
        catch (ArgumentException)
        {
            verifier.Dispose();
            throw new ArgumentException("ключ не похож на PEM с блоком PUBLIC KEY", nameof(publicKeyPem));
        }
        catch (CryptographicException)
        {
            verifier.Dispose();
            throw new ArgumentException("ключ не похож на PEM с блоком PUBLIC KEY", nameof(publicKeyPem));
        }
    }

    public LicenseCheck Verify(string? licenseJson, DateTimeOffset now, string? machineId = null)
    {
        if (string.IsNullOrWhiteSpace(licenseJson))
        {
            return LicenseCheck.Missing();
        }

        LicenseEnvelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<LicenseEnvelope>(licenseJson, LicenseJson.Options);
        }
        catch (JsonException)
        {
            return LicenseCheck.Invalid("файл лицензии не читается");
        }

        if (envelope is null || string.IsNullOrWhiteSpace(envelope.Payload) || string.IsNullOrWhiteSpace(envelope.Signature))
        {
            return LicenseCheck.Invalid("в файле лицензии нет подписи");
        }

        byte[] payload;
        byte[] signature;
        try
        {
            payload = Base64Url.Decode(envelope.Payload);
            signature = Base64Url.Decode(envelope.Signature);
        }
        catch (FormatException)
        {
            return LicenseCheck.Invalid("подпись повреждена");
        }

        if (!verifier.VerifyData(payload, signature, HashAlgorithmName.SHA256))
        {
            return LicenseCheck.Invalid("подпись не прошла проверку");
        }

        LicensePayload? data;
        try
        {
            data = JsonSerializer.Deserialize<LicensePayload>(payload, LicenseJson.Options);
        }
        catch (JsonException)
        {
            return LicenseCheck.Invalid("данные лицензии не читаются");
        }

        if (data is null)
        {
            return LicenseCheck.Invalid("пустая лицензия");
        }

        if (data.Version != LicensePayload.CurrentVersion)
        {
            return LicenseCheck.Invalid($"неподдерживаемая версия лицензии {data.Version}");
        }

        if (!string.Equals(data.Product, LicenseLimits.Product, StringComparison.Ordinal))
        {
            return LicenseCheck.Invalid($"лицензия для продукта «{data.Product}»");
        }

        if (data.Expires is not null && now > data.Expires.Value)
        {
            return new LicenseCheck
            {
                State = LicenseState.Expired,
                Message = $"срок лицензии истёк {data.Expires.Value:yyyy-MM-dd}",
                Payload = data,
            };
        }

        if (!string.IsNullOrWhiteSpace(data.Machine)
            && !string.IsNullOrWhiteSpace(machineId)
            && !string.Equals(data.Machine, machineId, StringComparison.OrdinalIgnoreCase))
        {
            return LicenseCheck.Invalid("лицензия выдана на другой компьютер");
        }

        return new LicenseCheck
        {
            State = LicenseState.Valid,
            Message = data.IsPerpetual
                ? "бессрочная лицензия"
                : $"действует до {data.Expires!.Value:yyyy-MM-dd}",
            Payload = data,
        };
    }
}

public static class Base64Url
{
    public static string Encode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] Decode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += (value.Length % 4) switch { 2 => "==", 3 => "=", _ => string.Empty };
        return Convert.FromBase64String(padded);
    }
}

public static class LicenseSigner
{
    public static string Sign(LicensePayload payload, string privateKeyPem)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(privateKeyPem);
        var data = payload.ToBytes();
        using var key = ECDsa.Create();
        key.ImportFromPem(privateKeyPem);
        var signature = key.SignData(data, HashAlgorithmName.SHA256);
        var envelope = new LicenseEnvelope
        {
            Payload = Base64Url.Encode(data),
            Signature = Base64Url.Encode(signature),
        };
        return JsonSerializer.Serialize(envelope, LicenseJson.Options);
    }
}

public enum LicenseState
{
    Missing,
    Trial,
    Invalid,
    Expired,
    Valid,
}

public sealed class LicenseCheck
{
    public required LicenseState State { get; init; }

    public required string Message { get; init; }

    public LicensePayload? Payload { get; init; }

    public bool IsValid => State == LicenseState.Valid;

    public bool Allows(string feature)
        => IsValid && (Payload?.Features.Contains(feature, StringComparer.OrdinalIgnoreCase) ?? false);

    public static LicenseCheck Missing() => new()
    {
        State = LicenseState.Missing,
        Message = "лицензия не найдена",
    };

    public static LicenseCheck Invalid(string message) => new()
    {
        State = LicenseState.Invalid,
        Message = message,
    };
}
