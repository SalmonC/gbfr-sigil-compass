using GBFRTool.Domain.Builds;
using GBFRTool.Domain.Skills;

namespace GBFRTool.Application.Builds;

public sealed record BuildRequestNormalizationResult(
    NormalizedBuildRequest? Request,
    IReadOnlyList<BuildRequestValidationIssue> Issues)
{
    public bool IsValid => Request is not null && Issues.Count == 0;
}

public sealed record BuildRequestValidationIssue(
    string Code,
    SkillId? SkillId,
    IReadOnlyList<SkillSelectionOccupancy> Occupancies,
    string MessageKey);

public sealed record SkillSelectionAvailability(
    bool CanAdd,
    bool CanRemove,
    IReadOnlyList<SkillSelectionOccupancy> Occupancies);

public sealed record SkillSelectionOccupancy(
    SkillSelectionDomain Domain,
    IReadOnlyList<int> Positions);

public enum SkillSelectionDomain
{
    MandatoryTarget,
    OptionalTarget,
    BasicPrimaryTarget,
    PrimarySubstitutionPool,
    ForbiddenPool,
    SoftBlockedPool
}
