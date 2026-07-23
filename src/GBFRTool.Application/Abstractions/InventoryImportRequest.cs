namespace GBFRTool.Application.Abstractions;

public sealed record InventoryImportRequest(
    string SourceId,
    Uri Locator,
    IReadOnlyDictionary<string, string> Options);
