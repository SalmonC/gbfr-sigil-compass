using GBFRTool.SaveReader.Core.Model;

namespace GBFRTool.SaveReader.Core;

public interface IReadOnlySaveParser
{
    Task<ParsedSave> ParseAsync(Stream source, CancellationToken cancellationToken);
}
