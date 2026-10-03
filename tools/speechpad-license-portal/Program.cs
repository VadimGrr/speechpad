using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Speechpad.LicensePortal;

internal sealed class PortalOptions
{
    public int Port { get; init; } = 8790;

    public string PrivateKeyPath { get; init; } = string.Empty;

    public string CredentialsPath { get; init; } = string.Empty;

    public string HistoryPath { get; init; } = string.Empty;

    public string WebRoot { get; init; } = string.Empty;

    public bool Init { get; init; }
}

internal sealed class PortalDefaults
{
    public string PrivateKey { get; init; } = string.Empty;

    public string Credentials { get; init; } = string.Empty;

    public string History { get; init; } = string.Empty;

    public string WebRoot { get; init; } = string.Empty;
}

internal static class Program
{
    internal const string CookieName = "speechpad_portal";

    private const int MinPort = 1024;
    private const int MaxPort = 65535;

    private static int Main(string[] args)
    {
        if (args.Contains("--help") || args.Contains("-h") || args.Contains("/?"))
        {
            PrintHelp();
            return 0;
        }

        PortalOptions options;
        try
        {
            options = Parse(args);
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine($"ошибка: {ex.Message}");
            PrintHelp();
            return 2;
        }

        var credentials = new CredentialStore(options.CredentialsPath);

        if (options.Init)
        {
            return Init(credentials);
        }

        if (!credentials.Exists)
        {
            Console.Error.WriteLine("администратор ещё не создан");
            Console.Error.WriteLine($"создайте его: dotnet run --project {ProjectPath()} -- --init");
            return 3;
        }

        try
        {
            return Run(options, credentials);
        }
        catch (Exception ex) when (ex is IOException
            or UnauthorizedAccessException
            or InvalidDataException
            or CryptographicException)
        {
            Console.Error.WriteLine($"ошибка: {ex.Message}");
            return 4;
        }
    }

    private static int Init(CredentialStore credentials)
    {
        Console.Write("новый пароль: ");
        var password = ReadHidden();
        if (password.Length == 0)
        {
            Console.Error.WriteLine("пароль не задан");
            return 2;
        }

        try
        {
            PasswordHasher.Validate(password);
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine($"ошибка: {ex.Message}");
            return 2;
        }

        credentials.Save(PasswordHasher.Create("admin", password));
        Console.WriteLine($"администратор создан: {credentials.Path}");
        return 0;
    }

    private static string ReadHidden()
    {
        if (Console.IsInputRedirected)
        {
            Console.Error.WriteLine("ввод пароля перенаправлен, введите его одной строкой");
            return Console.ReadLine() ?? string.Empty;
        }

        var buffer = new System.Text.StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter)
            {
                break;
            }

            if (key.Key == ConsoleKey.Backspace)
            {
                if (buffer.Length > 0)
                {
                    buffer.Length--;
                    Console.Write("\b \b");
                }

                continue;
            }

            if (!char.IsControl(key.KeyChar))
            {
                buffer.Append(key.KeyChar);
                Console.Write('*');
            }
        }

        Console.WriteLine();
        return buffer.ToString();
    }

    internal static string ProjectPath() => "tools/speechpad-license-portal/Speechpad.LicensePortal.csproj";

    private static void PrintHelp()
    {
        Console.WriteLine(
            """
            speechpad-license-portal — выдача лицензий Speechpad

            Портал слушает только 127.0.0.1, наружу не открывается.

              --init               создать администратора и выйти
              --port <номер>       порт (по умолчанию 8790)
              --private-key <путь>  файл приватного ключа PEM
              --credentials <путь> файл администратора
              --history <путь>     журнал выданных лицензий
              --web-root <путь>    папка со статикой
              --help               эта справка

            Пример:
              dotnet run --project tools/speechpad-license-portal/Speechpad.LicensePortal.csproj -- --init
            """);
    }

    internal static PortalOptions Parse(string[] args)
    {
        var defaults = DefaultPaths();
        var port = 8790;
        if (Option(args, "--port") is { } rawPort)
        {
            if (!int.TryParse(rawPort, NumberStyles.None, CultureInfo.InvariantCulture, out port))
            {
                throw new ArgumentException($"порт должен быть числом, а не «{rawPort}»");
            }
        }

        if (port is < MinPort or > MaxPort)
        {
            throw new ArgumentException($"порт должен быть от {MinPort} до {MaxPort}");
        }

        return new PortalOptions
        {
            Port = port,
            PrivateKeyPath = Option(args, "--private-key") ?? defaults.PrivateKey,
            CredentialsPath = Option(args, "--credentials") ?? defaults.Credentials,
            HistoryPath = Option(args, "--history") ?? defaults.History,
            WebRoot = Option(args, "--web-root") ?? defaults.WebRoot,
            Init = args.Contains("--init"),
        };
    }

    internal static PortalDefaults DefaultPaths()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var secrets = Path.Combine(home, "Documents", "speechpad-secrets");
        var webRoot = FindWebRoot();

        return new PortalDefaults
        {
            PrivateKey = Path.Combine(secrets, "license-private.pem"),
            Credentials = Path.Combine(secrets, "portal-admin.json"),
            History = Path.Combine(secrets, "issued-licenses.json"),
            WebRoot = webRoot,
        };
    }

    private static string FindWebRoot()
    {
        var candidate = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        if (Directory.Exists(candidate))
        {
            return candidate;
        }

        return Path.Combine(AppContext.BaseDirectory, "wwwroot");
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

    private static string ContentTypeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

private static int Run(PortalOptions options, CredentialStore credentials)
    {
var publicKeyPem = DerivePublicKeyPem(options.PrivateKeyPath);
        var keyFingerprint = Fingerprint(publicKeyPem);

        var history = new HistoryStore(options.HistoryPath);
        var issuer = new LicenseIssuer();
        var sessions = new SessionStore();
        var throttle = new LoginThrottle();

        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{options.Port}");

        var app = builder.Build();

        var webRoot = app.Environment.WebRootPath;
        if (string.IsNullOrWhiteSpace(webRoot) || !Directory.Exists(webRoot))
        {
            throw new IOException("не найдена папка со статикой wwwroot");
        }

        var loginPage = Path.Combine(webRoot, "login.html");
        var indexPage = Path.Combine(webRoot, "index.html");

        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XFrameOptions = "DENY";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            await next(context);
        });

        app.MapGet("/", (HttpContext context) =>
        {
            var session = sessions.Find(context.Request.Cookies[CookieName], DateTimeOffset.Now);
            var page = session is null ? loginPage : indexPage;
            return Results.File(page, ContentTypeFor(page));
        });

        app.MapGet("/static/{**path}", (string path) =>
        {
            var resolved = Path.GetFullPath(Path.Combine(webRoot, path));
            if (!resolved.StartsWith(webRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(resolved))
            {
                return Results.NotFound();
            }

            return Results.File(resolved, ContentTypeFor(resolved));
        });

        app.MapPost("/api/login", async (HttpContext context) =>
        {
            var now = DateTimeOffset.Now;
            var form = await context.Request.ReadFromJsonAsync<LoginRequest>();
            var login = form?.Login ?? string.Empty;
            var password = form?.Password ?? string.Empty;

            var delay = throttle.CheckDelay(login, now);
            if (delay > TimeSpan.Zero)
            {
                return TooMany(delay);
            }

            if (!PasswordHasher.Verify(credentials.Load(), login, password))
            {
                return TooMany(throttle.RecordFailure(login, now));
            }

            throttle.RecordSuccess(login);
            var session = sessions.Create(now);
            context.Response.Cookies.Append(CookieName, session.Token, new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                Expires = session.Expires,
            });

            return Results.Json(new { ok = true, csrf = session.Csrf, key = keyFingerprint });
        });

        app.MapPost("/api/logout", (HttpContext context) =>
        {
            sessions.Drop(context.Request.Cookies[CookieName]);
            context.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
            return Results.Json(new { ok = true });
        });

        app.MapGet("/api/session", (HttpContext context) =>
        {
            var session = sessions.Find(context.Request.Cookies[CookieName], DateTimeOffset.Now);
            return session is null
                ? Results.Json(new { ok = false })
                : Results.Json(new { ok = true, csrf = session.Csrf, key = keyFingerprint });
        });

        app.MapGet("/api/licenses", (HttpContext context) =>
        {
            if (Find(context, sessions) is null)
            {
                return Unauthorized();
            }

            return Results.Json(new { licenses = history.All() });
        });

        app.MapPost("/api/licenses", async (HttpContext context) =>
        {
            var session = Find(context, sessions);
            if (session is null)
            {
                return Unauthorized();
            }

            if (!CheckCsrf(context, session))
            {
                return Results.Json(new { error = "недействительный CSRF-токен" }, statusCode: StatusCodes.Status403Forbidden);
            }

            IssueRequest request;
            try
            {
                request = await context.Request.ReadFromJsonAsync<IssueRequest>() ?? new IssueRequest();
            }
            catch (JsonException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var result = issuer.Issue(request, ReadPrivateKey(options.PrivateKeyPath), history);
                return Results.Json(new
                {
                    ok = true,
                    id = result.Record.Id,
                    licensee = result.Record.Licensee,
                    issued = result.Record.Issued,
                    expires = result.Record.Expires,
                    perpetual = result.Record.Perpetual,
                    features = result.Record.Features,
                    machine = result.Record.Machine,
                    license = result.LicenseJson,
                });
            }
            catch (Exception ex) when (ex is ArgumentException or IOException or CryptographicException)
            {
                return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status400BadRequest);
            }
        });

        app.MapPost("/api/licenses/{id}/revoke", (HttpContext context, string id) =>
        {
            var session = Find(context, sessions);
            if (session is null)
            {
                return Unauthorized();
            }

            if (!CheckCsrf(context, session))
            {
                return Results.Json(new { error = "недействительный CSRF-токен" }, statusCode: StatusCodes.Status403Forbidden);
            }

            return history.Revoke(id, DateTimeOffset.Now)
                ? Results.Json(new { ok = true })
                : Results.Json(new { error = "не найдена или уже отозвана" }, statusCode: StatusCodes.Status404NotFound);
        });

        Console.WriteLine($"портал слушает http://127.0.0.1:{options.Port}");
        Console.WriteLine($"приватный ключ: {options.PrivateKeyPath}");
        Console.WriteLine($"отпечаток ключа: {keyFingerprint}");
        Console.WriteLine($"журнал: {options.HistoryPath}");
        app.Run();
        return 0;
    }

    private static IResult TooMany(TimeSpan delay)
    {
        if (delay <= TimeSpan.Zero)
        {
            return Results.Json(
                new { error = "неверный логин или пароль" },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        return Results.Json(
            new { error = $"слишком много попыток, подождите {Math.Ceiling(delay.TotalSeconds)} с" },
            statusCode: StatusCodes.Status429TooManyRequests);
    }

    private static IResult Unauthorized()
        => Results.Json(new { error = "нужен вход" }, statusCode: StatusCodes.Status401Unauthorized);

    private static PortalSession? Find(HttpContext context, SessionStore sessions)
        => sessions.Find(context.Request.Cookies[CookieName], DateTimeOffset.Now);

    private static bool CheckCsrf(HttpContext context, PortalSession session)
    {
        var provided = context.Request.Headers["X-CSRF-Token"].ToString();
        return !string.IsNullOrEmpty(provided)
            && CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(provided),
                Encoding.UTF8.GetBytes(session.Csrf));
    }

    private static string ReadPrivateKey(string path)
    {
        if (!File.Exists(path))
        {
            throw new IOException($"приватный ключ не найден: {path}");
        }

        return File.ReadAllText(path, Encoding.UTF8);
    }

    private static string DerivePublicKeyPem(string privateKeyPath)
    {
        using var key = ECDsa.Create();
        key.ImportFromPem(ReadPrivateKey(privateKeyPath));
        return key.ExportSubjectPublicKeyInfoPem();
    }

    internal static string Fingerprint(string publicKeyPem)
    {
        using var key = ECDsa.Create();
        key.ImportFromPem(publicKeyPem);
        return Convert.ToHexStringLower(SHA256.HashData(key.ExportSubjectPublicKeyInfo())).ToLower()[..16];
    }
}
