using System.Net.WebSockets;
using System.Text.Json;
using Speechpad.Agent;
using Speechpad.Agent.Insertion;
using Xunit;

namespace Speechpad.Agent.Tests;

public class ConnectionTests
{
    [Fact]
    public async Task HelloProducesReady()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("{\"type\":\"hello\",\"version\":1}", CancellationToken.None);

        var json = harness.Connection.TryDequeue();
        Assert.NotNull(json);
        var root = JsonDocument.Parse(json!).RootElement;
        Assert.Equal("ready", root.GetProperty("type").GetString());
        Assert.Equal("clipboard", root.GetProperty("insertScheme").GetString());
        Assert.Equal(8787, root.GetProperty("port").GetInt32());
    }

    [Fact]
    public async Task InsertGoesThroughTheQueue()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("{\"type\":\"insert\",\"text\":\"привет\",\"seq\":3}", CancellationToken.None);

        Assert.Equal("привет", Assert.Single(harness.Queue.Inserted));
        var root = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.Equal("inserted", root.GetProperty("type").GetString());
        Assert.True(root.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task FailedInsertIsReported()
    {
        var harness = new Harness();
        harness.Queue.Result = new InsertResult(false, "clipboard", "буфер занят");
        await harness.Connection.HandleAsync("{\"type\":\"insert\",\"text\":\"текст\"}", CancellationToken.None);

        var first = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.False(first.GetProperty("ok").GetBoolean());
        var second = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.Equal("error", second.GetProperty("type").GetString());
        Assert.Equal("буфер занят", second.GetProperty("message").GetString());
    }

    [Fact]
    public async Task CommandsReachTheActions()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("{\"type\":\"command\",\"name\":\"toggle\"}", CancellationToken.None);
        await harness.Connection.HandleAsync("{\"type\":\"command\",\"name\":\"clear\"}", CancellationToken.None);

        Assert.Equal(["toggle", "clear"], harness.Actions.Broadcasts);
        Assert.Null(harness.Connection.TryDequeue());
    }

    [Fact]
    public async Task PingAnswersReady()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("{\"type\":\"command\",\"name\":\"ping\"}", CancellationToken.None);
        var root = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.Equal("ready", root.GetProperty("type").GetString());
    }

    [Fact]
    public async Task TopmostReportsMissingWindow()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("{\"type\":\"command\",\"name\":\"topmost\"}", CancellationToken.None);
        var root = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.Equal("error", root.GetProperty("type").GetString());
        Assert.Contains("окно браузера не найдено", root.GetProperty("message").GetString());
        Assert.Contains("topmost", harness.Actions.Broadcasts);
    }

    [Fact]
    public async Task UnknownCommandIsRejected()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("{\"type\":\"command\",\"command\":\"reboot\"}", CancellationToken.None);
        var root = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.Equal("error", root.GetProperty("type").GetString());
        Assert.Empty(harness.Actions.Broadcasts);
    }

    [Fact]
    public async Task GarbageIsRejected()
    {
        var harness = new Harness();
        await harness.Connection.HandleAsync("привет", CancellationToken.None);
        var root = JsonDocument.Parse(harness.Connection.TryDequeue()!).RootElement;
        Assert.Equal("error", root.GetProperty("type").GetString());
    }

    private sealed class Harness
    {
        public Harness()
        {
            Connection = new AgentConnection(
                new StubSocket(),
                Queue,
                new AgentOptions
                {
                    MainWindowTitle = $"speechpad-missing-main-{Guid.NewGuid():N}",
                    CompactWindowTitle = $"speechpad-missing-compact-{Guid.NewGuid():N}",
                },
                new AgentLog(null, verbose: false),
                Actions);
        }

        public FakeQueue Queue { get; } = new();

        public FakeActions Actions { get; } = new();

        public AgentConnection Connection { get; }
    }

    private sealed class FakeQueue : IInsertionQueue
    {
        public List<string> Inserted { get; } = [];

        public InsertResult Result { get; set; } = new(true, "clipboard");

        public string SchemeName => "clipboard";

        public Task<InsertResult> InsertAsync(string text, CancellationToken cancellationToken = default)
        {
            Inserted.Add(text);
            return Task.FromResult(Result);
        }
    }

    private sealed class FakeActions : IAgentActions
    {
        public List<string> Broadcasts { get; } = [];

        public int TopmostCalls { get; private set; }

        public void BroadcastHotkey(string action) => Broadcasts.Add(action);

        public void ToggleTopmostCompact() => TopmostCalls++;

        public void ToggleTopmostMain() => TopmostCalls++;

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

    private sealed class StubSocket : WebSocket
    {
        public override WebSocketCloseStatus? CloseStatus => null;

        public override string? CloseStatusDescription => null;

        public override WebSocketState State => WebSocketState.Open;

        public override string? SubProtocol => null;

        public override void Abort()
        {
        }

        public override Task CloseAsync(
            WebSocketCloseStatus closeStatus,
            string? statusDescription,
            CancellationToken cancellationToken) => Task.CompletedTask;

        public override Task CloseOutputAsync(
            WebSocketCloseStatus closeStatus,
            string? statusDescription,
            CancellationToken cancellationToken) => Task.CompletedTask;

        public override void Dispose()
        {
        }

        public override Task<WebSocketReceiveResult> ReceiveAsync(
            ArraySegment<byte> buffer,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public override Task SendAsync(
            ArraySegment<byte> buffer,
            WebSocketMessageType messageType,
            bool endOfMessage,
            CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
