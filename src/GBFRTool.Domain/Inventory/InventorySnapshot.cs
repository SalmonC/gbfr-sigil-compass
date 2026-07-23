namespace GBFRTool.Domain.Inventory;

public sealed record InventorySnapshot(
    string SnapshotId,
    string SourceSha256,
    DateTimeOffset ImportedAt,
    string ParserVersion,
    string GameDataVersion,
    IReadOnlyList<SigilInstance> Sigils,
    IReadOnlyList<string> Diagnostics);
