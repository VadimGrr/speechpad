using Speechpad.Agent.Licensing;
using Speechpad.Agent.Licensing.Install;

namespace Speechpad.Agent.Tray;

public static class LicenseInstallerDialog
{
    public static string Title(LicenseInstallResult result)
        => result.Installed
            ? "Speechpad — лицензия установлена"
            : "Speechpad — лицензия не установлена";

    public static string Message(LicenseInstallResult result)
    {
        if (!result.Installed)
        {
            return string.Join(
                Environment.NewLine,
                "Файл не принят.",
                result.Message,
                string.Empty,
                "Программа продолжит работать без изменений.");
        }

        var lines = new List<string> { $"Лицензия для {result.Licensee}", $"Срок: {result.Expires}" };

        if (!string.IsNullOrWhiteSpace(result.Machine))
        {
            lines.Add($"Компьютер: {result.Machine}");
        }

        if (!string.IsNullOrWhiteSpace(result.Features))
        {
            lines.Add($"Возможности: {result.Features}");
        }

        if (!string.IsNullOrWhiteSpace(result.Previous))
        {
            lines.Add(string.Empty);
            lines.Add($"Прежняя лицензия заменена: {result.Previous}");
        }

        return string.Join(Environment.NewLine, lines);
    }

    public static LicenseInstallResult Show(LicenseInstallResult result)
    {
        var message = Message(result);

        if (result.Installed)
        {
            System.Windows.Forms.MessageBox.Show(
                message,
                Title(result),
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Information);
        }
        else
        {
            System.Windows.Forms.MessageBox.Show(
                message,
                Title(result),
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Warning);
        }

        return result;
    }
}
