using System.Security.Cryptography;

namespace NexioStock.Authenticator;

internal static class AccessKeyGenerator
{
    public static string Generate(byte[] secretBytes, DateTimeOffset nowUtc, int stepSeconds = 300)
    {
        var counter = nowUtc.ToUnixTimeSeconds() / stepSeconds;
        Span<byte> counterBytes = stackalloc byte[8];
        BitConverter.TryWriteBytes(counterBytes, counter);
        if (BitConverter.IsLittleEndian)
        {
            counterBytes.Reverse();
        }

        using var hmac = new HMACSHA256(secretBytes);
        var digest = hmac.ComputeHash(counterBytes.ToArray());
        var offset = digest[^1] & 0x0F;
        var binary =
            ((digest[offset] & 0x7F) << 24) |
            (digest[offset + 1] << 16) |
            (digest[offset + 2] << 8) |
            digest[offset + 3];

        return (binary % 1_000_000).ToString("D6");
    }

    public static int SecondsRemaining(DateTimeOffset nowUtc, int stepSeconds = 300)
    {
        var elapsed = (int)(nowUtc.ToUnixTimeSeconds() % stepSeconds);
        return stepSeconds - elapsed;
    }
}
