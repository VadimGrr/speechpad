using System.Reflection;
using System.Runtime.InteropServices;
using Speechpad.Agent.Native;
using Xunit;

namespace Speechpad.Agent.Tests;

public sealed class InteropSignatureTests
{
    private static MethodInfo Method(string name) =>
        typeof(NativeMethods).GetMethod(name, BindingFlags.Public | BindingFlags.Static)
        ?? throw new InvalidOperationException($"NativeMethods.{name} not found");

    [Fact]
    public void SendInputReturnsUnsignedIntWithoutBooleanMarshalling()
    {
        var method = Method("SendInput");
        Assert.Equal(typeof(uint), method.ReturnType);

        var returnDirective = method.ReturnParameter.GetCustomAttribute<MarshalAsAttribute>();
        Assert.True(
            returnDirective is null || returnDirective.Value is UnmanagedType.U4 or UnmanagedType.Error,
            "SendInput returns UINT, so the return value must not be marshalled as a 1-byte boolean");

        var parameters = method.GetParameters();
        Assert.Equal(typeof(uint), parameters[0].ParameterType);
        Assert.Equal(typeof(NativeMethods.Input[]), parameters[1].ParameterType);
        Assert.Equal(typeof(int), parameters[2].ParameterType);
    }

    [Fact]
    public void BooleanReturningUser32CallsUseFourByteMarshalling()
    {
        string[] names =
        [
            "RegisterHotKey",
            "UnregisterHotKey",
            "SetWindowPos",
            "SetForegroundWindow",
            "IsWindowVisible",
            "EnumWindows",
        ];

        foreach (var name in names)
        {
            var method = Method(name);
            Assert.Equal(typeof(bool), method.ReturnType);
            var directive = method.ReturnParameter.GetCustomAttribute<MarshalAsAttribute>();
            Assert.True(
                directive is null || directive.Value is UnmanagedType.Bool or UnmanagedType.I4,
                $"{name} returns BOOL and must not be marshalled as a one-byte value");
        }
    }

    [Fact]
    public void InputStructsMatchTheWindowsLayout()
    {
        var pointerSize = IntPtr.Size;
        Assert.Equal(pointerSize == 8 ? 24 : 16, Marshal.SizeOf<NativeMethods.KeyboardInput>());
        Assert.Equal(pointerSize == 8 ? 32 : 24, Marshal.SizeOf<NativeMethods.MouseInput>());
        Assert.Equal(8, Marshal.SizeOf<NativeMethods.HardwareInput>());
        Assert.Equal(pointerSize == 8 ? 40 : 28, Marshal.SizeOf<NativeMethods.Input>());
        Assert.Equal(pointerSize == 8 ? 40 : 28, InputBuilder.Size);
    }

    [Fact]
    public void BuiltInputsCarryKeyboardFlagsAndScanCodes()
    {
        var down = InputBuilder.KeyDown(0x41);
        Assert.Equal(NativeMethods.InputKeyboard, down.Type);
        Assert.Equal((ushort)0x41, down.Data.Keyboard.VirtualKey);
        Assert.Equal(0u, down.Data.Keyboard.Flags);
        Assert.Equal((ushort)NativeMethods.KeyEventKeyUp, InputBuilder.KeyUp(0x41).Data.Keyboard.Flags);

        var unicodeDown = InputBuilder.UnicodeChar('я', keyUp: false);
        Assert.Equal((ushort)'я', unicodeDown[0].Data.Keyboard.ScanCode);
        Assert.Equal(NativeMethods.KeyEventUnicode, unicodeDown[0].Data.Keyboard.Flags);
        Assert.Equal(0u, unicodeDown[0].Data.Keyboard.VirtualKey);
        Assert.Equal(
            NativeMethods.KeyEventUnicode | NativeMethods.KeyEventKeyUp,
            unicodeDown[1].Data.Keyboard.Flags);
    }
}
