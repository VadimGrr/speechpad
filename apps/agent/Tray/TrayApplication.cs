using System.Diagnostics;
using Speechpad.Agent.Hotkeys;
using Speechpad.Agent.Insertion;
using Speechpad.Agent.Startup;
using Speechpad.Agent.Windows;

namespace Speechpad.Agent.Tray;

public sealed class TrayApplication : ApplicationContext, IAgentActions
{
    private readonly AgentOptions options;
    private readonly AgentLog log;
    private readonly IInsertionQueue insertion;
    private readonly HotkeyHost host = new();
    private readonly List<string> hotkeyFailures = new();
    private AgentServer? server;
    private NotifyIcon? tray;

    public TrayApplication(AgentOptions options, AgentLog log, IInsertionQueue insertion)
    {
        this.options = options;
        this.log = log;
        this.insertion = insertion;
    }

    public void Run()
    {
        server = new AgentServer(options, log, insertion, this);
        server.Start();

        host.Pressed += OnHotkey;
        Register("toggle", options.ToggleHotkey, "пауза/продолжить");
        Register("topmost", options.TopmostHotkey, "поверх всех окон");
        Register("clear", options.ClearHotkey, "очистить стенограмму");

        if (options.TrayIcon)
        {
            ShowTray();
        }

        log.Info($"agent ready: toggle {options.ToggleHotkey}, topmost {options.TopmostHotkey}, clear {options.ClearHotkey}");
        foreach (var failure in hotkeyFailures)
        {
            log.Warn(failure);
        }

        if (hotkeyFailures.Count == 0 && !options.TrayIcon)
        {
            log.Warn("нет трея: остановить агент можно через Ctrl+C или диспетчер задач");
        }

        Application.Run(this);
    }

    public void BroadcastHotkey(string action) => server?.BroadcastHotkey(action);

    public void ToggleTopmostCompact() => ToggleTopmost(options.CompactWindowTitle);

    public void ToggleTopmostMain() => ToggleTopmost(options.MainWindowTitle);

    public void FocusMainWindow()
    {
        if (!WindowTools.FocusByTitle(options.MainWindowTitle))
        {
            log.Warn($"главное окно «{options.MainWindowTitle}» не найдено");
            ShowBalloon("Speechpad", "Главное окно не найдено: откройте http://127.0.0.1:" + options.Port);
        }
    }

    public void ShowBalloon(string title, string text)
    {
        tray?.ShowBalloonTip(5000, title, text, ToolTipIcon.Info);
    }

    public void Quit()
    {
        log.Info("shutting down");
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            host.UnregisterAll();
            if (tray is not null)
            {
                tray.Visible = false;
                tray.Dispose();
                tray = null;
            }

            host.Dispose();
            server?.DisposeAsync().AsTask().GetAwaiter().GetResult();
            server = null;
        }

        base.Dispose(disposing);
    }

    private void Register(string action, string combination, string description)
    {
        if (!Hotkey.TryParse(combination, out var hotkey))
        {
            hotkeyFailures.Add($"горячая клавиша {action} «{combination}» не разобрана");
            return;
        }

        if (host.Register(action, combination))
        {
            log.Info($"hotkey {action} ({description}) = {hotkey}");
            return;
        }

        hotkeyFailures.Add($"горячая клавиша {action} «{combination}» занята другим приложением");
    }

    private void OnHotkey(string action)
    {
        log.Debug($"hotkey {action}");
        switch (action)
        {
            case "toggle":
                BroadcastHotkey(HotkeyActions.Toggle);
                break;
            case "topmost":
                ToggleTopmostCompact();
                BroadcastHotkey(HotkeyActions.Topmost);
                break;
            case "clear":
                BroadcastHotkey(HotkeyActions.Clear);
                break;
        }
    }

    private void ToggleTopmost(string title)
    {
        if (WindowTools.ToggleTopmost(title))
        {
            var state = WindowTools.IsTopmost(WindowTools.Find(title)) ? "поверх" : "обычное";
            log.Info($"окно «{title}»: {state}");
            return;
        }

        log.Warn($"окно «{title}» не найдено");
        ShowBalloon("Speechpad", $"Окно «{title}» не найдено. Проверьте заголовок в settings.json.");
    }

    private void ShowTray()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Открыть главное окно", null, (_, _) => FocusMainWindow());
        menu.Items.Add("Компактное окно поверх", null, (_, _) => ToggleTopmostCompact());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(
            AutoStart.IsEnabled() ? "Выключить автозапуск" : "Включить автозапуск",
            null,
            (_, _) => ToggleAutostart());
        menu.Items.Add("Журнал", null, (_, _) => OpenLog());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Выход", null, (_, _) => Quit());

        tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = $"Speechpad: 127.0.0.1:{options.Port}",
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (_, _) => FocusMainWindow();
    }

    private void ToggleAutostart()
    {
        if (AutoStart.IsEnabled())
        {
            AutoStart.Disable();
            ShowBalloon("Speechpad", "Автозапуск выключен");
        }
        else
        {
            AutoStart.Enable();
            ShowBalloon("Speechpad", "Автозапуск включён");
        }
    }

    private void OpenLog()
    {
        var path = AgentLog.DefaultPath;
        if (!File.Exists(path))
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or IOException)
        {
            log.Warn($"не удалось открыть журнал: {ex.Message}");
        }
    }
}
