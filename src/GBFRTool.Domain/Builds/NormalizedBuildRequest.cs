using GBFRTool.Domain.Skills;

namespace GBFRTool.Domain.Builds;

public sealed record NormalizedBuildRequest(
    IReadOnlyList<SkillId> MandatoryTargets,
    IReadOnlyList<SkillId> OptionalTargets,
    BasicPrimaryTargetPolicy ActiveBasicPrimaryPolicy,
    SkillBlockPolicy SkillBlockPolicy,
    int MaxSlots,
    string? CharacterId,
    string CatalogVersion,
    int ResultLimit,
    long RunSeed,
    string RequestHash,
    string ComparatorVersion);
