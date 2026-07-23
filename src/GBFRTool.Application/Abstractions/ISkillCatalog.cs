using GBFRTool.Application.Common;
using GBFRTool.Domain.Skills;

namespace GBFRTool.Application.Abstractions;

public interface ISkillCatalog
{
    Task<Outcome<SkillCatalogSnapshot>> GetAsync(
        string catalogVersion,
        OperationContext context,
        CancellationToken cancellationToken);
}
