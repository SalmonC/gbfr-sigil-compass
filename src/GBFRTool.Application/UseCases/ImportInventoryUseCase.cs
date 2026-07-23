using GBFRTool.Application.Abstractions;
using GBFRTool.Application.Common;
using GBFRTool.Domain.Inventory;

namespace GBFRTool.Application.UseCases;

public sealed class ImportInventoryUseCase
{
    private readonly IClock _clock;
    private readonly IInventorySnapshotRepository _repository;
    private readonly Dictionary<string, IInventorySource> _sources;

    public ImportInventoryUseCase(
        IEnumerable<IInventorySource> inventorySources,
        IInventorySnapshotRepository repository,
        IClock clock)
    {
        _sources = inventorySources.ToDictionary(source => source.SourceId, StringComparer.Ordinal);
        _repository = repository;
        _clock = clock;
    }

    public async Task<Outcome<InventorySnapshot>> ExecuteAsync(
        InventoryImportRequest request,
        CancellationToken cancellationToken)
    {
        var context = new OperationContext(Guid.NewGuid().ToString("N"), _clock.UtcNow);
        if (!_sources.TryGetValue(request.SourceId, out var inventorySource))
        {
            return Outcome.Failure<InventorySnapshot>(
                new ApplicationError(
                    "inventory.source_not_found",
                    $"No inventory source handles '{request.SourceId}'."));
        }

        var imported = await inventorySource.ImportAsync(request, context, cancellationToken);

        return imported.IsSuccess
            ? await _repository.SaveAsync(imported.Value!, context, cancellationToken)
            : Outcome.Failure<InventorySnapshot>(imported.Error!);
    }
}
