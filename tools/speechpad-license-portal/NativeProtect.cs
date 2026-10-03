using System.Security.AccessControl;
using System.Security.Principal;

namespace Speechpad.LicensePortal;

internal static class NativeProtect
{
    public static void HideFromOtherUsers(string file)
    {
        if (!OperatingSystem.IsWindows() || !File.Exists(file))
        {
            return;
        }

        try
        {
            var info = new FileInfo(file);
            var acl = FileSystemAclExtensions.GetAccessControl(info);
            acl.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

            var rules = acl.GetAccessRules(
                includeExplicit: true,
                includeInherited: true,
                targetType: typeof(SecurityIdentifier));

            foreach (FileSystemAccessRule rule in rules.Cast<FileSystemAccessRule>())
            {
                acl.RemoveAccessRule(rule);
            }

            var owner = WindowsIdentity.GetCurrent().User
                ?? throw new InvalidOperationException("не удалось определить текущего пользователя");
            acl.AddAccessRule(new FileSystemAccessRule(
                owner,
                FileSystemRights.FullControl,
                AccessControlType.Allow));

            FileSystemAclExtensions.SetAccessControl(info, acl);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException or System.Security.SecurityException)
        {
            throw new IOException($"не удалось закрыть доступ к файлу {file}", ex);
        }
    }
}
