import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseArgs,
  readArtifactPackageCandidateMetadata,
  validateAlienPackageSpec,
} from "../../scripts/resolve-alien-package-candidate.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolve-alien-package-candidate", () => {
  it("accepts only Alien release package specs for npm candidates", () => {
    expect(() => validateAlienPackageSpec("alien@beta")).not.toThrow();
    expect(() => validateAlienPackageSpec("alien@alpha")).not.toThrow();
    expect(() => validateAlienPackageSpec("alien@latest")).not.toThrow();
    expect(() => validateAlienPackageSpec("alien@2026.4.27")).not.toThrow();
    expect(() => validateAlienPackageSpec("alien@2026.4.27-1")).not.toThrow();
    expect(() => validateAlienPackageSpec("alien@2026.4.27-beta.2")).not.toThrow();
    expect(() => validateAlienPackageSpec("alien@2026.4.27-alpha.2")).not.toThrow();

    expect(() => validateAlienPackageSpec("@evil/alien@1.0.0")).toThrow(
      "package_spec must be alien@alpha",
    );
    expect(() => validateAlienPackageSpec("alien@canary")).toThrow(
      "package_spec must be alien@alpha",
    );
    expect(() => validateAlienPackageSpec("alien@2026.04.27")).toThrow(
      "package_spec must be alien@alpha",
    );
    expect(() => validateAlienPackageSpec("alien@npm:other-package")).toThrow(
      "package_spec must be alien@alpha",
    );
    expect(() => validateAlienPackageSpec("alien@file:../other-package.tgz")).toThrow(
      "package_spec must be alien@alpha",
    );
  });

  it("parses optional empty workflow inputs without rejecting the command line", () => {
    expect(
      parseArgs([
        "--source",
        "npm",
        "--package-ref",
        "release/2026.4.27",
        "--package-spec",
        "alien@beta",
        "--package-url",
        "",
        "--package-sha256",
        "",
        "--artifact-dir",
        ".",
        "--output-dir",
        ".artifacts/docker-e2e-package",
      ]),
    ).toMatchObject({
      artifactDir: ".",
      outputDir: ".artifacts/docker-e2e-package",
      packageSha256: "",
      packageRef: "release/2026.4.27",
      packageSpec: "alien@beta",
      packageUrl: "",
      source: "npm",
    });
  });

  it("reads package source metadata from package artifacts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "alien-package-candidate-"));
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, "package-candidate.json"),
      JSON.stringify(
        {
          packageRef: "release/2026.4.30",
          packageSourceSha: "66ce632b9b7c5c7fdd3e66c739687d51638ad6e2",
          packageTrustedReason: "repository-branch-history",
          sha256: "a".repeat(64),
        },
        null,
        2,
      ),
    );

    await expect(readArtifactPackageCandidateMetadata(dir)).resolves.toMatchObject({
      packageRef: "release/2026.4.30",
      packageSourceSha: "66ce632b9b7c5c7fdd3e66c739687d51638ad6e2",
      packageTrustedReason: "repository-branch-history",
      sha256: "a".repeat(64),
    });
  });
});
