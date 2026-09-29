using System.Text.Json;
using Speechpad.Agent;
using Xunit;

namespace Speechpad.Agent.Tests;

public class OptionsTests
{
    [Fact]
    public void DefaultsAreValid()
    {
        var options = new AgentOptions();
        Assert.Empty(options.Validate());
        Assert.Equal(8787, options.Port);
        Assert.Equal(InsertScheme.ClipboardPaste, options.InsertScheme);
    }

    [Theory]
    [InlineData(80)]
    [InlineData(70000)]
    [InlineData(0)]
    public void RejectsBadPorts(int port)
    {
        var options = new AgentOptions { Port = port };
        Assert.Contains(options.Validate(), p => p.Contains("порт"));
    }

    [Fact]
    public void RejectsBadHotkeys()
    {
        var options = new AgentOptions { ToggleHotkey = "Ctrl+Что" };
        Assert.Contains(options.Validate(), p => p.Contains("ToggleHotkey"));
    }

    [Fact]
    public void SavesAndLoadsRoundTrip()
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-{Guid.NewGuid():N}.json");
        try
        {
            var options = new AgentOptions
            {
                Port = 9100,
                InsertScheme = InsertScheme.UnicodeInput,
                ToggleHotkey = "Ctrl+Alt+M",
                TopmostHotkey = "Ctrl+Alt+N",
                ClearHotkey = "Ctrl+Alt+B",
                WebRoot = @"C:\apps\web\dist",
                TrayIcon = false,
            };

            OptionsStore.Save(path, options);
            var loaded = OptionsStore.Load(path);

            Assert.Equal(9100, loaded.Port);
            Assert.Equal(InsertScheme.UnicodeInput, loaded.InsertScheme);
            Assert.Equal("Ctrl+Alt+M", loaded.ToggleHotkey);
            Assert.False(loaded.TrayIcon);
            Assert.Equal(@"C:\apps\web\dist", loaded.WebRoot);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ReadsHandWrittenSettingsFile()
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-{Guid.NewGuid():N}.json");
        File.WriteAllText(
            path,
            """
            {
              "port": 8899,
              "webRoot": "C:\\apps\\web\\dist",
              "insertScheme": "UnicodeInput",
              "toggleHotkey": "Ctrl+Alt+P",
              "topmostHotkey": "Ctrl+Alt+O",
              "clearHotkey": "Ctrl+Alt+I",
              "trayIcon": false,
              "verbose": true
            }
            """);
        try
        {
            var loaded = OptionsStore.Load(path);

            Assert.Equal(8899, loaded.Port);
            Assert.Equal(@"C:\apps\web\dist", loaded.WebRoot);
            Assert.Equal(InsertScheme.UnicodeInput, loaded.InsertScheme);
            Assert.Equal("Ctrl+Alt+P", loaded.ToggleHotkey);
            Assert.Equal("Ctrl+Alt+O", loaded.TopmostHotkey);
            Assert.Equal("Ctrl+Alt+I", loaded.ClearHotkey);
            Assert.False(loaded.TrayIcon);
            Assert.True(loaded.Verbose);
            Assert.Empty(loaded.Validate());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void PartialSettingsFileKeepsDefaultsForMissingFields()
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, """{ "port": 8899 }""");
        try
        {
            var loaded = OptionsStore.Load(path);

            Assert.Equal(8899, loaded.Port);
            Assert.Equal(InsertScheme.ClipboardPaste, loaded.InsertScheme);
            Assert.Equal("Ctrl+Alt+Space", loaded.ToggleHotkey);
            Assert.Equal(8787, new AgentOptions().Port);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Theory]
    [InlineData("""{ "port": 8899, "insertScheme": "unicode" }""")]
    [InlineData("""{ "port": 8899, "toggleHotkey": 5 }""")]
    [InlineData("[]")]
    public void BadValueDiscardsWholeFile(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, json);
        try
        {
            var loaded = OptionsStore.Load(path);
            Assert.Equal(8787, loaded.Port);
            Assert.Equal(InsertScheme.ClipboardPaste, loaded.InsertScheme);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void FallsBackToDefaultsOnBrokenFile()
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, "{ not json");
        try
        {
            var loaded = OptionsStore.Load(path);
            Assert.Equal(8787, loaded.Port);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void MissingFileGivesDefaults()
    {
        var loaded = OptionsStore.Load(Path.Combine(Path.GetTempPath(), $"nope-{Guid.NewGuid():N}.json"));
        Assert.Equal(8787, loaded.Port);
        Assert.Equal("Ctrl+Alt+Space", loaded.ToggleHotkey);
    }

    [Fact]
    public void WritesEnumAsName()
    {
        var path = Path.Combine(Path.GetTempPath(), $"speechpad-{Guid.NewGuid():N}.json");
        try
        {
            OptionsStore.Save(path, new AgentOptions { InsertScheme = InsertScheme.UnicodeInput });
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            Assert.Equal("UnicodeInput", document.RootElement.GetProperty("insertScheme").GetString());
        }
        finally
        {
            File.Delete(path);
        }
    }
}
