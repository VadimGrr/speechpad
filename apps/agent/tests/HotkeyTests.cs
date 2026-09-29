using Speechpad.Agent;
using Xunit;

namespace Speechpad.Agent.Tests;

public class HotkeyTests
{
    [Theory]
    [InlineData("Ctrl+Alt+Space", HotkeyModifiers.Control | HotkeyModifiers.Alt, 0x20u)]
    [InlineData("ctrl+alt+t", HotkeyModifiers.Control | HotkeyModifiers.Alt, (uint)'T')]
    [InlineData("Ctrl+Shift+F5", HotkeyModifiers.Control | HotkeyModifiers.Shift, 0x74u)]
    [InlineData("Alt+7", HotkeyModifiers.Alt, (uint)'7')]
    [InlineData("Win+Esc", HotkeyModifiers.Win, 0x1Bu)]
    public void ParsesKnownCombinations(string text, HotkeyModifiers modifiers, uint key)
    {
        Assert.True(Hotkey.TryParse(text, out var hotkey));
        Assert.Equal(modifiers, hotkey.Modifiers);
        Assert.Equal(key, hotkey.VirtualKey);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("Ctrl+Alt")]
    [InlineData("Ctrl+Alt+НетТакой")]
    [InlineData("Ctrl+Alt+F25")]
    [InlineData("Ctrl+Alt+AB")]
    public void RejectsGarbage(string? text)
    {
        Assert.False(Hotkey.TryParse(text, out _));
    }

    [Fact]
    public void NormalizesToCamelCase()
    {
        Assert.True(Hotkey.TryParse("ctrl + alt + f5", out var hotkey));
        Assert.Equal("Ctrl+Alt+F5", hotkey.Text);
        Assert.Equal("Ctrl+Alt+F5", hotkey.ToString());
    }

    [Fact]
    public void RoundTripsThroughText()
    {
        Assert.True(Hotkey.TryParse("Ctrl+Alt+D", out var first));
        Assert.True(Hotkey.TryParse(first.Text, out var second));
        Assert.Equal(first, second);
    }

    [Fact]
    public void FormatsFromRawValues()
    {
        Assert.Equal("Ctrl+Shift+Enter", Hotkey.Normalize(
            HotkeyModifiers.Control | HotkeyModifiers.Shift,
            0x0D));
        Assert.Equal("Space", Hotkey.KeyName(0x20));
    }
}
