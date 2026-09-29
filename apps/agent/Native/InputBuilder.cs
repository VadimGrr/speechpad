using System.Runtime.InteropServices;

namespace Speechpad.Agent.Native;

internal static class InputBuilder
{
    public static int Size => Marshal.SizeOf<NativeMethods.Input>();

    public static NativeMethods.Input KeyDown(ushort virtualKey)
        => Build(virtualKey, '\0', 0u);

    public static NativeMethods.Input KeyUp(ushort virtualKey)
        => Build(virtualKey, '\0', NativeMethods.KeyEventKeyUp);

    public static NativeMethods.Input[] VirtualKey(ushort virtualKey, bool keyUp) =>
    [
        keyUp ? KeyUp(virtualKey) : KeyDown(virtualKey),
        keyUp ? KeyDown(virtualKey) : KeyUp(virtualKey),
    ];

    public static NativeMethods.Input[] UnicodeChar(char symbol, bool keyUp) =>
    [
        Build(0, symbol, NativeMethods.KeyEventUnicode | (keyUp ? NativeMethods.KeyEventKeyUp : 0u)),
        Build(0, symbol, NativeMethods.KeyEventUnicode | (keyUp ? 0u : NativeMethods.KeyEventKeyUp)),
    ];

    public static uint Send(IReadOnlyList<NativeMethods.Input> inputs)
    {
        if (inputs.Count == 0)
        {
            return 0;
        }

        var array = inputs as NativeMethods.Input[] ?? [.. inputs];
        return NativeMethods.SendInput((uint)array.Length, array, Size);
    }

    private static NativeMethods.Input Build(ushort virtualKey, char symbol, uint flags) => new()
    {
        Type = NativeMethods.InputKeyboard,
        Data = new NativeMethods.InputUnion
        {
            Keyboard = new NativeMethods.KeyboardInput
            {
                VirtualKey = virtualKey,
                ScanCode = symbol,
                Flags = flags,
                Time = 0,
                ExtraInfo = IntPtr.Zero,
            },
        },
    };
}
