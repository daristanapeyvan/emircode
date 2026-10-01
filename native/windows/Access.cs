// Access.cs - access rules and integrity labels on folders.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

internal static partial class EmirSandbox
{
    private const int FileReadAttributes = 0x80;
    private const int Synchronize = 0x100000;
    private const uint DaclInformation = 4;
    private const uint LabelInformation = 0x10;
    private const string LowLabel = "(ML;OICI;NW;;;LW)";

    private static RawSecurityDescriptor ReadDacl(string path)
    {
        uint needed;
        GetFileSecurity(path, DaclInformation, null, 0, out needed);
        var buffer = new byte[needed];
        if (!GetFileSecurity(path, DaclInformation, buffer, needed, out needed)) throw AccessFailure(path);
        return new RawSecurityDescriptor(buffer, 0);
    }

    /// Writes the access list of this one folder. Unlike SetNamedSecurityInfo (which .NET uses) it
    /// does not walk the folder's content, which takes minutes on a folder such as AppData\Local.
    private static void WriteDacl(string path, RawSecurityDescriptor sd)
    {
        if ((sd.ControlFlags & ControlFlags.DiscretionaryAclAutoInherited) != 0)
        {
            sd.SetFlags(sd.ControlFlags | ControlFlags.DiscretionaryAclAutoInheritRequired);
        }
        var bytes = new byte[sd.BinaryLength];
        sd.GetBinaryForm(bytes, 0);
        if (!SetFileSecurity(path, DaclInformation, bytes)) throw AccessFailure(path);
    }

    private static Exception AccessFailure(string path)
    {
        int error = Marshal.GetLastWin32Error();
        if (error == 5) return new UnauthorizedAccessException(path);
        return new Win32Exception(error, path + ": " + new Win32Exception(error).Message);
    }

    /// A rule for this folder only, not for its content.
    private static void GrantThisFolderOnly(string dir, SecurityIdentifier sid, int mask)
    {
        RawSecurityDescriptor sd = ReadDacl(dir);
        RawAcl acl = sd.DiscretionaryAcl;
        if (acl == null) return; // no access list: everybody has access already
        var everyone = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        int position = 0;
        for (int k = 0; k < acl.Count; k++)
        {
            var ace = acl[k] as CommonAce;
            if (ace == null) continue;
            bool applies = (ace.AceFlags & AceFlags.InheritOnly) == 0;
            if (applies && ace.AceQualifier == AceQualifier.AccessAllowed && (ace.AccessMask & mask) == mask
                && (ace.SecurityIdentifier.Equals(sid) || ace.SecurityIdentifier.Equals(everyone) || ace.SecurityIdentifier.Equals(users)))
            {
                return;
            }
            if (ace.AceQualifier == AceQualifier.AccessDenied && (ace.AceFlags & AceFlags.Inherited) == 0) position = k + 1;
        }
        acl.InsertAce(position, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, mask, sid, false, null));
        WriteDacl(dir, sd);
    }

    /// Programs walk the path of their files folder by folder (Node's realpath does an lstat on each
    /// one). Inside the user's profile those folders are closed to isolated programs, so each one
    /// gets a rule for the folder itself that allows reading its attributes: not listing it, not
    /// its files.
    private static void GrantAncestors(string dir, SecurityIdentifier sid)
    {
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd('\\');
        DirectoryInfo current = new DirectoryInfo(dir).Parent;
        while (current != null && current.Parent != null)
        {
            if (string.Equals(current.FullName.TrimEnd('\\'), profile, StringComparison.OrdinalIgnoreCase)) break;
            try
            {
                GrantThisFolderOnly(current.FullName, sid, FileReadAttributes | Synchronize);
            }
            catch (UnauthorizedAccessException)
            {
                break; // not the user's folder: above it everything is readable by every user anyway
            }
            current = current.Parent;
        }
    }

    /// True when every user of this computer can list or change the folder (an access rule for
    /// "Users", "Authenticated Users" or "Everyone"): isolated programs can then reach it too.
    private static bool OpenToAllUsers(string dir)
    {
        try
        {
            RawAcl acl = ReadDacl(dir).DiscretionaryAcl;
            if (acl == null) return true;
            var open = new[]
            {
                new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null),
            };
            for (int k = 0; k < acl.Count; k++)
            {
                var ace = acl[k] as CommonAce;
                if (ace == null || ace.AceQualifier != AceQualifier.AccessAllowed || (ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
                if ((ace.AccessMask & 0x1) == 0) continue; // FILE_LIST_DIRECTORY
                foreach (SecurityIdentifier sid in open) if (ace.SecurityIdentifier.Equals(sid)) return true;
            }
            return false;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static bool HasLowLabel(string dir)
    {
        IntPtr sd = IntPtr.Zero;
        IntPtr sacl;
        if (GetNamedSecurityInfo(dir, 1, LabelInformation, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sacl, out sd) != 0) return false;
        try
        {
            IntPtr text;
            uint length;
            if (!ConvertSecurityDescriptorToStringSecurityDescriptor(sd, 1, LabelInformation, out text, out length)) return false;
            string sddl = Marshal.PtrToStringUni(text);
            LocalFree(text);
            return sddl != null && sddl.Contains(LowLabel);
        }
        finally
        {
            if (sd != IntPtr.Zero) LocalFree(sd);
        }
    }

    /// Marks a folder and its content as writable for low-integrity programs (kept on the folder).
    private static void LabelLow(string dir)
    {
        if (HasLowLabel(dir)) return;
        IntPtr sd;
        uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("S:" + LowLabel, 1, out sd, out size)) throw new Win32Exception();
        try
        {
            bool present, defaulted;
            IntPtr sacl;
            if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted)) throw new Win32Exception();
            uint result = SetNamedSecurityInfo(dir, 1, LabelInformation, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
            if (result != 0) throw new Win32Exception((int)result, "the folder could not be opened for write-protected programs: " + new Win32Exception((int)result).Message);
        }
        finally
        {
            LocalFree(sd);
        }
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "GetFileSecurityW")]
    private static extern bool GetFileSecurity(string path, uint info, byte[] sd, uint length, out uint needed);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "SetFileSecurityW")]
    private static extern bool SetFileSecurity(string path, uint info, byte[] sd);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr sd, out uint size);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd, uint revision, uint info, out IntPtr text, out uint length);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, EntryPoint = "SetNamedSecurityInfoW")]
    private static extern uint SetNamedSecurityInfo(string name, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetNamedSecurityInfoW")]
    private static extern uint GetNamedSecurityInfo(string name, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, out IntPtr sacl, out IntPtr sd);
}
