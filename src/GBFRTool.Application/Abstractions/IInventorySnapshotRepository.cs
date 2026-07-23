using GBFRTool.Application.Common;
using GBFRTool.Domain.Inventory;

namespace GBFRTool.Application.Abstractions;

public interface IInventorySnapshotRepository
{
    Task<Outcome<InventorySnapshot>> SaveAsync(
        InventorySnapshot snapshot,
        OperationContext context,
        CancellationToken cancellationToken);

    Task<Outcome<InventorySnapshot?>> GetCurrentAsync(
        OperationContext context,
        CancellationToken cancellationToken);
}
