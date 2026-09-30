using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Speechpad.Agent.Licensing;

namespace Speechpad.LicenseTool;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            PrintHelp();
            return 1;
        }

        try
        {
            return args[0] switch
            {
                "keygen" => Keygen(args[1..]),
                "issue" => Issue(args[1..]),
                "show" => Show(args[1..]),
                "--help" or "-h" or "help" => Help(),
                _ => Unknown(args[0]),
            };
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or CryptographicException or JsonException)
        {
            Console.Error.WriteLine($"ошибка: {ex.Message}");
            return 2;
        }
    }

    private static int Help()
    {
        PrintHelp();
        return 0;
    }

    private static int Unknown(string command)
    {
        Console.Error.WriteLine($"неизвестная команда: {command}");
        PrintHelp();
        return 1;
    }

    private static void PrintHelp()
    {
        Console.WriteLine(
            """
            speechpad-license — выпуск лицензий Speechpad

            Команды:
              keygen <private.pem> <public.pem>     создать пару ключей P-256
              issue <private.pem> <out.json>        выпустить лицензию
                --licensee "Имя"                    имя покупателя
                --expires 2027-12-31                дата окончания (без срока = бессрочно)
                --days 365                           срок в днях от сегодня
                --machine <id>                      привязка к компьютеру
                --features insert,extension,topmost  возможности (по умолчанию все)
                --all-machines                       не привязывать к компьютеру
              show <license.json>                   показать содержимое лицензии
            """);
    }

    private static int Keygen(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("нужно: keygen <private.pem> <public.pem>");
            return 1;
        }

        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        File.WriteAllText(args[0], key.ExportPkcs8PrivateKeyPem());
        File.WriteAllText(args[1], key.ExportSubjectPublicKeyInfoPem());
        Console.WriteLine($"приватный ключ: {Path.GetFullPath(args[0])}");
        Console.WriteLine($"публичный ключ: {Path.GetFullPath(args[1])}");
        Console.WriteLine("публичный ключ вставь в apps/agent/Licensing/KeyPair.cs");
        return 0;
    }

    private static int Issue(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("нужно: issue <private.pem> <out.json> [options]");
            return 1;
        }

        var privatePath = args[0];
        var outputPath = args[1];
        var licensee = Option(args, "--licensee") ?? "Speechpad";
        var features = Option(args, "--features") is { } raw
            ? raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            : [LicenseLimits.FeatureInsert, LicenseLimits.FeatureExtension, LicenseLimits.FeatureTopmost];

        DateTimeOffset? expires = null;
        if (Option(args, "--expires") is { } rawDate)
        {
            if (!DateTimeOffset.TryParse(rawDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            {
                Console.Error.WriteLine($"не понял дату: {rawDate}");
                return 1;
            }

            expires = parsed.Date.AddDays(1).AddSeconds(-1);
        }
        else if (Option(args, "--days") is { } rawDays
            && int.TryParse(rawDays, CultureInfo.InvariantCulture, out var days))
        {
            expires = DateTimeOffset.Now.AddDays(days);
        }

        var payload = new LicensePayload
        {
            Licensee = licensee,
            Issued = DateTimeOffset.Now,
            Expires = expires,
            Features = [.. features],
            Machine = Option(args, "--all-machines") is null ? Option(args, "--machine") : null,
        };

        var json = LicenseSigner.Sign(payload, File.ReadAllText(privatePath));
        var directory = Path.GetDirectoryName(Path.GetFullPath(outputPath));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(outputPath, json);
        Console.WriteLine($"лицензия: {Path.GetFullPath(outputPath)}");
        Console.WriteLine($"получатель: {payload.Licensee}");
        Console.WriteLine($"срок: {(payload.IsPerpetual ? "бессрочно" : payload.Expires!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))}");
        Console.WriteLine($"компьютер: {payload.Machine ?? "любой"}");
        Console.WriteLine($"возможности: {string.Join(", ", payload.Features)}");
        return 0;
    }

    private static int Show(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("нужно: show <license.json>");
            return 1;
        }

        var json = File.ReadAllText(args[0]);
        var envelope = JsonSerializer.Deserialize<LicenseEnvelope>(json, LicenseJson.Options);
        if (envelope is null || string.IsNullOrWhiteSpace(envelope.Payload))
        {
            Console.Error.WriteLine("в файле нет данных лицензии");
            return 1;
        }

        var payload = JsonSerializer.Deserialize<LicensePayload>(Base64Url.Decode(envelope.Payload), LicenseJson.Options);
        if (payload is null)
        {
            Console.Error.WriteLine("данные лицензии не читаются");
            return 1;
        }

        Console.WriteLine($"продукт: {payload.Product}");
        Console.WriteLine($"версия формата: {payload.Version}");
        Console.WriteLine($"получатель: {payload.Licensee}");
        Console.WriteLine($"выдана: {payload.Issued:yyyy-MM-dd}");
        Console.WriteLine($"срок: {(payload.IsPerpetual ? "бессрочно" : payload.Expires!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))}");
        Console.WriteLine($"компьютер: {payload.Machine ?? "любой"}");
        Console.WriteLine($"возможности: {string.Join(", ", payload.Features)}");
        return 0;
    }

    private static string? Option(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], name, StringComparison.Ordinal))
            {
                return args[i + 1];
            }
        }

        return null;
    }
}
