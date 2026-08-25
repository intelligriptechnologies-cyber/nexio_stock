using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace NexioStock.Authenticator;

internal sealed class AuthenticatorState
{
    public string ShopName { get; set; } = "Not Activated";
    public string ShopCode { get; set; } = "-";
    public string SecretBase32 { get; set; } = string.Empty;
    public int SecretVersion { get; set; }
    public int StepSeconds { get; set; } = 300;
    public string BackendBaseUrl { get; set; } = string.Empty;
    public string MachineLabel { get; set; } = string.Empty;

    private static string StateDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NexioStock", "Authenticator");

    private static string StatePath => Path.Combine(StateDirectory, "activation.json");

    public static AuthenticatorState LoadOrDefault()
    {
        if (!File.Exists(StatePath))
        {
            return new AuthenticatorState();
        }

        var protectedBytes = File.ReadAllBytes(StatePath);
        var rawBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
        var json = Encoding.UTF8.GetString(rawBytes);
        return JsonSerializer.Deserialize<AuthenticatorState>(json) ?? new AuthenticatorState();
    }

    public void Save()
    {
        Directory.CreateDirectory(StateDirectory);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(StatePath, protectedBytes);
    }

    public bool IsActivated => !string.IsNullOrWhiteSpace(SecretBase32);

    public byte[] GetSecretBytes()
    {
        return Base32.Decode(SecretBase32);
    }
}
