using System.Text.Json;
using GBFRTool.Contracts.SaveReader;
using GBFRTool.SaveReader.Core;

namespace GBFRTool.SaveReader.Worker;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<int> Main(string[] args)
    {
        if (args is ["--self-test"])
        {
            var hello = new WorkerHello(
                ProtocolVersion.Current,
                typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0",
                ["read-only", "stdio-ndjson"]);

            Console.Out.WriteLine(JsonSerializer.Serialize(hello, JsonOptions));
            return 0;
        }

        if (args is ["--parse", var savePath])
        {
            try
            {
                await using var source = new FileStream(
                    savePath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete,
                    1024 * 1024,
                    FileOptions.Asynchronous | FileOptions.SequentialScan);
                var parsed = await new ReadOnlyGbfrSaveParser().ParseAsync(source, CancellationToken.None);
                var response = new WorkerParsedInventory(
                    parsed.ParserVersion,
                    parsed.DetectedGameDataVersion,
                    parsed.Sigils.Select(sigil => new WorkerRawSigil(
                        sigil.GemUnitId,
                        sigil.SourceSlotId,
                        sigil.SigilHash,
                        sigil.SigilLevel,
                        sigil.PrimaryTraitHash,
                        sigil.PrimaryLevel,
                        sigil.SecondaryTraitHash,
                        sigil.SecondaryLevel,
                        sigil.Flags,
                        sigil.WornByCharacterId)).ToArray(),
                    parsed.Diagnostics.Select(diagnostic => new WorkerDiagnostic(
                        diagnostic.Severity,
                        diagnostic.Code,
                        diagnostic.Message,
                        diagnostic.Metadata)).ToArray());
                Console.Out.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
                return 0;
            }
            catch (Exception exception) when (exception is IOException or InvalidDataException)
            {
                Console.Error.WriteLine(exception.Message);
                return 3;
            }
        }

        Console.Error.WriteLine(
            "Usage: --self-test or --parse <read-only-snapshot-path>.");
        return 2;
    }
}
