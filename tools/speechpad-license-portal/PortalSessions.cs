using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Speechpad.LicensePortal;

internal sealed class PortalSession
{
    public required string Token { get; init; }

    public required string Csrf { get; init; }

    public required DateTimeOffset Expires { get; init; }

    public bool Expired(DateTimeOffset now) => now >= Expires;
}

internal sealed class LoginThrottle
{
    private const int MaxAttempts = 5;

    private static readonly TimeSpan BaseDelay = TimeSpan.FromSeconds(2);

    private readonly object gate = new();
    private readonly Dictionary<string, Attempt> attempts = new(StringComparer.OrdinalIgnoreCase);

    private sealed class Attempt
    {
        public int Failures { get; set; }

        public DateTimeOffset BlockedUntil { get; set; }

        public DateTimeOffset LastSeen { get; set; }
    }

    public TimeSpan CheckDelay(string login, DateTimeOffset now)
    {
        lock (gate)
        {
            Purge(now);
            if (!attempts.TryGetValue(login, out var attempt) || attempt.BlockedUntil <= now)
            {
                return TimeSpan.Zero;
            }

            return attempt.BlockedUntil - now;
        }
    }

    public bool RecordSuccess(string login)
    {
        lock (gate)
        {
            attempts.Remove(login);
        }

        return true;
    }

    public TimeSpan RecordFailure(string login, DateTimeOffset now)
    {
        lock (gate)
        {
            Purge(now);
            var attempt = attempts.TryGetValue(login, out var known)
                ? known
                : new Attempt();
            attempts[login] = attempt;
            attempt.Failures++;
            attempt.LastSeen = now;

            if (attempt.Failures < MaxAttempts)
            {
                return TimeSpan.Zero;
            }

            var over = attempt.Failures - MaxAttempts;
            var delayTicks = Math.Min(BaseDelay.Ticks * Math.Pow(2, Math.Min(over, 8)), TimeSpan.FromMinutes(15).Ticks);
            attempt.BlockedUntil = now + TimeSpan.FromTicks((long)delayTicks);
            return TimeSpan.FromTicks((long)delayTicks);
        }
    }

    private void Purge(DateTimeOffset now)
    {
        foreach (var key in attempts
                     .Where(pair => now - pair.Value.LastSeen > TimeSpan.FromHours(1))
                     .Select(pair => pair.Key)
                     .ToList())
        {
            attempts.Remove(key);
        }
    }
}

internal sealed class SessionStore
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(2);

    private readonly ConcurrentDictionary<string, PortalSession> sessions = new(StringComparer.Ordinal);

    public PortalSession Create(DateTimeOffset now)
    {
        Prune(now);
        var session = new PortalSession
        {
            Token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)),
            Csrf = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)),
            Expires = now + Lifetime,
        };
        sessions[session.Token] = session;
        return session;
    }

    public PortalSession? Find(string? token, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(token))
        {
            return null;
        }

        if (!sessions.TryGetValue(token, out var session))
        {
            return null;
        }

        if (session.Expired(now))
        {
            sessions.TryRemove(token, out _);
            return null;
        }

        return session;
    }

    public void Drop(string? token)
    {
        if (!string.IsNullOrEmpty(token))
        {
            sessions.TryRemove(token, out _);
        }
    }

    private void Prune(DateTimeOffset now)
    {
        foreach (var token in sessions
                     .Where(pair => pair.Value.Expired(now))
                     .Select(pair => pair.Key)
                     .ToList())
        {
            sessions.TryRemove(token, out _);
        }
    }
}
