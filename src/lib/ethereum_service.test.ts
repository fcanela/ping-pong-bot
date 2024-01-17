import EthereumService, {
  type SpecificProvider
} from './ethereum_service';
import config from './config';
import {
  generateRandomHash,
  generateRandomAddress,
  mockFeeData,
} from './test_utils';
import type {
  TransactionResponse,
  JsonRpcProvider,
  Wallet,
} from 'ethers';

jest.mock('./logger');

describe('EthereumService', () => {
  let client: EthereumService;

  beforeEach(() => {
    client = new EthereumService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBlockNumber', () => {
    it('should return the current block number', async () => {
      const blockNumber = await client.getBlockNumber();
      expect(typeof blockNumber).toStrictEqual('number');
    });
  });

  describe('getPings', () => {
    it('should return the pings between two blocks', async () => {
      const fromBlock = 7662370;
      const toBlock = 7662434;
      const pings = await client.getPings(fromBlock, toBlock);
      
      expect(pings).toHaveLength(3);
      expect(pings.every(({ topics }) => topics[0] === EthereumService['PING_TOPIC']));
    });
  
  });

  describe('getPongs', () => {
    it('should return the pongs between two blocks', async () => {
      const fromBlock = 7662425;
      const toBlock = 7662435;
      const pongs = await client.getPongs(fromBlock, toBlock);

      expect(pongs).toHaveLength(2);
      expect(pongs.every(({ topics }) => topics[0] === EthereumService['PONG_TOPIC']));
    });
  });

  describe('getNonce', () => {
    it('should return the next transaction nonce', async () => {
      const nonce = await client.getNonce();
      expect(typeof nonce).toStrictEqual('number');
    });
  });

  describe('refreshFeeData', () => {
    it('should store the current ethers estimation', async () => {
      await client.refreshFeeData();

      expect(typeof client['feeData']!.maxFeePerGas).toStrictEqual('bigint');
      expect(typeof client['feeData']!.maxPriorityFeePerGas).toStrictEqual('bigint');
    });
  });

  describe('pong', () => {
    let mockPong: jest.Mock;
    const expectedPongHash = generateRandomHash();

    beforeEach(() => {
      // @ts-ignore
      mockPong = client['contract'].pong = jest.fn().mockResolvedValue({
        hash: expectedPongHash,
      });
    });

    it('should fetch the current nonce if none provided', async () => {
      const expectedNonce = 42;
      const mockGetNonce = client['wallet'].getNonce = jest.fn().mockResolvedValue(expectedNonce);

      await client.pong(generateRandomHash());

      expect(mockGetNonce).toHaveBeenCalledTimes(1);
      expect(mockPong).toHaveBeenCalledTimes(1);
      expect(mockPong.mock.calls[0][1]).toMatchObject({
        nonce: expectedNonce
      });
    });
    
    it('should issue a pong', async () => {
      const returned = await client.pong(generateRandomHash());
      expect(mockPong).toHaveBeenCalledTimes(1);
      expect(returned).toMatchObject({ pongHash: expectedPongHash });
    });

    it('should use the cached fee data', async () => {
      client['feeData'] = mockFeeData;

      await client.pong(generateRandomHash());
      expect(mockPong).toHaveBeenCalledTimes(1);
      expect(mockPong.mock.calls[0][1]).toMatchObject(mockFeeData);
    });
  });

  describe('getTransaction', () => {
    it('should return an existing transaction', async () => {
      const tx = await client.getTransaction('0x2cdae8a0ceee198b731ddc4ec68e7041d6cac14182dae0c61a0d2264c4f53127');
      expect(tx).toMatchObject({
        blockNumber: 7552465,
        blockHash: "0x2209fd0a18e89d17ec1fa0c5bb220af3405c415da3bcf8605aa25f20a575546f",
        data: "0x5c36b186",
        from: "0x29c99683Eb509800998DDbbA7268A249D1dFF4cf",
        gasPrice: 2500000014n,
        hash: "0x2cdae8a0ceee198b731ddc4ec68e7041d6cac14182dae0c61a0d2264c4f53127",
        maxFeePerGas: 2500000026n,
        maxPriorityFeePerGas: 2500000000n,
        nonce: 1,
        to: "0x7D3a625977bFD7445466439E60C495bdc2855367",
      });
    });
  });

  describe('searchMempoolTransaction', () => {
    const createSpecificProvider = (name: string, returns?: TransactionResponse): SpecificProvider  => ({
      name,
      provider: {
        getTransaction: jest.fn().mockResolvedValueOnce(returns || null),
      } as any as JsonRpcProvider,
      wallet: {} as Wallet,
    });

    it('should return the transaction when found in one of the providers', async () => {
      const hash = generateRandomHash();
      const mockTransaction = {
        hash,
        from: generateRandomAddress(),
        to: generateRandomAddress(),
        nonce: 42,
      } as TransactionResponse;

      client['specificProviders'] = [
        createSpecificProvider('returns nothing'),
        createSpecificProvider('also returns nothing'),
        createSpecificProvider('right provider', mockTransaction),
      ];

      const result = await client.searchMempoolTransaction(hash); 
      expect(result).toBeDefined();
      expect(result!.providerName).toBe('right provider');
      expect(result!.transaction).toMatchObject(mockTransaction);
    });

    it('should return undefined if no provider finds it', async () => {
      client['specificProviders'] = [
        createSpecificProvider('finds nothing'),
        createSpecificProvider('finds nothing 2'),
        createSpecificProvider('finds nothing 3'),
      ];

      const result = await client.searchMempoolTransaction(generateRandomHash()); 
      expect(result).toBeUndefined();
    });
  });

  describe('calculateTransactionBumpFees', () => {
    it('should return null when the provided fees are enough', () => {
      client['feeData'] = {
        maxFeePerGas: 3n,
        maxPriorityFeePerGas: 1n,
      };

      const result = client.calculateTransactionBumpFees({
        blockNumber: null,
        maxFeePerGas: 12n,
        maxPriorityFeePerGas: 3n,
      } as TransactionResponse);

      expect(result).toBeNull();
    });

    it('should return the new estimated fees when both has increase', () => {
      client['feeData'] = {
        maxFeePerGas: 12n,
        maxPriorityFeePerGas: 3n,
      };

      const result = client.calculateTransactionBumpFees({
        blockNumber: null,
        maxFeePerGas: 3n,
        maxPriorityFeePerGas: 1n,
      } as TransactionResponse);

      expect(result).toMatchObject(client['feeData']);
    });

    it('should increase the fees when the estimated maxFeePerGas has increased', () => {
      client['feeData'] = {
        maxFeePerGas: 12n,
        maxPriorityFeePerGas: 1n,
      };

      const result = client.calculateTransactionBumpFees({
        blockNumber: null,
        maxFeePerGas: 3n,
        maxPriorityFeePerGas: 1n,
      } as TransactionResponse);

      expect(result).toMatchObject(client['feeData']);
    });

    it('should increase the fees when the estimated maxPriorityFeePerGas has increased', () => {
      client['feeData'] = {
        maxFeePerGas: 5n,
        maxPriorityFeePerGas: 2n,
      };

      const result = client.calculateTransactionBumpFees({
        blockNumber: null,
        maxFeePerGas: 5n,
        maxPriorityFeePerGas: 1n,
      } as TransactionResponse);

      expect(result).toMatchObject({
        // cant be 5n because it needs to be a 10% higher
        maxFeePerGas: 6n,
        maxPriorityFeePerGas: 2n,
      });
    });


    it('should ensure the maxFeePerGas it at least a 10% more rounded up when a bump is needed', () => {
      client['feeData'] = {
        maxFeePerGas: 12n,
        maxPriorityFeePerGas: 6n,
      };

      const result = client.calculateTransactionBumpFees({
        maxFeePerGas: 11n,
        maxPriorityFeePerGas: 3n,
      } as TransactionResponse);

      expect(result).toMatchObject({
        maxFeePerGas: 13n,
        maxPriorityFeePerGas: 6n,
      });
    });

    it('should fail when there is no fee data cached', () => {
      expect(() => {
        client.calculateTransactionBumpFees({
          maxFeePerGas: 3n,
          maxPriorityFeePerGas: 1n
        } as TransactionResponse)
      }).toThrow(/refreshFeeData/);
    });
  });
  
  describe('bumpTransactionFees', () => {
    it('should provide extra fees to an existing transaction', async () => {
      const tx = {
        from: client.getWalletAddress(),
        to: config.CONTRACT_ADDRESS,
        data: `${EthereumService.PONG_SELECTOR}${generateRandomAddress().slice(2)}`,
        nonce: 33,
        maxPriorityFeePerGas: 1n,
        maxFeePerGas: 3n,
      };

      const mockProvider = {
        name: 'test provider',
        provider: {} as any as JsonRpcProvider,
        wallet: {
          sendTransaction: jest.fn().mockResolvedValue({
            ...tx,
            ...mockFeeData,
          }),
        } as any as Wallet,
      };
      client['specificProviders'] = [mockProvider];
      
      await client.bumpTransactionFees(tx as TransactionResponse, mockFeeData, mockProvider.name);

      expect(mockProvider.wallet.sendTransaction).toHaveBeenCalledTimes(1);
      const [call] = (mockProvider.wallet.sendTransaction as jest.Mock).mock.calls;
      expect(call[0]).toMatchObject({
        ...tx,
        ...mockFeeData,
      });
    });

    it('should fail if the provider name does not exist', async () => {
      client['specificProviders'] = [];

      const tx = {
        from: client.getWalletAddress(),
        to: config.CONTRACT_ADDRESS,
        data: `${EthereumService.PONG_SELECTOR}${generateRandomAddress().slice(2)}`,
        nonce: 33,
        ...mockFeeData,
      } as TransactionResponse;

      return expect(client.bumpTransactionFees(tx, mockFeeData, 'unexisting provider name')).rejects.toThrow(/provider name/);
    });
  });

  describe('getWalletAddress', () => {
    it('should return the wallet address', () => {
      const address = client.getWalletAddress();
      expect(typeof address).toStrictEqual('string');
    });
  });

  describe('getMyMempoolPongs', () => {
    it('should return my pong transactions while ignoring all the others', async () => {
      const myPongHash = generateRandomHash();
      const someoneElsePongHash = generateRandomHash();
      const aPingHash = generateRandomHash();
      const unrelatedTxHash = generateRandomHash();

      const answeredPing = {
        hash: generateRandomHash(),
        blockNumber: 33,
        form: client.getWalletAddress(),
        to: config.CONTRACT_ADDRESS,
        data: '0x5c36b186'
      };

      const mempool = {
        [myPongHash]: {
          hash: myPongHash,
          from: client.getWalletAddress(),
          to: config.CONTRACT_ADDRESS,
          nonce: 42,
          data: `0x05ba79a2${answeredPing.hash.slice(2)}`,
        },
        [someoneElsePongHash]: {
          hash: someoneElsePongHash,
          from: generateRandomAddress(),
          to: config.CONTRACT_ADDRESS,
          data: `0x05ba79a2${answeredPing.hash.slice(2)}`,
        },
        [aPingHash]: {
          hash: aPingHash,
          from: generateRandomAddress(),
          to: config.CONTRACT_ADDRESS,
          data: '0x5c36b186',
        },
        [unrelatedTxHash]: {
          hash: unrelatedTxHash,
          from: generateRandomAddress(),
          to: generateRandomAddress(),
        },
      };

      const mockSpecificProvider = {
        name: 'test provider',
        provider: {
          send: jest.fn().mockResolvedValue({
            transactions: Object.keys(mempool),
          }),
          getTransaction: jest.fn().mockImplementation((hash) => {
            if (mempool[hash]) return mempool[hash];
            if (hash === answeredPing.hash) return answeredPing;
            throw new Error('Unexpected transaction hash');
          }),
        } as any as JsonRpcProvider,
        wallet: {} as any as Wallet,
      };

      client['specificProviders'] = [mockSpecificProvider];

      const result = await client.getMyMempoolPongs();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        pingHash: answeredPing.hash,
        pingBlock: answeredPing.blockNumber,
        pongHash: myPongHash,
        pongNonce: mempool[myPongHash].nonce,
      });
    });

    it('should continue working if the mempool transaction can not be retrieved (happens frequently with Infura)', async () => {
      const myPongHash = generateRandomHash();

      const mempool = {
        [myPongHash]: {
          hash: myPongHash,
          from: client.getWalletAddress(),
          to: config.CONTRACT_ADDRESS,
          nonce: 42,
          data: `0x05ba79a2${generateRandomHash().slice(2)}`,
        },
      };

      const mockSpecificProvider = {
        name: 'test provider',
        provider: {
          send: jest.fn().mockResolvedValue({
            transactions: Object.keys(mempool),
          }),
          getTransaction: jest.fn().mockResolvedValue(null),
        } as any as JsonRpcProvider,
        wallet: {} as any as Wallet,
      };

      client['specificProviders'] = [mockSpecificProvider];

      await client.getMyMempoolPongs();
    });
  });
});
