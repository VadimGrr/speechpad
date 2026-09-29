namespace Speechpad.Agent.Insertion;

public interface IInsertionScheme
{
    string Name { get; }

    void Insert(string text, CancellationToken cancellationToken);
}
