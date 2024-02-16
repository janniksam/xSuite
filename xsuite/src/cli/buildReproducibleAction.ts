import { PathLike, existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";
import { Command } from "commander";
import { log } from "../_stdio";
import {
  defaultIgnore,
  findBuildableContractDirs,
  getGid,
  getUid,
} from "./buildUtils";
import {
  defaultReproducibleDockerImage,
  logAndRunCommand,
  logError,
  promptUserWithRetry,
} from "./helpers";

export const registerBuildReproducibleCmd = (cmd: Command) => {
  cmd
    .command("build-reproducible")
    .description("Build contract.")
    .option(
      "--image <IMAGE_TAG>",
      "Specify the tag of the docker image, that is used to build the contract (e. g. multiversx/sdk-rust-contract-builder:v6.1.0)",
    )
    .option(
      "--dir <DIR>",
      "Directory in which the command is executed (default: $(PWD))",
    )
    .option(
      "--target-dir <TARGET_DIR>",
      "Target directory used by Rust compiler (default: $(PWD)/target)",
    )
    .option(
      "--ignore <IGNORE>",
      `Ignore all directories matching the RegExp (default: ${defaultIgnore})`,
    )
    .option("-r, --recursive", "Build all contracts under the directory")
    .option(
      "--no-docker-interactive",
      "Do not use interactive mode for Docker",
      true,
    )
    .option("--no-docker-tty", "Do not allocate a pseudo-TTY for Docker", true)
    .option("--no-wasm-opt", "Do not optimize wasm files after the build", true)
    .option(
      "--cargo-verbose",
      "Set 'CARGO_TERM_VERBOSE' environment variable",
      false,
    )
    .action(action);
};

export const action = async ({
  image,
  dir,
  targetDir,
  ignore,
  recursive,
  dockerInteractive,
  dockerTty,
  wasmOpt,
  cargoVerbose,
}: {
  image?: string;
  dir?: string;
  targetDir?: string;
  ignore?: string;
  recursive: boolean;
  dockerInteractive: boolean;
  dockerTty: boolean;
  wasmOpt: boolean;
  cargoVerbose: boolean;
}) => {
  if (!image) {
    const promptResult = await askForImage();
    image = promptResult;
  }

  dir = dir ?? process.cwd();
  targetDir = targetDir ?? path.join(process.cwd(), "target");
  const dirs = findBuildableContractDirs(dir, ignore, recursive);

  // Prepare (and check) output folder
  const targetRoot = targetDir as PathLike;

  // Ensure that docker installed
  ensureDockerInstalled();

  // Ensure output folder is empty

  dirs.forEach((project) => {
    log(`Building project ${project}...`);
    const projectName = path.basename(project);
    const targetPath = targetRoot + `/${projectName}`;
    ensureTargetDirIsEmpty(targetPath);

    // Prepare general docker arguments
    const docker_general_args: string[] = ["run"];

    if (dockerInteractive) {
      docker_general_args.push("--interactive");
    }
    if (dockerTty) {
      docker_general_args.push("--tty");
    }

    const userId = getUid();
    const groupId = getGid();
    if (userId && groupId) {
      docker_general_args.push("--user", `${userId}:${groupId}`);
    }
    docker_general_args.push("--rm");

    // Prepare docker arguments related to mounting volumes
    const docker_mount_args: string[] = ["--volume", `${targetPath}:/output`];

    if (project) {
      docker_mount_args.push("--volume", `${project}:/project`);
    }

    const mountedTemporaryRoot = "/tmp/multiversx_sdk_rust_contract_builder";
    const mounted_cargo_target_dir = `${mountedTemporaryRoot}/cargo-target-dir`;
    const mounted_cargo_registry = `${mountedTemporaryRoot}/cargo-registry`;
    const mounted_cargo_git = `${mountedTemporaryRoot}/cargo-git`;

    // permission fix. does not work, when we let docker create these volumes.
    if (!existsSync(mountedTemporaryRoot)) {
      mkdirSync(mounted_cargo_target_dir, { recursive: true });
      mkdirSync(mounted_cargo_registry, { recursive: true });
      mkdirSync(mounted_cargo_git, { recursive: true });
    }

    docker_mount_args.push(
      "--volume",
      `${mounted_cargo_target_dir}:/rust/cargo-target-dir`,
    );
    docker_mount_args.push(
      "--volume",
      `${mounted_cargo_registry}:/rust/registry`,
    );
    docker_mount_args.push("--volume", `${mounted_cargo_git}:/rust/git`);

    const docker_env_args: string[] = [
      "--env",
      `CARGO_TERM_VERBOSE=${cargoVerbose.toString().toLowerCase()}`,
    ];

    // Prepare entrypoint arguments
    const entrypoint_args: string[] = [];

    if (project) {
      entrypoint_args.push("--project", "project");
    }

    if (!wasmOpt) {
      entrypoint_args.push("--no-wasm-opt");
    }

    const args = [
      ...docker_general_args,
      ...docker_mount_args,
      ...docker_env_args,
      `${image}`,
      ...entrypoint_args,
    ];

    log("Running docker...");
    logAndRunCommand("docker", args);
    log("Reproducible build succeeded...");
  });
};

const ensureTargetDirIsEmpty = (parentTargetDir: PathLike) => {
  if (!existsSync(parentTargetDir)) {
    mkdirSync(parentTargetDir, { recursive: true });
    return;
  }

  const is_empty = readdirSync(parentTargetDir).length === 0;
  if (!is_empty) {
    logError(`target-dir must be empty: ${parentTargetDir}`);
    throw new Error(`target-dir must be empty: ${parentTargetDir}`);
  }
};

const ensureDockerInstalled = () => {
  logAndRunCommand("command", ["-v", "docker"]);
};

const askForImage = () => {
  log(`You did't provide '--image <IMAGE>

When building smart contracts in a reproducible mann1er, we rely on frozen Docker images.

MultiversX offers a default image for this purpose (multiversx/sdk-rust-contract-builder), but you can also build and use your own images.
`);

  return promptUserWithRetry(
    `Please enter the image (default: ${defaultReproducibleDockerImage}):`,
    defaultReproducibleDockerImage,
    /^\S+:\S+$/,
    "The image needs to have the following format: 'imagename:tag'",
  );
};
