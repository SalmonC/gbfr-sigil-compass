using GBFRTool.Application.Builds;
using GBFRTool.Domain.Builds;
using GBFRTool.Domain.Skills;

namespace GBFRTool.Application.Abstractions;

public interface ISkillSelectionConflictPolicy
{
    SkillSelectionAvailability Evaluate(
        BuildRequest draft,
        SkillId skillId,
        SkillSelectionDomain destination);
}
