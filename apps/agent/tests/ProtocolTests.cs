using System.Text.Json;
using Speechpad.Agent;
using Xunit;

namespace Speechpad.Agent.Tests;

public class ProtocolTests
{
    [Fact]
    public void WritesReadyWithCamelCase()
    {
        var json = Protocol.Write(new ReadyMessage
        {
            InsertScheme = "clipboard",
            ProcessId = 42,
            Port = 8787,
        });

        Assert.Contains("\"type\":\"ready\"", json);
        Assert.Contains("\"insertScheme\":\"clipboard\"", json);
        Assert.Contains("\"processId\":42", json);
        Assert.Contains("\"port\":8787", json);
        Assert.Contains("\"version\":1", json);
    }

    [Fact]
    public void WritesHotkeyAction()
    {
        var json = Protocol.Write(new HotkeyMessage { Action = "toggle" });
        Assert.Equal("toggle", JsonDocument.Parse(json).RootElement.GetProperty("action").GetString());
    }

    [Fact]
    public void RecognisesHello()
    {
        Assert.True(ClientMessages.IsHello("{\"type\":\"hello\",\"version\":1}", out var version));
        Assert.Equal(1, version);
        Assert.True(ClientMessages.IsHello("{ \"type\" : \"hello\" }", out var missing));
        Assert.Equal(0, missing);
    }

    [Fact]
    public void RecognisesInsertWithText()
    {
        Assert.True(ClientMessages.IsInsert("{\"type\":\"insert\",\"text\":\"привет\",\"seq\":7}", out var text, out var seq));
        Assert.Equal("привет", text);
        Assert.Equal(7, seq);
    }

    [Theory]
    [InlineData("{\"type\":\"insert\"}")]
    [InlineData("{\"type\":\"insert\",\"text\":\"   \"}")]
    [InlineData("{\"type\":\"final\",\"text\":\"привет\"}")]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("{ broken")]
    public void RejectsBadInserts(string json)
    {
        Assert.False(ClientMessages.IsInsert(json, out _, out _));
    }

    [Fact]
    public void RejectsOversizedPayloads()
    {
        var huge = "{\"type\":\"insert\",\"text\":\"" + new string('a', 70_000) + "\"}";
        Assert.False(ClientMessages.IsInsert(huge, out _, out _));
    }

    [Fact]
    public void NormalisesCommands()
    {
        Assert.True(ClientMessages.IsCommand("{\"type\":\"command\",\"name\":\"TopMost\"}", out var command));
        Assert.Equal("topmost", command);
        Assert.False(ClientMessages.IsCommand("{\"type\":\"command\"}", out _));
    }

    [Fact]
    public void SerialisesTokenResponse()
    {
        var json = Protocol.WriteJson(new TokenResponse
        {
            Token = "ABC",
            Port = 9000,
            InsertScheme = "unicode",
        });

        var root = JsonDocument.Parse(json).RootElement;
        Assert.Equal("ABC", root.GetProperty("token").GetString());
        Assert.Equal(9000, root.GetProperty("port").GetInt32());
        Assert.Equal("unicode", root.GetProperty("insertScheme").GetString());
    }
}
