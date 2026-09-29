using System.Text;

namespace Speechpad.Agent;

[Flags]
public enum HotkeyModifiers
{
    None = 0,
    Alt = 1,
    Control = 2,
    Shift = 4,
    Win = 8,
}

public readonly record struct Hotkey(HotkeyModifiers Modifiers, uint VirtualKey, string Text)
{
    public const uint NoRepeat = 0x4000;

    private static readonly Dictionary<string, uint> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["space"] = 0x20,
        ["enter"] = 0x0D,
        ["return"] = 0x0D,
        ["tab"] = 0x09,
        ["esc"] = 0x1B,
        ["escape"] = 0x1B,
        ["backspace"] = 0x08,
        ["delete"] = 0x2E,
        ["insert"] = 0x2D,
        ["home"] = 0x24,
        ["end"] = 0x23,
        ["pageup"] = 0x21,
        ["pagedown"] = 0x22,
        ["up"] = 0x26,
        ["down"] = 0x28,
        ["left"] = 0x25,
        ["right"] = 0x27,
        ["pause"] = 0x13,
        ["printscreen"] = 0x2C,
    };

    public static bool TryParse(string? text, out Hotkey hotkey)
    {
        hotkey = default;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var modifiers = HotkeyModifiers.None;
        uint key = 0;
        var keyName = string.Empty;

        foreach (var rawPart in text.Split('+', StringSplitOptions.RemoveEmptyEntries))
        {
            var part = rawPart.Trim();
            if (part.Length == 0)
            {
                continue;
            }

            switch (part.ToLowerInvariant())
            {
                case "ctrl":
                case "control":
                    modifiers |= HotkeyModifiers.Control;
                    continue;
                case "alt":
                    modifiers |= HotkeyModifiers.Alt;
                    continue;
                case "shift":
                    modifiers |= HotkeyModifiers.Shift;
                    continue;
                case "win":
                case "meta":
                    modifiers |= HotkeyModifiers.Win;
                    continue;
                default:
                    keyName = part;
                    continue;
            }
        }

        if (keyName.Length == 0)
        {
            return false;
        }

        if (Named.TryGetValue(keyName, out key))
        {
            // ok
        }
        else if (keyName.Length == 1 && char.IsAsciiLetterOrDigit(keyName[0]))
        {
            key = char.ToUpperInvariant(keyName[0]);
        }
        else if (keyName.Length is > 1 and <= 3
                 && char.ToUpperInvariant(keyName[0]) == 'F'
                 && int.TryParse(keyName[1..], out var fn)
                 && fn is >= 1 and <= 24)
        {
            key = (uint)(0x70 + fn - 1);
        }
        else
        {
            return false;
        }

        hotkey = new Hotkey(modifiers, key, Normalize(modifiers, key));
        return true;
    }

    public static string Normalize(HotkeyModifiers modifiers, uint key)
    {
        var parts = new List<string>(4);
        if (modifiers.HasFlag(HotkeyModifiers.Control))
        {
            parts.Add("Ctrl");
        }

        if (modifiers.HasFlag(HotkeyModifiers.Alt))
        {
            parts.Add("Alt");
        }

        if (modifiers.HasFlag(HotkeyModifiers.Shift))
        {
            parts.Add("Shift");
        }

        if (modifiers.HasFlag(HotkeyModifiers.Win))
        {
            parts.Add("Win");
        }

        parts.Add(KeyName(key));
        return string.Join('+', parts);
    }

    public static string KeyName(uint key)
    {
        foreach (var (name, value) in Named)
        {
            if (value == key)
            {
                return char.ToUpperInvariant(name[0]) + name[1..];
            }
        }

        if (key is >= 0x70 and <= 0x87)
        {
            return $"F{key - 0x70 + 1}";
        }

        if (key is >= 0x30 and <= 0x39 or >= 0x41 and <= 0x5A)
        {
            return ((char)key).ToString();
        }

        return $"0x{key:X2}";
    }

    public override string ToString()
    {
        var builder = new StringBuilder();
        if (Modifiers.HasFlag(HotkeyModifiers.Control))
        {
            builder.Append("Ctrl+");
        }

        if (Modifiers.HasFlag(HotkeyModifiers.Alt))
        {
            builder.Append("Alt+");
        }

        if (Modifiers.HasFlag(HotkeyModifiers.Shift))
        {
            builder.Append("Shift+");
        }

        return builder.Append(KeyName(VirtualKey)).ToString();
    }
}
