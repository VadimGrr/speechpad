using Speechpad.Agent;
using Speechpad.Agent.Insertion;
using Xunit;

namespace Speechpad.Agent.Tests;

public class ServerTests
{
    [Fact]
    public void FindsRepoWebRootByWalkingUp()
    {
        var root = Path.Combine(Path.GetTempPath(), $"speechpad-tree-{Guid.NewGuid():N}");
        var deep = Path.Combine(root, "apps", "agent", "bin", "Debug", "net10.0-windows");
        var dist = Path.Combine(root, "apps", "web", "dist");
        Directory.CreateDirectory(deep);
        Directory.CreateDirectory(dist);
        File.WriteAllText(Path.Combine(dist, "index.html"), "<html></html>");
        File.WriteAllText(Path.Combine(dist, "float.html"), "<html></html>");
        try
        {
            var resolved = AgentServer.ResolveWebRoot(null, deep);
            Assert.Equal(Path.GetFullPath(dist), resolved);
            Assert.True(File.Exists(Path.Combine(resolved, "float.html")));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void PrefersNestedWebFolderNextToTheBinary()
    {
        var root = Path.Combine(Path.GetTempPath(), $"speechpad-tree-{Guid.NewGuid():N}");
        var bin = Path.Combine(root, "publish");
        var web = Path.Combine(bin, "web");
        Directory.CreateDirectory(web);
        File.WriteAllText(Path.Combine(web, "index.html"), "<html></html>");
        try
        {
            Assert.Equal(Path.GetFullPath(web), AgentServer.ResolveWebRoot(null, bin));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void IgnoresTheWebSourcesInFavourOfTheBuild()
    {
        var root = Path.Combine(Path.GetTempPath(), $"speechpad-tree-{Guid.NewGuid():N}");
        var bin = Path.Combine(root, "apps", "agent", "bin", "Debug", "net10.0-windows");
        var source = Path.Combine(root, "apps", "web");
        var dist = Path.Combine(source, "dist");
        Directory.CreateDirectory(bin);
        Directory.CreateDirectory(Path.Combine(source, "src"));
        File.WriteAllText(Path.Combine(source, "package.json"), "{}");
        File.WriteAllText(Path.Combine(source, "index.html"), "<script src=\"/src/main.ts\"></script>");
        Directory.CreateDirectory(dist);
        File.WriteAllText(Path.Combine(dist, "index.html"), "<html></html>");
        try
        {
            Assert.Equal(Path.GetFullPath(dist), AgentServer.ResolveWebRoot(null, bin));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void ExplicitWebRootWins()
    {
        var temp = Path.Combine(Path.GetTempPath(), $"speechpad-web-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temp);
        File.WriteAllText(Path.Combine(temp, "index.html"), "<html></html>");
        try
        {
            Assert.Equal(temp, AgentServer.ResolveWebRoot(temp));
        }
        finally
        {
            Directory.Delete(temp, recursive: true);
        }
    }

    [Fact]
    public void MissingWebRootFallsBackToFirstCandidate()
    {
        var missing = Path.Combine(Path.GetTempPath(), $"missing-{Guid.NewGuid():N}");
        var root = AgentServer.ResolveWebRoot(missing);
        Assert.NotEmpty(root);
    }

    [Fact]
    public async Task AllowsLoopbackAndDevOriginsOnly()
    {
        await using var server = CreateServer(8787);

        Assert.True(server.IsOriginAllowed(null));
        Assert.True(server.IsOriginAllowed("http://127.0.0.1:8787"));
        Assert.True(server.IsOriginAllowed("http://localhost:8787/"));
        Assert.True(server.IsOriginAllowed("http://127.0.0.1:5173"));
        Assert.True(server.IsOriginAllowed("http://localhost:5173"));
        Assert.False(server.IsOriginAllowed("https://speechpad.example.com"));
        Assert.False(server.IsOriginAllowed("http://127.0.0.1:9999"));
        Assert.False(server.IsOriginAllowed("null"));
    }

    [Fact]
    public async Task GeneratesADistinctToken()
    {
        await using var first = CreateServer(8787);
        await using var second = CreateServer(8787);
        Assert.NotEqual(first.Token, second.Token);
        Assert.Equal(48, first.Token.Length);
        Assert.Matches("^[0-9A-F]+$", first.Token);
    }

    private static AgentServer CreateServer(int port)
        => new(
            new AgentOptions { Port = port },
            new AgentLog(null, verbose: false),
            new NullInsertion(),
            new NullActions());

    private sealed class NullInsertion : IInsertionQueue
    {
        public string SchemeName => "clipboard";

        public Task<InsertResult> InsertAsync(string text, CancellationToken cancellationToken = default)
            => Task.FromResult(new InsertResult(true, "clipboard"));
    }

    private sealed class NullActions : IAgentActions
    {
        public void BroadcastHotkey(string action)
        {
        }

        public void ToggleTopmostCompact()
        {
        }

        public void ToggleTopmostMain()
        {
        }

        public void FocusMainWindow()
        {
        }

        public void ShowBalloon(string title, string text)
        {
        }

        public void Quit()
        {
        }
    }
}
