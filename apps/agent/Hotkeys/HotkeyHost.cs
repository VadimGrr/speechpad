using Speechpad.Agent.Native;

namespace Speechpad.Agent.Hotkeys;

public sealed class HotkeyHost : Form
{
    private const int WmHotkey = 0x0312;
    private readonly Dictionary<int, string> actions = new();
    private int nextId = (int)NativeMethods.HotkeyIdBase;

    public HotkeyHost()
    {
        Text = "Speechpad hotkeys";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        Opacity = 0;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-32000, -32000);
        Size = new Size(1, 1);
    }

    public event Action<string>? Pressed;

    public bool Register(string action, string combination)
    {
        if (!Hotkey.TryParse(combination, out var hotkey))
        {
            return false;
        }

        var id = nextId++;
        var modifiers = (uint)(int)hotkey.Modifiers | Hotkey.NoRepeat;
        if (!NativeMethods.RegisterHotKey(Handle, id, modifiers, hotkey.VirtualKey))
        {
            return false;
        }

        actions[id] = action;
        return true;
    }

    public void UnregisterAll()
    {
        foreach (var id in actions.Keys)
        {
            NativeMethods.UnregisterHotKey(Handle, id);
        }

        actions.Clear();
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmHotkey
            && actions.TryGetValue(message.WParam.ToInt32(), out var action))
        {
            Pressed?.Invoke(action);
        }

        base.WndProc(ref message);
    }
}
