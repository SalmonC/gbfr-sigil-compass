using System.Xml.Linq;

namespace GBFRTool.ArchitectureTests;

internal static class Program
{
    private static readonly Dictionary<string, HashSet<string>> AllowedReferences =
        new(StringComparer.Ordinal)
        {
            ["GBFRTool.Domain"] = Set(),
            ["GBFRTool.Application"] = Set("GBFRTool.Domain"),
            ["GBFRTool.Contracts"] = Set(),
            ["GBFRTool.SaveReader.Core"] = Set(),
            ["GBFRTool.SaveReader.Worker"] = Set("GBFRTool.Contracts", "GBFRTool.SaveReader.Core"),
            ["GBFRTool.Engine.Host"] = Set("GBFRTool.Contracts"),
            ["GBFRTool.Infrastructure.SaveReader.Client"] =
                Set("GBFRTool.Application", "GBFRTool.Contracts", "GBFRTool.Domain"),
            ["GBFRTool.Infrastructure.Solver.OrTools"] =
                Set("GBFRTool.Application", "GBFRTool.Domain"),
            ["GBFRTool.Infrastructure.Persistence.Sqlite"] =
                Set("GBFRTool.Application", "GBFRTool.Domain"),
            ["GBFRTool.Infrastructure.Catalog.Json"] =
                Set("GBFRTool.Application", "GBFRTool.Domain"),
        };

    public static int Main()
    {
        var repositoryRoot = FindRepositoryRoot(AppContext.BaseDirectory);
        var failures = new List<string>();

        foreach (var projectPath in Directory.EnumerateFiles(
                     Path.Combine(repositoryRoot, "src"),
                     "*.csproj",
                     SearchOption.AllDirectories))
        {
            ValidateProject(projectPath, failures);
        }

        if (failures.Count == 0)
        {
            Console.WriteLine("Architecture dependency checks passed.");
            return 0;
        }

        Console.Error.WriteLine("Architecture dependency checks failed:");
        foreach (var failure in failures)
        {
            Console.Error.WriteLine($"- {failure}");
        }

        return 1;
    }

    private static void ValidateProject(string projectPath, List<string> failures)
    {
        var projectName = Path.GetFileNameWithoutExtension(projectPath);
        if (!AllowedReferences.TryGetValue(projectName, out var allowed))
        {
            failures.Add($"No dependency policy is registered for {projectName}.");
            return;
        }

        var document = XDocument.Load(projectPath);
        var actual = document
            .Descendants("ProjectReference")
            .Select(reference => reference.Attribute("Include")?.Value)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => Path.GetFileNameWithoutExtension(path!))
            .ToHashSet(StringComparer.Ordinal);

        foreach (var forbidden in actual.Except(allowed, StringComparer.Ordinal))
        {
            failures.Add($"{projectName} has forbidden reference to {forbidden}.");
        }

        if (projectName is "GBFRTool.Domain" or "GBFRTool.Contracts"
            && document.Descendants("PackageReference").Any())
        {
            failures.Add($"{projectName} must not contain PackageReference items.");
        }
    }

    private static string FindRepositoryRoot(string startPath)
    {
        var directory = new DirectoryInfo(startPath);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "GBFRTool.slnx")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate the repository root.");
    }

    private static HashSet<string> Set(params string[] values) =>
        new HashSet<string>(values, StringComparer.Ordinal);
}
