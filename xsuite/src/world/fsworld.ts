import { ChildProcess, spawn } from "node:child_process";
import { fsproxyBinaryPath, fsproxyConfigsPath } from "@xsuite/full-simulnet";
import { AddressLike, isAddressLike } from "../data/addressLike";
import { EncodableAccount } from "../data/encoding";
import { Prettify, Replace } from "../helpers";
import { FSProxy } from "../proxy";
import { DummySigner, Signer } from "./signer";
import { AddressLikeParams, createAddressLike } from "./utils";
import {
  World,
  Contract,
  Wallet,
  expandCode,
  WalletDeployContractTx,
  WorldNewOptions,
  WorldDeployContractTx,
} from "./world";

export class FSWorld extends World {
  proxy: FSProxy;
  server?: ChildProcess;

  constructor({
    proxy,
    gasPrice,
    explorerUrl,
    server,
  }: {
    proxy: FSProxy;
    gasPrice: number;
    explorerUrl?: string;
    server?: ChildProcess;
  }) {
    super({ chainId: "chain", proxy, gasPrice, explorerUrl });
    this.proxy = proxy;
    this.server = server;
  }

  static new(options: FSWorldNewOptions) {
    if (options.chainId !== undefined) {
      throw new Error("chainId is not undefined.");
    }
    const { proxyUrl, gasPrice, explorerUrl, server } = options;
    return new FSWorld({
      proxy: new FSProxy({ proxyUrl, explorerUrl }),
      gasPrice: gasPrice ?? 1_000_000_000,
      explorerUrl,
      server,
    });
  }

  static newDevnet(): World {
    throw new Error("newDevnet is not implemented.");
  }

  static newTestnet(): World {
    throw new Error("newTestnet is not implemented.");
  }

  static newMainnet(): World {
    throw new Error("newMainnet is not implemented.");
  }

  static async start({
    gasPrice,
    explorerUrl,
    binaryPath,
    binaryPort,
    binaryConfigPath,
    proxyConfigsPath,
    nodeConfigsPath,
    nodeOverrideConfigPath,
    nodeOverrideConfigPaths,
    downloadConfigs,
  }: {
    gasPrice?: number;
    explorerUrl?: string;
    binaryPath?: string;
    binaryPort?: number;
    binaryConfigPath?: string;
    proxyConfigsPath?: string;
    nodeConfigsPath?: string;
    nodeOverrideConfigPath?: string;
    nodeOverrideConfigPaths?: string[];
    downloadConfigs?: boolean;
  } = {}): Promise<FSWorld> {
    binaryPath ??= fsproxyBinaryPath;
    binaryPort ??= 0;
    binaryConfigPath ??= `${fsproxyConfigsPath}/config.toml`;
    proxyConfigsPath ??= `${fsproxyConfigsPath}/proxy/config`;
    nodeConfigsPath ??= `${fsproxyConfigsPath}/node/config`;
    nodeOverrideConfigPaths ??= [
      `${fsproxyConfigsPath}/nodeOverrideDefault.toml`,
      `${fsproxyConfigsPath}/nodeOverride.toml`,
    ];
    if (nodeOverrideConfigPath !== undefined) {
      nodeOverrideConfigPaths.push(nodeOverrideConfigPath);
    }

    const args: string[] = [
      "--server-port",
      `${binaryPort}`,
      "--config",
      binaryConfigPath,
      "--proxy-configs",
      proxyConfigsPath,
      "--node-configs",
      nodeConfigsPath,
    ];
    if (nodeOverrideConfigPaths.length > 0) {
      args.push("--node-override-config", nodeOverrideConfigPaths.join(","));
    }
    if (!downloadConfigs) {
      args.push("--skip-configs-download");
    }
    const server = spawn(binaryPath, args);

    server.stderr.on("data", (data: Buffer) => {
      throw new Error(data.toString());
    });

    server.on("error", (error) => {
      throw error;
    });

    const proxyUrl = await new Promise<string>((resolve) => {
      server.stdout.on("data", (data: Buffer) => {
        const addressRegex =
          /chain simulator's is accessible through the URL ([\w\d.:]+)/;
        const match = data.toString().match(addressRegex);
        if (match) {
          resolve(`http://${match[1]}`);
        }
      });
    });

    return FSWorld.new({ proxyUrl, gasPrice, explorerUrl, server });
  }

  newWallet(addressOrSigner: AddressLike | Signer): FSWallet {
    return new FSWallet({
      signer: isAddressLike(addressOrSigner)
        ? new DummySigner(addressOrSigner)
        : addressOrSigner,
      world: this,
    });
  }

  newContract(address: AddressLike): FSContract {
    return new FSContract({ address, world: this });
  }

  async createWallets(createAccountsParams: FSWorldCreateAccountParams[]) {
    const setAccountsParams = createAccountsParams.map(
      ({ address, ...params }) => ({
        address: createAddressLike("wallet", address),
        ...params,
      }),
    );
    await this.setAccounts(setAccountsParams);
    return setAccountsParams.map((a) => this.newWallet(a.address));
  }

  async createWallet(params: FSWorldCreateAccountParams = {}) {
    return this.createWallets([params]).then((wallets) => wallets[0]);
  }

  async createContracts(createAccountsParams: FSWorldCreateAccountParams[]) {
    const setAccountsParams = createAccountsParams.map(
      ({ address, ...params }) => ({
        address: createAddressLike("vmContract", address),
        ...params,
      }),
    );
    await this.setAccounts(setAccountsParams);
    return setAccountsParams.map((a) => this.newContract(a.address));
  }

  async createContract(params: FSWorldCreateAccountParams = {}) {
    return this.createContracts([params]).then((contracts) => contracts[0]);
  }

  getInitialAddresses() {
    return this.proxy.getInitialAddresses();
  }

  setAccounts(params: FSWorldSetAccountsParams) {
    for (const _params of params) {
      if (_params.code !== undefined) {
        _params.code = expandCode(_params.code);
      }
    }
    return this.proxy.setAccounts(params);
  }

  setAccount(params: FSWorldSetAccountParams) {
    return this.setAccounts([params]);
  }

  generateBlocks(numBlocks: number) {
    return this.proxy.generateBlocks(numBlocks);
  }

  advanceToEpoch(epoch: number) {
    return this.proxy.advanceToEpoch(epoch);
  }

  async advanceEpoch(epochs: number) {
    const status = await this.proxy.getNetworkStatus(0);
    return this.advanceToEpoch(status.epoch + epochs);
  }

  processTx(txHash: string) {
    return this.proxy.processTx(txHash);
  }

  resolveDeployContracts(txHashes: string[]) {
    return super
      .resolveDeployContracts(txHashes)
      .then((rs) => rs.map((r) => this.addContractPostTx(r)));
  }

  resolveDeployContract(txHash: string) {
    return super
      .resolveDeployContract(txHash)
      .then((r) => this.addContractPostTx(r));
  }

  protected addContractPostTx<T extends { address: string }>(
    res: T,
  ): Prettify<Replace<T, { contract: FSContract }>> {
    return { ...res, contract: this.newContract(res.address) };
  }

  deployContracts(txs: WorldDeployContractTx[]) {
    return super
      .deployContracts(txs)
      .then((rs) => rs.map((r) => this.addContractPostTx(r)));
  }

  deployContract(tx: WorldDeployContractTx) {
    return super.deployContract(tx).then((r) => this.addContractPostTx(r));
  }

  terminate() {
    if (!this.server) throw new Error("No server defined.");
    this.server.kill();
  }

  [Symbol.dispose]() {
    this.terminate();
  }
}

export class FSWallet extends Wallet {
  world: FSWorld;

  constructor({ signer, world }: { signer: Signer; world: FSWorld }) {
    super({ signer, world });
    this.world = world;
  }

  setAccount(params: FSAccountSetAccountParams) {
    return this.world.setAccount({ ...params, address: this });
  }

  createContract(params?: FSWalletCreateContractParams) {
    return this.world.createContract({ ...params, owner: this });
  }

  deployContract(tx: WalletDeployContractTx) {
    return this.world.deployContract({ ...tx, sender: this });
  }
}

export class FSContract extends Contract {
  world: FSWorld;

  constructor({ address, world }: { address: AddressLike; world: FSWorld }) {
    super({ address, world });
    this.world = world;
  }

  setAccount(params: FSAccountSetAccountParams) {
    return this.world.setAccount({ ...params, address: this });
  }
}

type FSWorldNewOptions =
  | {
      chainId?: undefined;
      proxyUrl: string;
      gasPrice?: number;
      explorerUrl?: string;
      server?: ChildProcess;
    }
  | WorldNewOptions;

type FSWorldCreateAccountParams = Prettify<
  Replace<EncodableAccount, { address?: AddressLikeParams }>
>;

type FSWorldSetAccountsParams = EncodableAccount[];

type FSWorldSetAccountParams = EncodableAccount;

type FSAccountSetAccountParams = Prettify<
  Omit<FSWorldSetAccountParams, "address">
>;

type FSWalletCreateContractParams = Prettify<
  Omit<FSWorldCreateAccountParams, "owner">
>;
