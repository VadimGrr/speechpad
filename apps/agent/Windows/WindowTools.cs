using System.Runtime.InteropServices;
using Speechpad.Agent.Native;

namespace Speechpad.Agent.Windows;

public sealed record WindowInfo(string Title, uint ProcessId, IntPtr Handle);

public static class WindowTools
{
    private const int GwlExStyle = -20;
    private const int WsExTopmost = 0x00000008;
    private const uint SwpNoActivate = 0x0010;

    public static IntPtr Find(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return IntPtr.Zero;
        }

        return NativeMethods.FindWindow(null, title);
    }

    public static bool Exists(string? title) => Find(title) != IntPtr.Zero;

    public static bool IsTopmost(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero)
        {
            return false;
        }

        return (GetWindowLongPtr(hWnd, GwlExStyle).ToInt64() & WsExTopmost) == WsExTopmost;
    }

    public static bool SetTopmost(IntPtr hWnd, bool topmost)
    {
        if (hWnd == IntPtr.Zero)
        {
            return false;
        }

        var flags = (uint)((long)NativeMethods.HwndNoMove | (long)NativeMethods.HwndNoSize | SwpNoActivate);
        return NativeMethods.SetWindowPos(
            hWnd,
            topmost ? NativeMethods.HwndTopmost : IntPtr.Zero,
            0,
            0,
            0,
            0,
            flags);
    }

    public static bool Focus(IntPtr hWnd)
        => hWnd != IntPtr.Zero && NativeMethods.SetForegroundWindow(hWnd);

    public static bool ToggleTopmost(string? title)
    {
        var hWnd = Find(title);
        return hWnd != IntPtr.Zero && SetTopmost(hWnd, !IsTopmost(hWnd));
    }

    public static bool FocusByTitle(string? title) => Focus(Find(title));

    public static List<WindowInfo> ListVisible(int limit = 300)
    {
        var found = new List<WindowInfo>();
        NativeMethods.EnumWindows((hWnd, _) =>
        {
            if (!NativeMethods.IsWindowVisible(hWnd))
            {
                return true;
            }

            var title = NativeMethods.GetWindowTitle(hWnd);
            if (title.Length == 0)
            {
                return true;
            }

            NativeMethods.GetWindowThreadProcessId(hWnd, out var processId);
            found.Add(new WindowInfo(title, processId, hWnd));
            return found.Count < limit;
        }, IntPtr.Zero);

        return found;
    }

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
}
