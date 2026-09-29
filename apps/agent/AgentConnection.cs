using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;
using Speechpad.Agent.Insertion;

namespace Speechpad.Agent;

public sealed class AgentConnection
{
    private const int MaxMessageChars = 64 * 1024;

    private readonly WebSocket socket;
    private readonly IInsertionQueue insertion;
    private readonly AgentOptions options;
    private readonly AgentLog log;
    private readonly IAgentActions actions;
    private readonly Channel<string> outgoing = Channel.CreateUnbounded<string>();
    private readonly CancellationTokenSource lifetime = new();

    public AgentConnection(
        WebSocket socket,
        IInsertionQueue insertion,
        AgentOptions options,
        AgentLog log,
        IAgentActions actions)
    {
        this.socket = socket;
        this.insertion = insertion;
        this.options = options;
        this.log = log;
        this.actions = actions;
    }

    public void Push(string json) => outgoing.Writer.TryWrite(json);

    internal string? TryDequeue()
        => outgoing.Reader.TryRead(out var json) ? json : null;

    public void Close() => lifetime.Cancel();

    public async Task RunAsync()
    {
        var token = lifetime.Token;
        var sender = Task.Run(() => SendLoopAsync(token), CancellationToken.None);
        try
        {
            await ReceiveLoopAsync(token).ConfigureAwait(false);
        }
        catch (WebSocketException ex)
        {
            log.Debug($"websocket closed: {ex.Message}");
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
        finally
        {
            outgoing.Writer.TryComplete();
            lifetime.Cancel();
            try
            {
                await sender.ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
            {
                // the socket is already gone
            }

            lifetime.Dispose();
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[8 * 1024];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken)
                    .ConfigureAwait(false);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    log.Debug("client closed the connection");
                    return;
                }

                if (message.Length + result.Count > MaxMessageChars)
                {
                    Push(Protocol.Write(new ErrorMessage { Message = "сообщение слишком большое" }));
                    return;
                }

                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            var json = Encoding.UTF8.GetString(message.ToArray());
            await HandleAsync(json, cancellationToken).ConfigureAwait(false);
        }
    }

    internal async Task HandleAsync(string json, CancellationToken cancellationToken)
    {
        if (ClientMessages.IsHello(json, out var version))
        {
            log.Info($"client connected, protocol {version}");
            Push(Protocol.Write(new ReadyMessage
            {
                InsertScheme = insertion.SchemeName,
                ProcessId = Environment.ProcessId,
                Port = options.Port,
            }));
            return;
        }

        if (ClientMessages.IsInsert(json, out var text, out var seq))
        {
            var result = await insertion.InsertAsync(text, cancellationToken).ConfigureAwait(false);
            log.Debug($"insert #{seq}: {result.Ok} ({result.Scheme}) {text.Length} chars");
            Push(Protocol.Write(new InsertedMessage { Ok = result.Ok, Scheme = result.Scheme }));
            if (!result.Ok && result.Error is not null)
            {
                Push(Protocol.Write(new ErrorMessage { Message = result.Error }));
            }

            return;
        }

        if (ClientMessages.IsCommand(json, out var command))
        {
            HandleCommand(command);
            return;
        }

        log.Warn($"ignored message: {Truncate(json)}");
        Push(Protocol.Write(new ErrorMessage { Message = "неизвестное сообщение" }));
    }

    private void HandleCommand(string command)
    {
        switch (command)
        {
            case "toggle":
                actions.BroadcastHotkey(HotkeyActions.Toggle);
                break;
            case "clear":
                actions.BroadcastHotkey(HotkeyActions.Clear);
                break;
            case "topmost":
                HandleTopmost();
                break;
            case "ping":
                Push(Protocol.Write(new ReadyMessage
                {
                    InsertScheme = insertion.SchemeName,
                    ProcessId = Environment.ProcessId,
                    Port = options.Port,
                }));
                break;
            default:
                Push(Protocol.Write(new ErrorMessage { Message = $"неизвестная команда «{command}»" }));
                break;
        }
    }

    private void HandleTopmost()
    {
        var title = Windows.WindowTools.Exists(options.CompactWindowTitle)
            ? options.CompactWindowTitle
            : options.MainWindowTitle;
        var done = Windows.WindowTools.ToggleTopmost(title);
        log.Info($"topmost {(done ? "on" : "failed")} for «{title}»");
        actions.BroadcastHotkey(HotkeyActions.Topmost);
        if (!done)
        {
            Push(Protocol.Write(new ErrorMessage
            {
                Message = "окно браузера не найдено: откройте главное или компактное окно",
            }));
        }
    }

    private async Task SendLoopAsync(CancellationToken cancellationToken)
    {
        var reader = outgoing.Reader;
        while (await reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
        {
            while (reader.TryRead(out var json))
            {
                if (socket.State != WebSocketState.Open)
                {
                    return;
                }

                var bytes = Encoding.UTF8.GetBytes(json);
                await socket.SendAsync(
                    new ArraySegment<byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private static string Truncate(string value)
        => value.Length <= 200 ? value : value[..200] + "…";
}
