namespace GBFRTool.Application.Common;

public sealed record ApplicationError(
    string Code,
    string Message,
    IReadOnlyDictionary<string, string>? Metadata = null);
