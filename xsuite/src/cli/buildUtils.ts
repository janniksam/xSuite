import fs from "node:fs";
import path from "node:path";
import { logError } from "./helpers";

export const findBuildableContractDirs = (
  dir: string,
  ignore?: string,
  recursive?: boolean,
) => {
  const dirs: string[] = [];
  if (recursive) {
    const ignoreRegex = new RegExp(ignore ?? defaultIgnore);
    dirs.push(...findBuildableDirs(dir, ignoreRegex));
  } else {
    if (isDirBuildable(dir)) {
      dirs.push(dir);
    }
  }
  if (dirs.length === 0) {
    logError("No valid contract found.");
    return [];
  }

  return dirs;
};

export const defaultIgnore = "^(target|node_modules|(\\..*))$";

export const getUid = () => {
  return process.getuid ? process.getuid() : undefined;
};

export const getGid = () => {
  return process.getgid ? process.getgid() : undefined;
};

const findBuildableDirs = (startDir: string, ignoreRegex: RegExp) => {
  const results: string[] = [];
  if (isDirBuildable(startDir)) {
    results.push(startDir);
  } else {
    const files = fs.readdirSync(startDir);
    for (const file of files) {
      const p = path.join(startDir, file);
      if (fs.statSync(p).isDirectory()) {
        if (ignoreRegex.test(file)) continue;
        results.push(...findBuildableDirs(p, ignoreRegex));
      }
    }
  }
  return results;
};

const isDirBuildable = (p: string) => {
  const mvxJsonPath = path.join(p, "multiversx.json");
  const mvxJsonFileExists =
    fs.existsSync(mvxJsonPath) && fs.statSync(mvxJsonPath).isFile();
  const elrondJsonPath = path.join(p, "elrond.json");
  const elrondJsonFileExists =
    fs.existsSync(elrondJsonPath) && fs.statSync(elrondJsonPath).isFile();
  const metaPath = path.join(p, "meta");
  const metaDirExists =
    fs.existsSync(metaPath) && fs.statSync(metaPath).isDirectory();
  return (mvxJsonFileExists || elrondJsonFileExists) && metaDirExists;
};
