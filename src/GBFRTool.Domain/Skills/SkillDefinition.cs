namespace GBFRTool.Domain.Skills;

public sealed record SkillDefinition(
    SkillId Id,
    uint RawHash,
    IReadOnlyDictionary<string, string> LocalizedNames,
    SkillCategory SemanticCategory,
    string FilterCategoryId,
    bool CanBePrimary,
    bool CanBeSecondary,
    int? MaxLevel);

public sealed record SkillCatalogSnapshot(
    string CatalogVersion,
    string GameVersion,
    IReadOnlyList<SkillFilterDefinition> OrderedFilters,
    IReadOnlyDictionary<SkillId, SkillDefinition> Skills);

public sealed record SkillFilterDefinition(
    string FilterId,
    IReadOnlyDictionary<string, string> LocalizedNames,
    int DisplayOrder,
    bool IsAggregate);
