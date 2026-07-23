using GBFRTool.Application.Builds;
using GBFRTool.Application.Common;
using GBFRTool.Domain.Builds;

namespace GBFRTool.Application.Abstractions;

public interface IBuildRequestNormalizer
{
    Task<BuildRequestNormalizationResult> NormalizeAsync(
        BuildRequest request,
        OperationContext context,
        CancellationToken cancellationToken);
}
