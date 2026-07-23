namespace GBFRTool.SaveReader.Core.Model;

public sealed record ParsedSave(
    string ParserVersion,
    string DetectedGameDataVersion,
    IReadOnlyList<ParsedSigil> Sigils,
    IReadOnlyList<ParseDiagnostic> Diagnostics);

public sealed record ParsedSigil(
    long GemUnitId,
    long SourceSlotId,
    uint SigilHash,
    int SigilLevel,
    uint PrimaryTraitHash,
    int PrimaryLevel,
    uint SecondaryTraitHash,
    int SecondaryLevel,
    uint Flags,
    string? WornByCharacterId);

public sealed record ParseDiagnostic(
    string Severity,
    string Code,
    string Message,
    IReadOnlyDictionary<string, string>? Metadata = null);
