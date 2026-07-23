using GBFRTool.Application.Common;
using GBFRTool.Domain.Builds;

namespace GBFRTool.Application.Abstractions;

public interface IBuildProfileRepository
{
    Task<Outcome<IReadOnlyList<BuildRequest>>> ListAsync(
        OperationContext context,
        CancellationToken cancellationToken);
}
