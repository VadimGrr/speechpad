using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Speechpad.Agent;
using Speechpad.Agent.Insertion;
using Xunit;

namespace Speechpad.Agent.Tests;

public class HttpSurfaceTests : IAsyncLifetime
{
    private static readonly int Port = FreePort();

    private string root = string.Empty;
    private string token = string.Empty;
    private HttpClient client = null!;
    private AgentServer server = null!;

    public async Task InitializeAsync()
    {
        root = Path.Combine(Path.GetTempPath(), $"speechpad-http-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        File.WriteAllText(
            Path.Combine(root, "index.html"),
            "<!doctype html><html><head><title>main</title></head><body>окно</body></html>");
        File.WriteAllText(
            Path.Combine(root, "float.html"),
            "<!doctype html><html><head><title>compact</title></head><body>окно</body></html>");
        File.WriteAllText(Path.Combine(root, "app.js"), "console.log('__SPEECHPAD_AGENT__');");

        server = new AgentServer(
            new AgentOptions { Port = Port, WebRoot = root },
            new AgentLog(null, verbose: false),
            new EchoInsertion(),
            new NullActions(),
            LicenseFixture.Valid());
        server.Start();
        token = server.Token;
        client = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{Port}") };

        for (var i = 0; i < 40; i++)
        {
            try
            {
                using var ping = await client.GetAsync("/health");
                if (ping.IsSuccessStatusCode) return;
            }
            catch (HttpRequestException)
            {
                await Task.Delay(50);
            }
        }
    }

    public async Task DisposeAsync()
    {
        client.Dispose();
        await server.DisposeAsync();
        Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task HealthDescribesTheAgent()
    {
        var health = await client.GetFromJsonAsync<HealthResponse>("/health");
        Assert.NotNull(health);
        Assert.Equal("ok", health!.Status);
        Assert.Equal("echo", health.InsertScheme);
        Assert.Equal(Port, health.Port);
        Assert.Equal(Protocol.Version, health.Version);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.OK)]
    [InlineData("http://127.0.0.1:{PORT}", HttpStatusCode.OK)]
    [InlineData("http://localhost:{PORT}/", HttpStatusCode.OK)]
    [InlineData("http://127.0.0.1:5173", HttpStatusCode.OK)]
    [InlineData("http://localhost:5173", HttpStatusCode.OK)]
    [InlineData("https://speechpad.example.com", HttpStatusCode.Forbidden)]
    [InlineData("http://127.0.0.1:9999", HttpStatusCode.Forbidden)]
    [InlineData("null", HttpStatusCode.Forbidden)]
    public async Task TokenChecksTheOrigin(string? origin, HttpStatusCode expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/token");
        if (origin is not null) request.Headers.TryAddWithoutValidation("Origin", origin.Replace("{PORT}", Port.ToString()));
        using var response = await client.SendAsync(request);
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task TokenIsReturnedForLoopback()
    {
        var payload = await client.GetFromJsonAsync<TokenResponse>("/token");
        Assert.Equal(token, payload?.Token);
        Assert.Equal(Port, payload?.Port);
        Assert.Equal("echo", payload?.InsertScheme);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/float.html")]
    public async Task HtmlPagesCarryTheHandshake(string path)
    {
        var html = await client.GetStringAsync(path);
        Assert.Contains("window.__SPEECHPAD_AGENT__", html);
        Assert.Contains(token, html);
        var script = html.IndexOf("window.__SPEECHPAD_AGENT__", StringComparison.Ordinal);
        var head = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        Assert.True(script > 0 && script < head, $"script at {script}, head ends at {head}");
    }

    [Fact]
    public async Task AssetsAreServedWithoutTheToken()
    {
        var script = await client.GetStringAsync("/app.js");
        Assert.DoesNotContain(token, script);
        Assert.Contains("__SPEECHPAD_AGENT__", script);
    }

    [Fact]
    public async Task MissingPagesReturnNotFound()
    {
        using var response = await client.GetAsync("/nope.html");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DirectoryTraversalIsRefused()
    {
        using var response = await client.GetAsync("/%2e%2e/settings.json");
        Assert.True(
            response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest,
            $"status was {response.StatusCode}");
    }

    [Fact]
    public async Task WebSocketRefusesAWrongToken()
    {
        using var response = await client.GetAsync("/ws?token=deadbeef");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task WebSocketRefusesAPlainRequest()
    {
        using var response = await client.GetAsync($"/ws?token={token}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task WebSocketRoundTripInsertsText()
    {
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(new Uri($"ws://127.0.0.1:{Port}/ws?token={token}"), CancellationToken.None);
        await SendAsync(socket, new { type = "hello", version = 1 });

        var ready = await ReceiveAsync(socket);
        Assert.Equal("ready", ready.GetProperty("type").GetString());
        Assert.Equal("echo", ready.GetProperty("insertScheme").GetString());

        await SendAsync(socket, new { type = "insert", text = "привет", seq = 4 });
        var inserted = await ReceiveAsync(socket);
        Assert.Equal("inserted", inserted.GetProperty("type").GetString());
        Assert.True(inserted.GetProperty("ok").GetBoolean());
        Assert.Equal("привет", EchoInsertion.LastText);

        await SendAsync(socket, new { type = "command", name = "ping" });
        var pong = await ReceiveAsync(socket);
        Assert.Equal("ready", pong.GetProperty("type").GetString());

        socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None).Wait(TimeSpan.FromSeconds(5));

        for (var i = 0; i < 20 && server.Sessions > 0; i++)
        {
            await Task.Delay(50);
        }

        Assert.Equal(0, server.Sessions);
    }

    private static async Task SendAsync(ClientWebSocket socket, object payload)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Protocol.Json));
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private static async Task<JsonElement> ReceiveAsync(ClientWebSocket socket)
    {
        var buffer = new byte[8 * 1024];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            stream.Write(buffer, 0, result.Count);
        }
        while (!result.EndOfMessage);

        using var document = JsonDocument.Parse(Encoding.UTF8.GetString(stream.ToArray()));
        return document.RootElement.Clone();
    }

    private static int FreePort()
    {
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private sealed class EchoInsertion : IInsertionQueue
    {
        public static string? LastText { get; private set; }

        public string SchemeName => "echo";

        public Task<InsertResult> InsertAsync(string text, CancellationToken cancellationToken = default)
        {
            LastText = text;
            return Task.FromResult(new InsertResult(true, "echo"));
        }
    }

    private sealed class NullActions : IAgentActions
    {
        public void BroadcastHotkey(string action)
        {
        }

        public void ToggleTopmostCompact()
        {
        }

        public void ToggleTopmostMain()
        {
        }

        public void FocusMainWindow()
        {
        }

        public void ShowBalloon(string title, string text)
        {
        }

        public void Quit()
        {
        }
    }
}
