using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speechpad.Agent.Insertion;

namespace Speechpad.Agent;

public sealed class AgentServer : IAsyncDisposable
{
    private readonly AgentOptions options;
    private readonly AgentLog log;
    private readonly IInsertionQueue insertion;
    private readonly IAgentActions actions;
    private readonly Licensing.LicenseGate license;
    private readonly string token;
    private readonly string webRoot;
    private readonly ConcurrentDictionary<Guid, AgentConnection> sessions = new();
    private WebApplication? app;
    private Task? runTask;

    public AgentServer(
        AgentOptions options,
        AgentLog log,
        IInsertionQueue insertion,
        IAgentActions actions,
        Licensing.LicenseGate license)
    {
        this.options = options;
        this.log = log;
        this.insertion = insertion;
        this.actions = actions;
        this.license = license;
        token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        webRoot = ResolveWebRoot(options.WebRoot);
    }

    public string Token => token;

    public string WebRoot => webRoot;

    public int Sessions => sessions.Count;

    public static string ResolveWebRoot(string? configured, string? baseDirectory = null)
    {
        if (!string.IsNullOrWhiteSpace(configured) && Directory.Exists(configured))
        {
            return Path.GetFullPath(configured);
        }

        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            candidates.Add(configured);
        }

        var probe = string.IsNullOrWhiteSpace(baseDirectory) ? AppContext.BaseDirectory : baseDirectory;
        for (var i = 0; i < 10; i++)
        {
            candidates.Add(Path.Combine(probe, "dist"));
            candidates.Add(Path.Combine(probe, "apps", "web", "dist"));
            candidates.Add(Path.Combine(probe, "web"));
            candidates.Add(Path.Combine(probe, "apps", "web"));

            var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(probe));
            if (string.IsNullOrEmpty(parent) || string.Equals(parent, probe, StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            probe = parent;
        }

        foreach (var candidate in candidates)
        {
            var full = Path.GetFullPath(candidate);
            if (IsBuildOutput(full))
            {
                return full;
            }
        }

        return Path.GetFullPath(candidates.Count > 0 ? candidates[0] : AppContext.BaseDirectory);
    }

    private static bool IsBuildOutput(string directory)
        => File.Exists(Path.Combine(directory, "index.html"))
            && !Directory.Exists(Path.Combine(directory, "src"))
            && !File.Exists(Path.Combine(directory, "package.json"));

    public void Start()
    {
        if (runTask is not null)
        {
            return;
        }

        app = Build();
        runTask = app.RunAsync();
        log.Info($"listening on http://127.0.0.1:{options.Port}, web root {webRoot}");
        log.Info($"insert scheme: {InsertionSchemes.Name(options.InsertScheme)}");
    }

    public void Broadcast(string json)
    {
        foreach (var connection in sessions.Values)
        {
            connection.Push(json);
        }
    }

    public void BroadcastHotkey(string action)
        => Broadcast(Protocol.Write(new HotkeyMessage { Action = action }));

    public async ValueTask DisposeAsync()
    {
        foreach (var connection in sessions.Values)
        {
            connection.Close();
        }

        if (app is not null)
        {
            try
            {
                await app.StopAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException)
            {
                // already stopping
            }

            await app.DisposeAsync().ConfigureAwait(false);
        }

        if (runTask is not null)
        {
            try
            {
                await runTask.ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is OperationCanceledException or IOException or ObjectDisposedException)
            {
                // host stopped
            }
        }
    }

    private WebApplication Build()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{options.Port}");
        builder.Services.AddSingleton(options);

        var web = builder.Build();
        web.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });

        web.Use(async (context, next) =>
        {
            if (await TryServeHtmlAsync(context).ConfigureAwait(false))
            {
                return;
            }

            await next().ConfigureAwait(false);
        });

        if (Directory.Exists(webRoot))
        {
            web.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(webRoot),
                ServeUnknownFileTypes = false,
            });
        }

        web.MapGet("/health", () => Results.Json(new HealthResponse
        {
            Status = "ok",
            Sessions = sessions.Count,
            InsertScheme = insertion.SchemeName,
            ProcessId = Environment.ProcessId,
            Port = options.Port,
            LicenseState = license.State.ToString().ToLowerInvariant(),
            LicenseMessage = license.Message,
            InsertAllowed = license.AllowsInsert,
            ExtensionAllowed = license.AllowsExtension,
        }));

        web.MapGet("/token", (HttpContext context) =>
        {
            if (!IsOriginAllowed(context.Request.Headers.Origin.ToString()))
            {
                log.Warn($"token request rejected for origin '{context.Request.Headers.Origin}'");
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            return Results.Json(new TokenResponse
            {
                Token = token,
                Port = options.Port,
                InsertScheme = insertion.SchemeName,
            });
        });

        web.MapGet("/ws", async (HttpContext context) =>
        {
            if (!string.Equals(context.Request.Query["token"], token, StringComparison.Ordinal))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            var id = Guid.NewGuid();
            var connection = new AgentConnection(socket, insertion, options, log, actions, license);
            sessions[id] = connection;
            try
            {
                await connection.RunAsync().ConfigureAwait(false);
            }
            finally
            {
                sessions.TryRemove(id, out _);
                await CloseQuietlyAsync(socket).ConfigureAwait(false);
            }
        });

        return web;
    }

    private static async Task CloseQuietlyAsync(WebSocket socket)
    {
        if (socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived))
        {
            return;
        }

        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "closed", timeout.Token)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is WebSocketException
            or OperationCanceledException
            or ObjectDisposedException
            or InvalidOperationException)
        {
            // the browser is gone, nothing to close
        }
    }

    internal bool IsOriginAllowed(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin))
        {
            return true;
        }

        var value = origin.TrimEnd('/');
        return AllowedOrigins.Contains(value, StringComparer.OrdinalIgnoreCase);
    }

    internal IEnumerable<string> AllowedOrigins =>
    [
        $"http://127.0.0.1:{options.Port}",
        $"http://localhost:{options.Port}",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ];

    internal string Injection => $"<script>window.__SPEECHPAD_AGENT__={Protocol.WriteJson(new TokenResponse
    {
        Token = token,
        Port = options.Port,
        InsertScheme = insertion.SchemeName,
    })};</script>";

    private async Task<bool> TryServeHtmlAsync(HttpContext context)
    {
        if (!HttpMethods.IsGet(context.Request.Method))
        {
            return false;
        }

        var path = context.Request.Path.Value ?? "/";
        if (path.Contains("..", StringComparison.Ordinal))
        {
            return false;
        }

        var relative = path.Trim('/');
        if (relative.Length == 0)
        {
            relative = "index.html";
        }

        if (!relative.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var root = Path.GetFullPath(webRoot);
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || !File.Exists(full))
        {
            return false;
        }

        var html = await File.ReadAllTextAsync(full, Encoding.UTF8, context.RequestAborted).ConfigureAwait(false);
        var injection = Injection;

        var patched = html.Contains("</head>", StringComparison.OrdinalIgnoreCase)
            ? html.Replace("</head>", injection + "</head>", StringComparison.OrdinalIgnoreCase)
            : injection + html;

        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsync(patched, Encoding.UTF8, context.RequestAborted).ConfigureAwait(false);
        return true;
    }
}