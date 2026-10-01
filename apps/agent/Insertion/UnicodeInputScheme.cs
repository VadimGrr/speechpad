using Speechpad.Agent.Native;

namespace Speechpad.Agent.Insertion;

public sealed class UnicodeInputScheme : IInsertionScheme
{
    private const ushort VkReturn = 0x0D;
    private const ushort VkTab = 0x09;
    private const ushort VkSpace = 0x20;
    private const int BatchChars = 24;
    private const int BatchPauseMs = 8;

    public string Name => "unicode";

    public void Insert(string text, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var batch = new List<NativeMethods.Input>();
        var inBatch = 0;

        var (leading, core, trailing) = ClipboardPasteScheme.SplitAffixes(text);
        if (core.Length == 0)
        {
            foreach (var inputs in PlanSpaces(leading + trailing))
            {
                InputBuilder.Send(inputs);
            }

            return;
        }

        foreach (var inputs in PlanSpaces(leading))
        {
            InputBuilder.Send(inputs);
        }

        foreach (var inputs in Plan(core))
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

        foreach (var inputs in PlanSpaces(trailing))
        {
            InputBuilder.Send(inputs);
        }
    }

    internal static IEnumerable<NativeMethods.Input[]> PlanSpaces(int count)
    {
        for (var i = 0; i < count; i++)
        {
            yield return [InputBuilder.KeyDown(VkSpace), InputBuilder.KeyUp(VkSpace)];
        }
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
