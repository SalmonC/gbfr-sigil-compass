using GBFRTool.Application.Abstractions;
using GBFRTool.Application.Common;
using GBFRTool.Domain.Builds;

namespace GBFRTool.Application.UseCases;

public sealed class AnalyzeBuildUseCase(
    IInventorySnapshotRepository repository,
    IBuildRequestNormalizer requestNormalizer,
    IBuildSolver solver,
    IClock clock)
{
    public async Task<Outcome<BuildAnalysis>> ExecuteAsync(
        BuildRequest request,
        CancellationToken cancellationToken)
    {
        var context = new OperationContext(Guid.NewGuid().ToString("N"), clock.UtcNow);
        var normalization = await requestNormalizer.NormalizeAsync(request, context, cancellationToken);
        if (!normalization.IsValid)
        {
            return Outcome.Failure<BuildAnalysis>(
                new ApplicationError(
                    "solver.request.invalid",
                    "The build request contains invalid or conflicting selections.",
                    new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        ["issueCount"] = normalization.Issues.Count.ToString(
                            System.Globalization.CultureInfo.InvariantCulture)
                    }));
        }

        var inventory = await repository.GetCurrentAsync(context, cancellationToken);

        if (!inventory.IsSuccess)
        {
            return Outcome.Failure<BuildAnalysis>(inventory.Error!);
        }

        if (inventory.Value is null)
        {
            return Outcome.Failure<BuildAnalysis>(
                new ApplicationError("inventory.not_imported", "No inventory snapshot is available."));
        }

        return await solver.SolveAsync(
            inventory.Value,
            normalization.Request!,
            context,
            cancellationToken);
    }
}
