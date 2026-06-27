import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, formatEther, parseUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { BONDING_CURVE_AMM_ABI } from '../../common/abis/BondingCurveAMM.abi';

@Injectable()
export class OnchainQuoteService {
  private readonly logger = new Logger(OnchainQuoteService.name);
  private readonly client: any;

  constructor(private config: ConfigService) {
    const chainId = parseInt(config.get('CHAIN_ID', '84532'), 10);
    const chain = chainId === 8453 ? base : baseSepolia;
    const rpcUrl = config.get('RPC_URL', 'https://sepolia.base.org');

    this.client = createPublicClient({
      chain,
      transport: http(rpcUrl, { retryCount: 3, timeout: 10_000 }),
    });
  }

  async getBuyQuote(ammAddress: string, shareAmount: number) {
    const amount = parseUnits(String(shareAmount), 18);
    const [ethCost, totalCost] = await this.client.readContract({
      address: ammAddress as `0x${string}`,
      abi: BONDING_CURVE_AMM_ABI,
      functionName: 'getBuyPrice',
      args: [amount],
    }) as [bigint, bigint];

    const ethCostNum = parseFloat(formatEther(ethCost));
    const totalCostNum = parseFloat(formatEther(totalCost));

    return {
      ethAmount: ethCostNum.toString(),
      totalCost: totalCostNum.toString(),
      pricePerToken: shareAmount > 0 ? (ethCostNum / shareAmount).toString() : '0',
      newSupply: '', // not available from view function
      newSpotPrice: '',
      wouldGraduate: false,
      priceImpactPct: '0',
    };
  }

  async getSellQuote(ammAddress: string, shareAmount: number) {
    const amount = parseUnits(String(shareAmount), 18);
    const [ethOut, netEthOut] = await this.client.readContract({
      address: ammAddress as `0x${string}`,
      abi: BONDING_CURVE_AMM_ABI,
      functionName: 'getSellPrice',
      args: [amount],
    }) as [bigint, bigint];

    const ethOutNum = parseFloat(formatEther(ethOut));
    const netEthOutNum = parseFloat(formatEther(netEthOut));

    return {
      ethAmount: netEthOutNum.toString(),
      ethBeforeFee: ethOutNum.toString(),
      pricePerToken: shareAmount > 0 ? (netEthOutNum / shareAmount).toString() : '0',
      newSupply: '',
      newSpotPrice: '',
      wouldGraduate: false,
      priceImpactPct: '0',
    };
  }

  async getCurrentPrice(ammAddress: string): Promise<string> {
    const price = await this.client.readContract({
      address: ammAddress as `0x${string}`,
      abi: BONDING_CURVE_AMM_ABI,
      functionName: 'getCurrentPrice',
    }) as bigint;
    return formatEther(price);
  }
}
