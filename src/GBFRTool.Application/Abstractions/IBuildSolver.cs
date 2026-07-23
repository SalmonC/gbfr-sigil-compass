using GBFRTool.Application.Common;
using GBFRTool.Domain.Builds;
using GBFRTool.Domain.Inventory;

namespace GBFRTool.Application.Abstractions;

public interface IBuildSolver
{
    Task<Outcome<BuildAnalysis>> SolveAsync(
        InventorySnapshot inventory,
        NormalizedBuildRequest request,
        OperationContext context,
        CancellationToken cancellationToken);
}
