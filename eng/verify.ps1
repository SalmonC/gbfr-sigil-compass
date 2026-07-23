$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot

try {
    $previousRollForward = $env:DOTNET_ROLL_FORWARD
    $env:DOTNET_ROLL_FORWARD = "Major"

    dotnet build GBFRTool.slnx -c Release
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    dotnet format GBFRTool.slnx --verify-no-changes --no-restore
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    dotnet run --project tests/GBFRTool.ArchitectureTests -c Release --no-build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    dotnet run --project src/GBFRTool.SaveReader.Worker -c Release --no-build -- --self-test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    $env:DOTNET_ROLL_FORWARD = $previousRollForward
    Pop-Location
}
