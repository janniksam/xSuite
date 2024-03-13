import * as crypto from "crypto";
import { PathLike, existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";
import { SignableMessage } from "@multiversx/sdk-core";
import { Command } from "commander";
import { log } from "../_stdio";
import { Proxy } from "../proxy/proxy";
import { KeystoreSigner } from "../world/signer";
import {
  defaultIgnore,
  defaultReproducibleDockerImage,
  defaultVerifierUrl,
  findBuildableContractDirs,
  getGid,
  getUid,
} from "./buildUtils";
import {
  delay,
  findFileRecursive,
  logAndRunCommand,
  logError,
  promptUserWithRetry,
  readJsonFile,
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
    .option(
      "--publish",
      "Verifies the smart contract and publishes the reproducible information",
    )
    .option("--sc <SC>", "The smart contract to be verified")
    .option("--wallet <WALLET_PATH>", "Wallet path")
    .option("--password <PASSWORD>", "Wallet password")
    .option(
      "--verifier-url <VERIFIIER_URL>",
      `Verifier Url (Default: ${defaultVerifierUrl}`,
    )
    .option("--no-build", "Skips the build. Can be useful when publishing")
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
  publish,
  sc,
  wallet: walletPath,
  password,
  verifierUrl,
  build,
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
  // publish options
  publish?: boolean;
  sc?: string;
  wallet?: string;
  password?: string;
  verifierUrl?: string;
  build?: boolean;
}) => {
  dir = dir ?? process.cwd();
  targetDir = targetDir ?? path.join(process.cwd(), "target");
  verifierUrl = verifierUrl ?? defaultVerifierUrl;

  // if (publishTo && recursive) {
  //   logError("You cannot combine both options publish and recursive");
  //   return;
  // }

  if (publish && !walletPath) {
    log("You didn't provide a wallet, which is mandatory when publishing");
    return;
  }

  let signer: KeystoreSigner;
  if (password === undefined) {
    signer = await KeystoreSigner.fromFile(walletPath ?? "");
  } else {
    signer = KeystoreSigner.fromFile_unsafe(walletPath ?? "", password);
  }

  if (!image) {
    const promptResult = await askForImage();
    image = promptResult;
  }

  if (publish && !sc) {
    const promptResult = await askForSmartContract();
    sc = promptResult;
  }

  const dirs = findBuildableContractDirs(dir, ignore, recursive);

  // Prepare (and check) output folder
  const targetRoot = targetDir as PathLike;

  // Ensure that docker installed
  ensureDockerInstalled();

  // Ensure output folder is empty

  for (let i = 0; i < dirs.length; i++) {
    const project = dirs[i];
    const projectName = path.basename(project);
    const targetPath = targetRoot + `/${projectName}`;

    if (build) {
      buildContract(
        image,
        project,
        targetPath,
        dockerInteractive,
        dockerTty,
        wasmOpt,
        cargoVerbose,
      );
    }

    if (publish) {
      publishContract(targetPath, image, sc ?? "", verifierUrl, signer);
      // delete me
      return;
    }
  }
};

const buildContract = (
  image: string,
  project: string,
  targetPath: string,
  dockerInteractive: boolean,
  dockerTty: boolean,
  wasmOpt: boolean,
  cargoVerbose: boolean,
) => {
  log(`Building project ${project}...`);
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
  log(`Reproducible build succeeded for ${project}...`);
};

const publishContract = async (
  targetPath: string,
  image: string,
  sc: string,
  verifierUrl: string,
  signer: KeystoreSigner,
) => {
  log("Publish started...");
  const sourceCodePath = findFileRecursive(targetPath, /^.+\.source\.json$/);
  if (!sourceCodePath) {
    logError(`Cannot find sourcecode file to verify in ${targetPath}`);
    return;
  }
  const sourceCode = readJsonFile(sourceCodePath);
  const payload = new ContractVerificationPayload(
    sc,
    sourceCode,
    image,
  ).serialize();
  const signature = await createRequestSignature(sc, payload, signer);
  const request = new ContractVerificationRequest(
    sc,
    sourceCode,
    signature,
    image,
  ).toDictionary();

  await verify(verifierUrl, request);

  return;
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

const createRequestSignature = async (
  scAddress: string,
  requestPayload: string,
  signer: KeystoreSigner,
): Promise<string> => {
  const hashedPayload: string = crypto
    .createHash("sha256")
    .update(requestPayload)
    .digest("hex");

  const rawDatatoSign: string = `${scAddress}${hashedPayload}`;

  const dataToSign = new SignableMessage({
    message: Buffer.from(rawDatatoSign, "utf8"),
  }).serializeForSigning();

  const signature = await signer.sign(dataToSign);
  const signatureHex = signature.toString("hex");
  return signatureHex;
};

const verify = async (baseUrl: string, request: any) => {
  const verifierUrl = `${baseUrl}/verifier`;
  log(`Request verification at ${verifierUrl}...`);

  const startTime = new Date().getTime();
  const response = await Proxy.fetchRaw(verifierUrl, request, {
    "Content-Type": "application/json",
  });

  const taskId = response.taskId;
  if (!taskId) {
    throw Error(`Verification failed. Response: ${JSON.stringify(response)}`);
  }

  log(`Verification in process (taskId: ${taskId})...`);
  log("Please wait while we verify your contract. This may take a while.");

  const url = `${baseUrl}/tasks/${taskId}`;
  let oldStatus = "";
  let status = "";

  while (status != "finished") {
    const response = await Proxy.fetchRaw(url);
    status = response.status;

    if (status == "finished") {
      const timeElapsed = (new Date().getTime() - startTime) / 1000;
      log(`Verification finished in ${timeElapsed} seconds!`);
      return;
    } else if (status != oldStatus) {
      log(`Task status: ${status}`);
      log(JSON.stringify(response));
      oldStatus = status;
    }

    await delay(200);
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

const askForSmartContract = () => {
  log(
    "You are trying to verify a smart contract, but did't provide a smart contract using '--sc <SC>.",
  );

  return promptUserWithRetry(
    "Please enter a smart contract address:",
    undefined,
    /^erd[a-zA-Z0-9]{59}$/,
    "Invalid smart contract address",
  );
};

class ContractVerificationPayload {
  contractAddress: string;
  sourceCode: any;
  dockerImage: string;
  contractVariant?: string | null;

  constructor(
    contractAddress: string,
    sourceCode: any,
    dockerImage: string,
    contractVariant?: string | null,
  ) {
    this.contractAddress = contractAddress;
    this.sourceCode = sourceCode;
    this.dockerImage = dockerImage;
    this.contractVariant = contractVariant;
  }

  serialize(): string {
    const payload = {
      contract: this.contractAddress,
      dockerImage: this.dockerImage,
      sourceCode: this.sourceCode,
      contractVariant: this.contractVariant,
    };

    return JSON.stringify(payload);
  }
}

class ContractVerificationRequest {
  contractAddress: string;
  sourceCode: any;
  signature: string;
  dockerImage: string;
  contractVariant?: string | null;

  constructor(
    contractAddress: string,
    sourceCode: any,
    signature: string,
    dockerImage: string,
    contractVariant?: string | null,
  ) {
    this.contractAddress = contractAddress;
    this.sourceCode = sourceCode;
    this.signature = signature;
    this.dockerImage = dockerImage;
    this.contractVariant = contractVariant;
  }

  toDictionary(): any {
    return {
      signature: this.signature,
      payload: {
        contract: this.contractAddress,
        dockerImage: this.dockerImage,
        sourceCode: this.sourceCode,
        contractVariant: this.contractVariant,
      },
    };
  }
}
