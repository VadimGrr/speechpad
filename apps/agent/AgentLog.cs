using System.Text;

namespace Speechpad.Agent;

public sealed class AgentLog : IDisposable
{
    private readonly StreamWriter? file;
    private readonly object gate = new();
    private readonly bool verbose;

    public AgentLog(string? path, bool verbose)
    {
        this.verbose = verbose;
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        try
        {
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            file = new StreamWriter(new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
            {
                AutoFlush = true,
            };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            file = null;
        }
    }

    public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "speechpad-agent.log");

    public void Info(string message) => Write("INFO", message);

    public void Warn(string message) => Write("WARN", message);

    public void Error(string message, Exception? error = null)
        => Write("ERROR", error is null ? message : $"{message}: {error.Message}");

    public void Debug(string message)
    {
        if (verbose)
        {
            Write("DEBUG", message);
        }
    }

    private void Write(string level, string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}";
        lock (gate)
        {
            file?.WriteLine(line);
            try
            {
                Console.WriteLine(line);
            }
            catch (IOException)
            {
                // no console attached
            }
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            file?.Dispose();
        }
    }

    public static string Tail(string path, int lines = 40)
    {
        if (!File.Exists(path))
        {
            return string.Empty;
        }

        try
        {
            var all = File.ReadAllLines(path, Encoding.UTF8);
            return string.Join(Environment.NewLine, all.TakeLast(lines));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return string.Empty;
        }
    }
}
