using Speechpad.Agent.Native;

namespace Speechpad.Agent.Insertion;

public sealed class ClipboardPasteScheme : IInsertionScheme
{
    private const ushort VkControl = 0x11;
    private const ushort VkV = 0x56;
    private const ushort VkSpace = 0x20;

    internal const int ClipboardSettleMs = 80;
    internal const int PasteSettleMs = 350;
    internal const int SpaceSettleMs = 40;

    public string Name => "clipboard";

    public void Insert(string text, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        var (leading, core, trailing) = SplitAffixes(text);
        if (core.Length == 0)
        {
            TypeSpaces(leading + trailing);
            return;
        }

        if (leading > 0)
        {
            TypeSpaces(leading);
        }

        var previous = ReadClipboard();
        SetClipboard(core);
        Thread.Sleep(ClipboardSettleMs);
        InputBuilder.Send(Plan());
        Thread.Sleep(PasteSettleMs);
        RestoreClipboard(previous, core);

        if (trailing > 0)
        {
            TypeSpaces(trailing);
        }
    }

    internal static (int Leading, string Core, int Trailing) SplitAffixes(string text)
    {
        var start = 0;
        var end = text.Length;
        while (start < end && char.IsWhiteSpace(text[start]))
        {
            start++;
        }

        while (end > start && char.IsWhiteSpace(text[end - 1]))
        {
            end--;
        }

        return (start, text[start..end], text.Length - end);
    }

    private static void TypeSpaces(int count)
    {
        for (var i = 0; i < count; i++)
        {
            InputBuilder.Send(InputBuilder.VirtualKey(VkSpace, keyUp: false));
            Thread.Sleep(SpaceSettleMs);
        }
    }

    internal static NativeMethods.Input[] Plan() =>
    [
        InputBuilder.KeyDown(VkControl),
        InputBuilder.KeyDown(VkV),
        InputBuilder.KeyUp(VkV),
        InputBuilder.KeyUp(VkControl),
    ];

    private static string? ReadClipboard()
    {
        try
        {
            return System.Windows.Forms.Clipboard.ContainsText()
                ? System.Windows.Forms.Clipboard.GetText()
                : null;
        }
        catch (Exception ex) when (IsClipboardFailure(ex))
        {
            return null;
        }
    }

    private static void SetClipboard(string text)
        => System.Windows.Forms.Clipboard.SetDataObject(text, copy: true, retryTimes: 5, retryDelay: 40);

    private static void RestoreClipboard(string? previous, string inserted)
    {
        if (string.IsNullOrEmpty(previous))
        {
            return;
        }

        try
        {
            if (System.Windows.Forms.Clipboard.ContainsText()
                && System.Windows.Forms.Clipboard.GetText() == inserted)
            {
                System.Windows.Forms.Clipboard.SetDataObject(previous, copy: true, retryTimes: 3, retryDelay: 40);
            }
        }
        catch (Exception ex) when (IsClipboardFailure(ex))
        {
            // the clipboard is busy, nothing we can do
        }
    }

    private static bool IsClipboardFailure(Exception ex)
        => ex is System.Runtime.InteropServices.COMException
            or System.Threading.ThreadStateException
            or System.Runtime.InteropServices.ExternalException;
}
