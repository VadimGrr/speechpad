using Speechpad.Agent;
using Speechpad.Agent.Insertion;
using Speechpad.Agent.Native;
using Xunit;

namespace Speechpad.Agent.Tests;

public class InsertionPlanTests
{
    [Fact]
    public void ClipboardPlanHoldsControlWhileVIsPressed()
    {
        var plan = ClipboardPasteScheme.Plan();
        Assert.Equal(4, plan.Length);
        Assert.Equal((ushort)0x11, plan[0].Data.Keyboard.VirtualKey);
        Assert.Equal(0u, plan[0].Data.Keyboard.Flags);
        Assert.Equal((ushort)0x56, plan[1].Data.Keyboard.VirtualKey);
        Assert.Equal(0u, plan[1].Data.Keyboard.Flags);
        Assert.Equal((ushort)0x56, plan[2].Data.Keyboard.VirtualKey);
        Assert.Equal(NativeMethods.KeyEventKeyUp, plan[2].Data.Keyboard.Flags);
        Assert.Equal((ushort)0x11, plan[3].Data.Keyboard.VirtualKey);
        Assert.Equal(NativeMethods.KeyEventKeyUp, plan[3].Data.Keyboard.Flags);
    }

    [Fact]
    public void UnicodePlanEmitsDownAndUpPerSymbol()
    {
        var plan = UnicodeInputScheme.Plan("Aa").ToArray();
        Assert.Equal(2, plan.Length);

        var first = plan[0][0].Data.Keyboard;
        Assert.Equal((ushort)0, first.VirtualKey);
        Assert.Equal('A', first.ScanCode);
        Assert.Equal(NativeMethods.KeyEventUnicode, first.Flags);

        var firstUp = plan[0][1].Data.Keyboard;
        Assert.Equal(NativeMethods.KeyEventUnicode | NativeMethods.KeyEventKeyUp, firstUp.Flags);
        Assert.Equal('A', firstUp.ScanCode);

        Assert.Equal('a', plan[1][0].Data.Keyboard.ScanCode);
    }

    [Fact]
    public void UnicodePlanKeepsCyrillic()
    {
        var plan = UnicodeInputScheme.Plan("й").ToArray();
        Assert.Single(plan);
        Assert.Equal((ushort)0x439, plan[0][0].Data.Keyboard.ScanCode);
    }

    [Fact]
    public void NewlineBecomesReturn()
    {
        var plan = UnicodeInputScheme.Plan("a\nb").ToArray();
        Assert.Equal(3, plan.Length);
        Assert.Equal((ushort)0x0D, plan[1][0].Data.Keyboard.VirtualKey);
        Assert.Equal(NativeMethods.KeyEventKeyUp, plan[1][1].Data.Keyboard.Flags);
    }

    [Fact]
    public void CarriageReturnIsSkipped()
    {
        var plan = UnicodeInputScheme.Plan("\r\n").ToArray();
        Assert.Equal(2, plan.Length);
        Assert.Empty(plan[0]);
        Assert.Equal((ushort)0x0D, plan[1][0].Data.Keyboard.VirtualKey);
    }

    [Fact]
    public void TabBecomesVirtualTab()
    {
        var plan = UnicodeInputScheme.Plan("\t").ToArray();
        Assert.Equal((ushort)0x09, plan[0][0].Data.Keyboard.VirtualKey);
    }

    [Fact]
    public void SurrogatePairIsSentAsTwoUnits()
    {
        var plan = UnicodeInputScheme.Plan("😀").ToArray();
        Assert.Equal(2, plan.Length);
        Assert.Equal((ushort)0xD83D, plan[0][0].Data.Keyboard.ScanCode);
        Assert.Equal((ushort)0xDE00, plan[1][0].Data.Keyboard.ScanCode);
    }

    [Fact]
    public void SchemeNamesMatchTheProtocol()
    {
        Assert.Equal("clipboard", InsertionSchemes.Create(InsertScheme.ClipboardPaste).Name);
        Assert.Equal("unicode", InsertionSchemes.Create(InsertScheme.UnicodeInput).Name);
        Assert.Equal("unicode", InsertionSchemes.Name(InsertScheme.UnicodeInput));
    }

    [Fact]
    public async Task ServiceRejectsEmptyText()
    {
        using var service = new InsertionService(new UnicodeInputScheme());
        var result = await service.InsertAsync("   ");
        Assert.False(result.Ok);
        Assert.Equal("unicode", result.Scheme);
    }

    [Fact]
    public async Task ServiceInsertsInOrder()
    {
        var order = new List<string>();
        using var service = new InsertionService(new RecordingScheme(order));
        var first = service.InsertAsync("один");
        var second = service.InsertAsync("два");
        await Task.WhenAll(first, second);

        Assert.True((await first).Ok);
        Assert.True((await second).Ok);
        Assert.Equal(["один", "два"], order);
    }

    private sealed class RecordingScheme(List<string> order) : IInsertionScheme
    {
        public string Name => "recording";

        public void Insert(string text, CancellationToken cancellationToken) => order.Add(text);
    }
}
