import fs from "node:fs";
import path from "node:path";
import { SignableMessage } from "@multiversx/sdk-core";
import { NativeAuthClient } from "@multiversx/sdk-native-auth-client";
import { Mnemonic, UserSigner, UserWallet } from "@multiversx/sdk-wallet";
import chalk from "chalk";
import { Command } from "commander";
import {
  cwd,
  downloadAndExtractContract,
  inputHidden,
  runCommand,
} from "./helpers";

const program = new Command();

program
  .command("setup-rust")
  .description(
    "Install Rust nightly, wasm32-unknown-unknown target, and multiversx-sc-meta crate."
  )
  .action(() => setupRustAction());

program
  .command("contract-new")
  .description("Create a new blank contract.")
  .requiredOption("--dir <dir>", "Contract dir")
  .action((options) => contractNewAction(options));

program
  .command("contract-build [args...]")
  .description("Build contract.")
  .allowUnknownOption()
  .action((args) => contractBuildAction(args));

program
  .command("contract-test-rust")
  .description("Test contract with Rust tests.")
  .action(() => contractTestRustAction());

program
  .command("wallet-new")
  .description("Create a new wallet.")
  .requiredOption("--path <path>", "Wallet path")
  .action((options) => walletNewAction(options));

program
  .command("wallet-request-xegld")
  .description("Request 30 xEGLD (once per day).")
  .requiredOption("--path <path>", "Wallet path")
  .action((options) => walletRequestXegldAction(options));

const setupRustAction = () => {
  runCommand(
    "curl",
    [
      "--proto",
      "'=https'",
      "--tlsv1.2",
      "-sSf",
      "https://sh.rustup.rs",
      "|",
      "sh",
      "-s",
      "--",
      "--default-toolchain",
      "nightly-2023-03-14",
      "-y",
    ],
    "Installing Rust nightly..."
  );
  runCommand(
    "rustup",
    ["target", "add", "wasm32-unknown-unknown"],
    "Installing wasm32-unknown-unknown target..."
  );
  runCommand(
    "cargo",
    ["install", "multiversx-sc-meta"],
    "Installing multiversx-sc-meta crate..."
  );
};

const contractNewAction = async ({ dir }: { dir: string }) => {
  console.log("Creating a new blank contract...");
  const contract = "blank";
  const dirPath = path.resolve(cwd, dir);
  if (fs.existsSync(dirPath)) {
    console.log(chalk.red(`Contract already exists at ${dirPath}`));
    return;
  } else {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  await downloadAndExtractContract(dirPath, contract);
  console.log(chalk.green(`Contract created at ${dirPath}`));
};

const contractBuildAction = (args: string[]) => {
  runCommand("sc-meta", ["all", "build", ...args], "Building contract...");
};

const contractTestRustAction = () => {
  runCommand("cargo", ["test"], "Testing contract with Rust tests...");
};

const walletNewAction = async ({ path: walletPath }: { path: string }) => {
  console.log("Creating a new wallet...");
  const mnemonic = Mnemonic.generate().toString();
  const password = await inputHidden("Enter password: ");
  const passwordAgain = await inputHidden("Re-enter password: ");
  if (password !== passwordAgain) {
    console.log(chalk.red("Passwords do not match."));
    return;
  }
  const keystore = UserWallet.fromMnemonic({ mnemonic, password }).toJSON();
  const filePath = path.resolve(cwd, walletPath);
  if (fs.existsSync(filePath)) {
    console.log(chalk.red(`Wallet already exists at ${filePath}`));
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify(keystore), "utf8");
  console.log(chalk.green(`Wallet created at ${filePath}`));
};

const walletRequestXegldAction = async ({
  path: walletPath,
}: {
  path: string;
}) => {
  const filePath = path.resolve(cwd, walletPath);
  const keystore = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const password = await inputHidden("Enter password: ");
  const signer = UserSigner.fromWallet(keystore, password);
  console.log(`Claiming 30 xEGLD for address ${signer.getAddress()} ...`);
  const address = signer.getAddress().bech32();
  const balance = await getDevnetBalance(address);

  const client = new NativeAuthClient({
    origin: "https://devnet-wallet.multiversx.com",
    apiUrl: "https://devnet-api.multiversx.com",
  });
  const initToken = await client.initialize();
  const dataToSign = new SignableMessage({
    message: Buffer.from(`${address}${initToken}`, "utf8"),
  }).serializeForSigning();
  const signature = await signer
    .sign(dataToSign)
    .then((b) => b.toString("hex"));
  const accessToken = client.getToken(address, initToken, signature);

  const errorMessage = await fetch(
    "https://devnet-extras-api.multiversx.com/faucet",
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      method: "POST",
    }
  )
    .then((r) => r.json())
    .then((d) => {
      if (d["status"] !== "success") {
        return d["message"] as string;
      }
    });

  if (errorMessage) {
    console.log(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }

  let newBalance = balance;
  while (newBalance - balance < 30n * 10n ** 18n) {
    newBalance = await getDevnetBalance(address);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(chalk.green("Wallet well received 30 xEGLD."));
};

const getDevnetBalance = (address: string) =>
  fetch(`https://devnet-gateway.multiversx.com/address/${address}/balance`)
    .then((r) => r.json())
    .then((d) => BigInt(d["data"]["balance"]));

program.parse(process.argv);
