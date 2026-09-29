using Speechpad.Agent.Native;

namespace Speechpad.Agent.Insertion;

public sealed class ClipboardPasteScheme : IInsertionScheme
{
    private const ushort VkControl = 0x11;
    private const ushort VkV = 0x56;

    internal const int ClipboardSettleMs = 60;
    internal const int PasteSettleMs = 120;

    public string Name => "clipboard";

    public void Insert(string text, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        var previous = ReadClipboard();
        SetClipboard(text);
        Thread.Sleep(ClipboardSettleMs);
        InputBuilder.Send(Plan());
        Thread.Sleep(PasteSettleMs);
        RestoreClipboard(previous, text);
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
