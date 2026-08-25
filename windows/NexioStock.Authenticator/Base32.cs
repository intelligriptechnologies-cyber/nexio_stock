namespace NexioStock.Authenticator;

internal static class Base32
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static byte[] Decode(string input)
    {
        var cleaned = input.Trim().TrimEnd('=').ToUpperInvariant();
        var output = new List<byte>();
        var buffer = 0;
        var bitsLeft = 0;

        foreach (var c in cleaned)
        {
            var index = Alphabet.IndexOf(c);
            if (index < 0)
            {
                throw new InvalidOperationException("Invalid base32 secret.");
            }

            buffer = (buffer << 5) | index;
            bitsLeft += 5;

            if (bitsLeft >= 8)
            {
                output.Add((byte)((buffer >> (bitsLeft - 8)) & 0xFF));
                bitsLeft -= 8;
            }
        }

        return output.ToArray();
    }
}
