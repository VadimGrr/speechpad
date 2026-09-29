using Speechpad.Agent.Native;

namespace Speechpad.Agent.Insertion;

public sealed class UnicodeInputScheme : IInsertionScheme
{
    private const ushort VkReturn = 0x0D;
    private const ushort VkTab = 0x09;
    private const int BatchChars = 24;
    private const int BatchPauseMs = 8;

    public string Name => "unicode";

    public void Insert(string text, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var batch = new List<NativeMethods.Input>();
        var inBatch = 0;

        foreach (var inputs in Plan(text))
        {
            cancellationToken.ThrowIfCancellationRequested();
            batch.AddRange(inputs);
            inBatch++;
            if (inBatch >= BatchChars)
            {
                InputBuilder.Send(batch);
                batch.Clear();
                inBatch = 0;
                Thread.Sleep(BatchPauseMs);
            }
        }

        InputBuilder.Send(batch);
    }

    internal static IEnumerable<NativeMethods.Input[]> Plan(string text)
    {
        foreach (var symbol in text)
        {
            yield return symbol switch
            {
                '\r' => [],
                '\n' => [InputBuilder.KeyDown(VkReturn), InputBuilder.KeyUp(VkReturn)],
                '\t' => [InputBuilder.KeyDown(VkTab), InputBuilder.KeyUp(VkTab)],
                _ => [.. InputBuilder.UnicodeChar(symbol, false), .. InputBuilder.UnicodeChar(symbol, true)],
            };
        }
    }
}
