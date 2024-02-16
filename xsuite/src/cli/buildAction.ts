import path from "node:path";
import { Command } from "commander";
import { log } from "../_stdio";
import { defaultIgnore, findBuildableContractDirs } from "./buildUtils";
import { logTitle, logAndRunCommand } from "./helpers";

export const registerBuildCmd = (cmd: Command) => {
  cmd
    .command("build")
    .description("Build contract.")
    .option(
      "--ignore <IGNORE>",
      `Ignore all directories matching the RegExp (default: ${defaultIgnore})`,
    )
    .option(
      "--locked",
      "Require the Cargo.lock in the wasm crate to be up to date",
    )
    .option(
      "--dir <DIR>",
      "Directory in which the command is executed (default: $(PWD))",
    )
    .option("-r, --recursive", "Build all contracts under the directory")
    .option(
      "--target-dir <TARGET_DIR>",
      "Target directory used by Rust compiler (default: $(PWD)/target)",
    )
    .action(action);
};

const action = ({
  ignore,
  locked,
  dir,
  recursive,
  targetDir,
}: {
  ignore?: string;
  locked?: boolean;
  dir?: string;
  recursive?: boolean;
  targetDir?: string;
}) => {
  dir = dir ?? process.cwd();
  targetDir = targetDir ?? path.join(process.cwd(), "target");
  const dirs = findBuildableContractDirs(dir, ignore, recursive);

  const args = ["run", "--target-dir", targetDir, "build"];
  if (locked) {
    args.push("--locked");
  }
  args.push("--target-dir", targetDir);
  const numDirs = dirs.length;
  logTitle(`Building contract${numDirs > 1 ? "s" : ""}...`);
  for (const [i, dir] of dirs.entries()) {
    log(`(${i + 1}/${numDirs}) Building "${path.resolve(dir)}"...`);
    logAndRunCommand("cargo", args, { cwd: path.join(dir, "meta") });
  }
};
