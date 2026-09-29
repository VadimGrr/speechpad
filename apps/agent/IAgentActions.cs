namespace Speechpad.Agent;

public interface IAgentActions
{
    void BroadcastHotkey(string action);

    void ToggleTopmostCompact();

    void ToggleTopmostMain();

    void FocusMainWindow();

    void ShowBalloon(string title, string text);

    void Quit();
}
