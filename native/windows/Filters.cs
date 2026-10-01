// Filters.cs - cuts the network of the isolated account in the Windows Filtering Platform.
//
// A rule of the Windows firewall does the same, but only while the Windows firewall is switched
// on; many computers have it off (another security product took over, or the user turned it off).
// A filter added to the filtering platform itself is applied by Windows in either case.
//
// The filter blocks every outgoing connection (IPv4 and IPv6) of the account, except connections
// to this computer itself: test suites start servers on localhost and connect to them.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;

internal static partial class EmirSandbox
{
    private static readonly Guid FilterKeyV4 = new Guid("3b1f7c52-8a0e-4c6b-9d2a-5e1c0f7a9b41");
    private static readonly Guid FilterKeyV6 = new Guid("3b1f7c52-8a0e-4c6b-9d2a-5e1c0f7a9b42");
    private static readonly Guid LayerConnectV4 = new Guid("c38d57d1-05a7-4c33-904f-7fbceee60e82"); // FWPM_LAYER_ALE_AUTH_CONNECT_V4
    private static readonly Guid LayerConnectV6 = new Guid("4a72393b-319f-44bc-84c3-ba54dcb3b6b4"); // FWPM_LAYER_ALE_AUTH_CONNECT_V6
    private static readonly Guid ConditionUserId = new Guid("af043a0a-b34d-4f86-979c-c90371af6e66"); // FWPM_CONDITION_ALE_USER_ID
    private static readonly Guid ConditionFlags = new Guid("632ce23b-5167-435c-86d7-e903684aa80c"); // FWPM_CONDITION_FLAGS
    private static readonly Guid SublayerUniversal = new Guid("eebecc03-ced4-4380-819a-2734397b2b74"); // FWPM_SUBLAYER_UNIVERSAL

    private const uint FWP_UINT8 = 1;
    private const uint FWP_UINT32 = 3;
    private const uint FWP_SECURITY_DESCRIPTOR_TYPE = 14;
    private const uint FWP_MATCH_EQUAL = 0;
    private const uint FWP_MATCH_FLAGS_NONE_SET = 8;
    private const uint FWP_CONDITION_FLAG_IS_LOOPBACK = 0x1;
    private const uint FWP_ACTION_BLOCK = 0x1001;
    private const uint FWPM_FILTER_FLAG_PERSISTENT = 0x1;
    private const uint FWP_E_FILTER_NOT_FOUND = 0x80320003;

    /// Adds the two blocking filters for the account (needs an administrator).
    private static void BlockNetworkWithFilters(string sid)
    {
        IntPtr engine;
        Check(FwpmEngineOpen0(null, 10 /* RPC_C_AUTHN_WINNT */, IntPtr.Zero, IntPtr.Zero, out engine), "the filtering platform could not be opened");
        try
        {
            RemoveFilters(engine);
            AddBlockFilter(engine, FilterKeyV4, LayerConnectV4, sid);
            AddBlockFilter(engine, FilterKeyV6, LayerConnectV6, sid);
        }
        finally
        {
            FwpmEngineClose0(engine);
        }
    }

    private static void RemoveNetworkFilters()
    {
        IntPtr engine;
        Check(FwpmEngineOpen0(null, 10, IntPtr.Zero, IntPtr.Zero, out engine), "the filtering platform could not be opened");
        try
        {
            RemoveFilters(engine);
        }
        finally
        {
            FwpmEngineClose0(engine);
        }
    }

    private static void RemoveFilters(IntPtr engine)
    {
        foreach (Guid key in new[] { FilterKeyV4, FilterKeyV6 })
        {
            Guid k = key;
            uint code = FwpmFilterDeleteByKey0(engine, ref k);
            if (code != 0 && code != FWP_E_FILTER_NOT_FOUND) Check(code, "an old filter could not be removed");
        }
    }

    private static void AddBlockFilter(IntPtr engine, Guid key, Guid layer, string sid)
    {
        // "Matches" means: the account passes an access check against this security descriptor.
        var sd = new RawSecurityDescriptor("O:LSG:LSD:(A;;CC;;;" + sid + ")");
        var sdBytes = new byte[sd.BinaryLength];
        sd.GetBinaryForm(sdBytes, 0);

        IntPtr name = Marshal.StringToHGlobalUni("Emir Code isolated commands (no network)");
        IntPtr description = Marshal.StringToHGlobalUni("Blocks the outgoing connections of the account that runs the isolated commands of Emir Code.");
        IntPtr sdData = Marshal.AllocHGlobal(sdBytes.Length);
        IntPtr blob = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FWP_BYTE_BLOB)));
        int conditionSize = Marshal.SizeOf(typeof(FWPM_FILTER_CONDITION0));
        IntPtr conditions = Marshal.AllocHGlobal(conditionSize * 2);
        try
        {
            Marshal.Copy(sdBytes, 0, sdData, sdBytes.Length);
            Marshal.StructureToPtr(new FWP_BYTE_BLOB { size = (uint)sdBytes.Length, data = sdData }, blob, false);
            Marshal.StructureToPtr(new FWPM_FILTER_CONDITION0
            {
                fieldKey = ConditionUserId,
                matchType = FWP_MATCH_EQUAL,
                conditionValue = new FWP_VALUE { type = FWP_SECURITY_DESCRIPTOR_TYPE, value = blob },
            }, conditions, false);
            Marshal.StructureToPtr(new FWPM_FILTER_CONDITION0
            {
                fieldKey = ConditionFlags,
                matchType = FWP_MATCH_FLAGS_NONE_SET,
                conditionValue = new FWP_VALUE { type = FWP_UINT32, value = (IntPtr)FWP_CONDITION_FLAG_IS_LOOPBACK },
            }, IntPtr.Add(conditions, conditionSize), false);

            var filter = new FWPM_FILTER0
            {
                filterKey = key,
                displayData = new FWPM_DISPLAY_DATA0 { name = name, description = description },
                flags = FWPM_FILTER_FLAG_PERSISTENT,
                layerKey = layer,
                subLayerKey = SublayerUniversal,
                weight = new FWP_VALUE { type = FWP_UINT8, value = (IntPtr)15 },
                numFilterConditions = 2,
                filterCondition = conditions,
                action = new FWPM_ACTION0 { type = FWP_ACTION_BLOCK },
            };
            ulong id;
            Check(FwpmFilterAdd0(engine, ref filter, IntPtr.Zero, out id), "the blocking filter could not be added");
        }
        finally
        {
            Marshal.FreeHGlobal(conditions);
            Marshal.FreeHGlobal(blob);
            Marshal.FreeHGlobal(sdData);
            Marshal.FreeHGlobal(description);
            Marshal.FreeHGlobal(name);
        }
    }

    private static void Check(uint code, string what)
    {
        if (code != 0) throw new Win32Exception(unchecked((int)code), what + " (0x" + code.ToString("X8") + ")");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FWP_BYTE_BLOB
    {
        public uint size;
        public IntPtr data;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FWPM_DISPLAY_DATA0
    {
        public IntPtr name;
        public IntPtr description;
    }

    /// FWP_VALUE0 and FWP_CONDITION_VALUE0: a type and a union of small values and pointers.
    [StructLayout(LayoutKind.Sequential)]
    private struct FWP_VALUE
    {
        public uint type;
        public IntPtr value;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FWPM_FILTER_CONDITION0
    {
        public Guid fieldKey;
        public uint matchType;
        public FWP_VALUE conditionValue;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FWPM_ACTION0
    {
        public uint type;
        public Guid filterType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FWPM_FILTER0
    {
        public Guid filterKey;
        public FWPM_DISPLAY_DATA0 displayData;
        public uint flags;
        public IntPtr providerKey;
        public FWP_BYTE_BLOB providerData;
        public Guid layerKey;
        public Guid subLayerKey;
        public FWP_VALUE weight;
        public uint numFilterConditions;
        public IntPtr filterCondition;
        public FWPM_ACTION0 action;
        public ulong context; // union { UINT64 rawContext; GUID providerContextKey; }
        public ulong contextHigh;
        public IntPtr reserved;
        public ulong filterId;
        public FWP_VALUE effectiveWeight;
    }

    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)]
    private static extern uint FwpmEngineOpen0(string serverName, uint authnService, IntPtr authIdentity, IntPtr session, out IntPtr engine);

    [DllImport("fwpuclnt.dll")]
    private static extern uint FwpmEngineClose0(IntPtr engine);

    [DllImport("fwpuclnt.dll")]
    private static extern uint FwpmFilterAdd0(IntPtr engine, ref FWPM_FILTER0 filter, IntPtr sd, out ulong id);

    [DllImport("fwpuclnt.dll")]
    private static extern uint FwpmFilterDeleteByKey0(IntPtr engine, ref Guid key);
}
