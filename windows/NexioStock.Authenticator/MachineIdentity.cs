using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace NexioStock.Authenticator;

internal static class MachineIdentity
{
    public static string GetStableFingerprint()
    {
        var parts = new List<string?>
        {
            ReadMachineGuid(),
            Environment.MachineName,
            Environment.UserDomainName,
            GetMacAddress(),
        };

        var source = string.Join("|", parts.Where(static part => !string.IsNullOrWhiteSpace(part)));
        if (string.IsNullOrWhiteSpace(source))
        {
            source = "nexio-stock-authenticator";
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
    }

    private static string? ReadMachineGuid()
    {
        try
        {
            return Registry.GetValue(
                @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography",
                "MachineGuid",
                null
            ) as string;
        }
        catch
        {
            return null;
        }
    }

    private static string? GetMacAddress()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(static nic =>
                    nic.OperationalStatus == OperationalStatus.Up &&
                    nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Select(static nic => nic.GetPhysicalAddress().ToString())
                .FirstOrDefault(static value => !string.IsNullOrWhiteSpace(value));
        }
        catch
        {
            return null;
        }
    }
}
