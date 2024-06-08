import { e } from "../data";
import { zeroBechAddress } from "../data/address";
import {
  AddressLike,
  addressLikeToBechAddress,
  addressLikeToHexAddress,
} from "../data/addressLike";
import { BytesLike } from "../data/bytesLike";
import {
  Encodable,
  EncodableCodeMetadata,
  eCodeMetadata,
} from "../data/encoding";
import { Kvs } from "../data/kvs";
import { base64ToHex, u8aToHex } from "../data/utils";
import { Prettify } from "../helpers";

export class Proxy {
  proxyUrl: string;
  headers: HeadersInit;
  explorerUrl: string;

  constructor(params: ProxyParams) {
    params = typeof params === "string" ? { proxyUrl: params } : params;
    this.proxyUrl = params.proxyUrl;
    this.headers = params.headers ?? {};
    this.explorerUrl = params.explorerUrl ?? "";
  }

  fetchRaw(path: string, data?: any) {
    const baseUrl = this.proxyUrl;
    const init: RequestInit = { headers: this.headers };
    if (data !== undefined) {
      init.method = "POST";
      init.body = JSON.stringify(data);
    }
    return fetch(`${baseUrl}${path}`, init).then((r) => r.json());
  }

  async fetch(path: string, data?: any) {
    const res = await this.fetchRaw(path, data);
    if (res.code === "successful") {
      return res.data;
    } else {
      const resStr = JSON.stringify(res, null, 2);
      throw new Error(`Unsuccessful proxy request. Response: ${resStr}`);
    }
  }

  async sendTx(tx: BroadTx) {
    const res = await this.fetch("/transaction/send", await broadTxToRawTx(tx));
    return res.txHash as string;
  }

  sendTransfer({ receiver: _receiver, sender, esdts, ...tx }: TransferTx) {
    let receiver: AddressLike;
    let data: string | undefined;
    if (esdts?.length) {
      receiver = sender;
      const dataParts: string[] = [];
      dataParts.push("MultiESDTNFTTransfer");
      dataParts.push(addressLikeToHexAddress(_receiver));
      dataParts.push(e.U(esdts.length).toTopHex());
      for (const esdt of esdts) {
        dataParts.push(e.Str(esdt.id).toTopHex());
        dataParts.push(e.U(esdt.nonce ?? 0).toTopHex());
        dataParts.push(e.U(esdt.amount).toTopHex());
      }
      data = dataParts.join("@");
    } else {
      receiver = _receiver;
    }
    return this.sendTx({ receiver, sender, data, ...tx });
  }

  sendDeployContract({
    code,
    codeMetadata,
    codeArgs,
    ...tx
  }: DeployContractTx) {
    return this.sendTx({
      receiver: zeroBechAddress,
      data: [
        code,
        "0500",
        eCodeMetadata(codeMetadata),
        ...e.vs(codeArgs ?? []),
      ].join("@"),
      ...tx,
    });
  }

  sendCallContract({
    callee,
    sender,
    funcName,
    funcArgs,
    esdts,
    ...tx
  }: CallContractTx) {
    const dataParts: string[] = [];
    let receiver: AddressLike;
    if (esdts?.length) {
      receiver = sender;
      dataParts.push("MultiESDTNFTTransfer");
      dataParts.push(addressLikeToHexAddress(callee));
      dataParts.push(e.U(esdts.length).toTopHex());
      for (const esdt of esdts) {
        dataParts.push(e.Str(esdt.id).toTopHex());
        dataParts.push(e.U(esdt.nonce ?? 0).toTopHex());
        dataParts.push(e.U(esdt.amount).toTopHex());
      }
      dataParts.push(e.Str(funcName).toTopHex());
    } else {
      receiver = callee;
      dataParts.push(funcName);
    }
    dataParts.push(...e.vs(funcArgs ?? []));
    return this.sendTx({
      receiver,
      sender,
      data: dataParts.join("@"),
      ...tx,
    });
  }

  sendUpgradeContract({
    callee,
    code,
    codeMetadata,
    codeArgs,
    ...tx
  }: UpgradeContractTx) {
    return this.sendTx({
      receiver: callee,
      data: [
        "upgradeContract",
        code,
        eCodeMetadata(codeMetadata),
        ...e.vs(codeArgs ?? []),
      ].join("@"),
      ...tx,
    });
  }

  async awaitTx(txHash: string) {
    let res = await this.getTxProcessStatus(txHash);
    while (res === "pending") {
      await new Promise((r) => setTimeout(r, 1000));
      res = await this.getTxProcessStatus(txHash);
    }
  }

  async resolveTx(txHash: string): Promise<TxResult> {
    if ((await this.getTxProcessStatus(txHash)) === "pending") {
      throw new Error(pendingErrorMessage);
    }
    let tx = await this.getTx(txHash);
    const hash: string = tx.hash;
    const explorerUrl = `${this.explorerUrl}/transactions/${hash}`;
    tx = { explorerUrl, hash, ...tx };
    if (tx.status !== "success") {
      throw new TxError("errorStatus", tx.status, tx);
    }
    if (tx.executionReceipt?.returnCode) {
      const { returnCode, returnMessage } = tx.executionReceipt;
      throw new TxError(returnCode, returnMessage, tx);
    }
    const signalErrorEvent = tx?.logs?.events.find(
      (e: any) => e.identifier === "signalError",
    );
    if (signalErrorEvent) {
      const error = atob(signalErrorEvent.topics[1]);
      throw new TxError("signalError", error, tx);
    }
    const gasUsed: number = tx.gasUsed;
    const fee: bigint = BigInt(tx.fee);
    return { explorerUrl, hash, gasUsed, fee, tx };
  }

  resolveTransfer(txHash: string) {
    return this.resolveTx(txHash);
  }

  async resolveDeployContract(txHash: string): Promise<DeployContractResult> {
    const res = await this.resolveTx(txHash);
    const returnData = getTxReturnData(res.tx);
    const address = res.tx.logs.events.find(
      (e: any) => e.identifier === "SCDeploy",
    )!.address;
    return { ...res, returnData, address };
  }

  async resolveCallContract(txHash: string): Promise<CallContractResult> {
    const res = await this.resolveTx(txHash);
    const returnData = getTxReturnData(res.tx);
    return { ...res, returnData };
  }

  resolveUpgradeContract(txHash: string) {
    return this.resolveCallContract(txHash);
  }

  async executeTx(tx: BroadTx) {
    const txHash = await this.sendTx(tx);
    await this.awaitTx(txHash);
    return this.resolveTx(txHash);
  }

  async transfer(tx: TransferTx) {
    const txHash = await this.sendTransfer(tx);
    await this.awaitTx(txHash);
    return this.resolveTransfer(txHash);
  }

  async deployContract(tx: DeployContractTx) {
    const txHash = await this.sendDeployContract(tx);
    await this.awaitTx(txHash);
    return this.resolveDeployContract(txHash);
  }

  async callContract(tx: CallContractTx) {
    const txHash = await this.sendCallContract(tx);
    await this.awaitTx(txHash);
    return this.resolveCallContract(txHash);
  }

  async upgradeContract(tx: UpgradeContractTx) {
    const txHash = await this.sendUpgradeContract(tx);
    await this.awaitTx(txHash);
    return this.resolveUpgradeContract(txHash);
  }

  async query(query: BroadQuery): Promise<QueryResult> {
    const { data } = await this.fetch(
      "/vm-values/query",
      broadQueryToRawQuery(query),
    );
    if (![0, "ok"].includes(data.returnCode)) {
      throw new QueryError(data.returnCode, data.returnMessage, data);
    }
    return {
      returnData: data.returnData.map(base64ToHex),
      query: data,
    };
  }

  async getNetworkStatus(shard: number): Promise<NetworkStatus> {
    const { status } = await this.fetch(`/network/status/${shard}`);
    return {
      blockTimestamp: status.erd_block_timestamp,
      crossCheckBlockHeight: status.erd_cross_check_block_height,
      round: status.erd_current_round,
      epoch: status.erd_epoch_number,
      highestFinalNonce: status.erd_highest_final_nonce,
      nonce: status.erd_nonce,
      nonceAtEpochStart: status.erd_nonce_at_epoch_start,
      noncesPassedInCurrentEpoch: status.erd_nonces_passed_in_current_epoch,
      roundAtEpochStart: status.erd_round_at_epoch_start,
      roundsPassedInCurrentEpoch: status.erd_rounds_passed_in_current_epoch,
      roundsPerEpoch: status.erd_rounds_per_epoch,
    };
  }

  getTx(txHash: string) {
    return this._getTx(txHash, { withResults: true });
  }

  getTxWithoutResults(txHash: string) {
    return this._getTx(txHash, { withResults: false });
  }

  private async _getTx(txHash: string, { withResults }: TxRequestOptions = {}) {
    let path = `/transaction/${txHash}`;
    if (withResults) path += "?withResults=true";
    const res = await this.fetch(path);
    return res.transaction as Record<string, any>;
  }

  async getTxProcessStatus(txHash: string) {
    const res = await this.fetch(`/transaction/${txHash}/process-status`);
    return res.status as string;
  }

  async getAccountNonce(
    address: AddressLike,
    { shardId }: AccountRequestOptions = {},
  ) {
    let path = `/address/${addressLikeToBechAddress(address)}/nonce`;
    if (shardId !== undefined) path += `?forced-shard-id=${shardId}`;
    const res = await this.fetch(path);
    return res.nonce as number;
  }

  async getAccountBalance(
    address: AddressLike,
    { shardId }: AccountRequestOptions = {},
  ) {
    let path = `/address/${addressLikeToBechAddress(address)}/balance`;
    if (shardId !== undefined) path += `?forced-shard-id=${shardId}`;
    const res = await this.fetch(path);
    return BigInt(res.balance);
  }

  async getAccountKvs(
    address: AddressLike,
    { shardId }: AccountRequestOptions = {},
  ) {
    let path = `/address/${addressLikeToBechAddress(address)}/keys`;
    if (shardId !== undefined) path += `?forced-shard-id=${shardId}`;
    const res = await this.fetch(path);
    return res.pairs as Kvs;
  }

  async getSerializableAccountWithoutKvs(
    address: AddressLike,
    { shardId }: AccountRequestOptions = {},
  ) {
    let path = `/address/${addressLikeToBechAddress(address)}`;
    if (shardId !== undefined) path += `?forced-shard-id=${shardId}`;
    const res = await this.fetch(path);
    return getSerializableAccount(res.account);
  }

  getSerializableAccount(
    address: AddressLike,
    options?: AccountRequestOptions,
  ) {
    // TODO-MvX: When ?withKeys=true out, rewrite this part
    return Promise.all([
      this.getSerializableAccountWithoutKvs(address, options),
      this.getAccountKvs(address, options),
    ]).then(([account, kvs]) => ({ ...account, kvs }));
  }

  async getAccountWithoutKvs(
    address: AddressLike,
    options?: AccountRequestOptions,
  ) {
    const { balance, ...account } = await this.getSerializableAccountWithoutKvs(
      address,
      options,
    );
    return { balance: BigInt(balance), ...account };
  }

  getAccount(address: AddressLike, options?: AccountRequestOptions) {
    // TODO-MvX: When ?withKeys=true out, rewrite this part
    return Promise.all([
      this.getAccountWithoutKvs(address, options),
      this.getAccountKvs(address, options),
    ]).then(([account, kvs]) => ({ ...account, kvs }));
  }

  /**
   * @deprecated Use `.getSerializableAccount` instead.
   */
  getSerializableAccountWithKvs(address: AddressLike) {
    return this.getSerializableAccount(address);
  }

  /**
   * @deprecated Use `.getAccount` instead.
   */
  getAccountWithKvs(address: AddressLike) {
    return this.getAccount(address);
  }
}

export class InteractionError extends Error {
  interaction: string;
  code: number | string;
  msg: string;
  result: any;

  constructor(
    interaction: string,
    code: number | string,
    message: string,
    result: any,
  ) {
    super(
      `${interaction} failed: ${code} - ${message} - Result:\n` +
        JSON.stringify(result, null, 2),
    );
    this.interaction = interaction;
    this.code = code;
    this.msg = message;
    this.result = result;
  }
}

class TxError extends InteractionError {
  constructor(code: number | string, message: string, result: any) {
    super("Transaction", code, message, result);
  }
}

class QueryError extends InteractionError {
  constructor(code: number | string, message: string, result: any) {
    super("Query", code, message, result);
  }
}

const broadTxToRawTx = async (tx: BroadTx): Promise<RawTx> => {
  if (isRawTx(tx)) {
    return tx;
  }
  const unsignedRawTx = {
    nonce: tx.nonce,
    value: (tx.value ?? 0n).toString(),
    receiver: addressLikeToBechAddress(tx.receiver),
    sender: addressLikeToBechAddress(tx.sender),
    gasPrice: tx.gasPrice,
    gasLimit: tx.gasLimit,
    data: tx.data === undefined ? undefined : btoa(tx.data),
    chainID: tx.chainId,
    version: tx.version ?? 1,
  };
  const signature = await tx.sender
    .sign(new TextEncoder().encode(JSON.stringify(unsignedRawTx)))
    .then(u8aToHex);
  return { ...unsignedRawTx, signature };
};

const isRawTx = (tx: BroadTx): tx is RawTx => typeof tx.sender === "string";

const broadQueryToRawQuery = (query: BroadQuery): RawQuery => {
  if ("callee" in query) {
    query = {
      scAddress: addressLikeToBechAddress(query.callee),
      funcName: query.funcName,
      args: e.vs(query.funcArgs ?? []),
      caller:
        query.sender !== undefined
          ? addressLikeToBechAddress(query.sender)
          : undefined,
      value: query.value !== undefined ? query.value.toString() : undefined,
    };
  }
  return query;
};

export const getSerializableAccount = (rawAccount: any) => {
  return {
    address: rawAccount.address,
    nonce: rawAccount.nonce,
    balance: rawAccount.balance,
    code: rawAccount.code,
    codeHash: base64ToHex(rawAccount.codeHash ?? ""),
    codeMetadata: base64ToHex(rawAccount.codeMetadata ?? ""),
    owner: rawAccount.ownerAddress,
    kvs: rawAccount.pairs ?? {},
  } as {
    address: string;
    nonce: number;
    balance: string;
    code: string;
    codeMetadata: string;
    codeHash: string;
    owner: string;
    kvs: Kvs;
  };
};

const getTxReturnData = (tx: any): string[] => {
  const writeLogEvent = tx?.logs?.events.find(
    (e: any) => e.identifier === "writeLog",
  );
  if (writeLogEvent) {
    return atob(writeLogEvent.data).split("@").slice(2);
  }
  const scr = tx?.smartContractResults.find(
    (r: any) => r.data === "@6f6b" || r.data?.startsWith("@6f6b@"),
  );
  if (scr) {
    return scr.data.split("@").slice(2);
  }
  return [];
};

export const getValuesInOrder = <T>(o: Record<string, T>) => {
  const values: T[] = [];
  for (let i = 0; i < Object.keys(o).length; i++) {
    values.push(o[i]);
  }
  return values;
};

export const pendingErrorMessage = "Transaction still pending.";

export type ProxyParams =
  | string
  | { proxyUrl: string; headers?: HeadersInit; explorerUrl?: string };

type BroadTx = Tx | RawTx;

export type Tx = {
  nonce: number;
  value?: number | bigint;
  receiver: AddressLike;
  sender: Signer;
  gasPrice: number;
  gasLimit: number;
  data?: string;
  chainId: string;
  version?: number;
};

export type TransferTx = {
  nonce: number;
  value?: number | bigint;
  receiver: AddressLike;
  sender: Signer;
  gasPrice: number;
  gasLimit: number;
  esdts?: { id: string; nonce?: number; amount: number | bigint }[];
  chainId: string;
  version?: number;
};

export type DeployContractTx = {
  nonce: number;
  value?: number | bigint;
  sender: Signer;
  gasPrice: number;
  gasLimit: number;
  code: string;
  codeMetadata: EncodableCodeMetadata;
  codeArgs?: BytesLike[];
  chainId: string;
  version?: number;
};

export type CallContractTx = {
  nonce: number;
  value?: number | bigint;
  callee: AddressLike;
  sender: Signer;
  gasPrice: number;
  gasLimit: number;
  funcName: string;
  funcArgs?: BytesLike[];
  esdts?: { id: string; nonce?: number; amount: number | bigint }[];
  chainId: string;
  version?: number;
};

export type UpgradeContractTx = {
  nonce: number;
  value?: number | bigint;
  callee: AddressLike;
  sender: Signer;
  gasPrice: number;
  gasLimit: number;
  code: string;
  codeMetadata: EncodableCodeMetadata;
  codeArgs?: BytesLike[];
  chainId: string;
  version?: number;
};

type RawTx = {
  nonce: number;
  value: string;
  receiver: string;
  sender: string;
  gasPrice: number;
  gasLimit: number;
  data?: string;
  signature: string;
  chainID: string;
  version: number;
};

type BroadQuery = Query | RawQuery;

type Signer = Encodable & { sign: (data: Uint8Array) => Promise<Uint8Array> };

export type Query = {
  callee: AddressLike;
  funcName: string;
  funcArgs?: BytesLike[];
  sender?: AddressLike;
  value?: number | bigint;
};

type RawQuery = {
  scAddress: string;
  funcName: string;
  args: string[];
  caller?: string;
  value?: string;
};

type TxRequestOptions = { withResults?: boolean };

type AccountRequestOptions = { shardId?: number };

type TxResult = Prettify<{
  hash: string;
  explorerUrl: string;
  gasUsed: number;
  fee: bigint;
  tx: { [x: string]: any };
}>;

type DeployContractResult = Prettify<
  TxResult & {
    returnData: string[];
    address: string;
  }
>;

type CallContractResult = Prettify<TxResult & { returnData: string[] }>;

type QueryResult = {
  returnData: string[];
  query: { [x: string]: any };
};

type NetworkStatus = {
  blockTimestamp: number;
  crossCheckBlockHeight: string;
  round: number;
  epoch: number;
  highestFinalNonce: number;
  nonce: number;
  nonceAtEpochStart: number;
  noncesPassedInCurrentEpoch: number;
  roundAtEpochStart: number;
  roundsPassedInCurrentEpoch: number;
  roundsPerEpoch: number;
};
