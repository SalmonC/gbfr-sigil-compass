using GBFRTool.Application.Common;
using GBFRTool.Domain.Inventory;

namespace GBFRTool.Application.Abstractions;

public interface IInventorySource
{
    string SourceId { get; }

    Task<Outcome<InventorySnapshot>> ImportAsync(
        InventoryImportRequest request,
        OperationContext context,
        CancellationToken cancellationToken);
}
