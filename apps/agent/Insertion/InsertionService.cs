using System.Threading.Channels;

namespace Speechpad.Agent.Insertion;

public sealed record InsertResult(bool Ok, string Scheme, string? Error = null);

public interface IInsertionQueue
{
    string SchemeName { get; }

    Task<InsertResult> InsertAsync(string text, CancellationToken cancellationToken = default);
}

public static class InsertionSchemes
{
    public static IInsertionScheme Create(InsertScheme scheme) => scheme switch
    {
        InsertScheme.UnicodeInput => new UnicodeInputScheme(),
        _ => new ClipboardPasteScheme(),
    };

    public static string Name(InsertScheme scheme) => scheme switch
    {
        InsertScheme.UnicodeInput => "unicode",
        _ => "clipboard",
    };
}

public sealed class InsertionService : IInsertionQueue, IDisposable
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);
    private readonly Channel<Request> channel = Channel.CreateUnbounded<Request>();
    private readonly IInsertionScheme scheme;
    private readonly Thread worker;
    private bool disposed;

    public InsertionService(IInsertionScheme scheme)
    {
        this.scheme = scheme;
        worker = new Thread(Run)
        {
            IsBackground = true,
            Name = "speechpad-insert",
        };
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();
    }

    public string SchemeName => scheme.Name;

    public async Task<InsertResult> InsertAsync(string text, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (string.IsNullOrWhiteSpace(text))
        {
            return new InsertResult(false, scheme.Name, "пустой текст");
        }

        var request = new Request(text, cancellationToken);
        if (!channel.Writer.TryWrite(request))
        {
            return new InsertResult(false, scheme.Name, "очередь вставки закрыта");
        }

        var timeout = Task.Delay(RequestTimeout, cancellationToken);
        if (await Task.WhenAny(request.Completion.Task, timeout).ConfigureAwait(false) != request.Completion.Task)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return new InsertResult(false, scheme.Name, "вставка не завершилась вовремя");
        }

        return await request.Completion.Task.ConfigureAwait(false);
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        channel.Writer.TryComplete();
        if (worker.IsAlive)
        {
            worker.Join(TimeSpan.FromSeconds(2));
        }
    }

    private void Run()
    {
        while (channel.Reader.WaitToReadAsync().AsTask().GetAwaiter().GetResult())
        {
            while (channel.Reader.TryRead(out var request))
            {
                Handle(request);
            }
        }
    }

    private void Handle(Request request)
    {
        if (request.Completion.Task.IsCompleted)
        {
            return;
        }

        try
        {
            scheme.Insert(request.Text, request.Token);
            request.Completion.TrySetResult(new InsertResult(true, scheme.Name));
        }
        catch (OperationCanceledException)
        {
            request.Completion.TrySetResult(new InsertResult(false, scheme.Name, "отменено"));
        }
        catch (Exception ex)
        {
            request.Completion.TrySetResult(new InsertResult(false, scheme.Name, ex.Message));
        }
    }

    private sealed record Request(string Text, CancellationToken Token)
    {
        public TaskCompletionSource<InsertResult> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
