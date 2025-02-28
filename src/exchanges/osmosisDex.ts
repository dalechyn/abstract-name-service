import { AnsPoolEntry, PoolId } from '../objects'
import { Exchange } from './exchange'
import { Network } from '../networks/network'
import { NotFoundError } from '../registry/IRegistry'

const OSMOSIS = 'Osmosis'

interface OsmosisOptions {
  poolUrl: string
  volumeUrl: string | undefined
}

const MAX_POOLS = 75

export class OsmosisDex extends Exchange {
  options: OsmosisOptions

  private poolListCache: OsmosisPoolList | undefined

  constructor(options: OsmosisOptions) {
    super(OSMOSIS)
    this.options = options
    this.poolListCache = undefined
  }

  async registerAssets(network: Network) {
    const poolList = await this.fetchPoolList()

    const ibcQueryClient = await network.ibcQueryClient()

    // Register the assets in the pools
    await Promise.all(
      poolList.pools
        .flatMap(({ pool_assets }) => pool_assets)
        .filter<PoolAssetsItem>((poolAsset): poolAsset is PoolAssetsItem => !!poolAsset)
        .map(async ({ token: { denom } }) => {
          // // only add to ansAssetEntries if it's not already there
          // // TODO: search chain-registry

          if (network.assetRegistry.hasDenom(denom)) return

          try {
            await network.registerNativeAsset({ denom })
          } catch (e) {
            console.log("couldn't find asset", denom, e)
          }

          // const newEntry = new AnsAssetEntry(
          //   symbol,
          //   native ? AssetInfo.native(denom) : AssetInfo.cw20(token_address)
          // )
          // network.assetRegistry.register(newEntry)
        })
    )

    return []
  }

  async registerPools(network: Network) {
    const poolList = await this.fetchPoolList()
    console.log(`Retrieved ${poolList.pools.length} pools for ${this.name} on ${network.networkId}`)

    poolList.pools.forEach((pool: OsmosisPool) => {
      const { pool_assets, id } = pool

      const poolDenoms = pool_assets?.map(({ token }) => token).map(({ denom }) => denom)
      if (!poolDenoms) return

      const poolType = this.determineOsmosisPoolType(pool)
      if (!poolType) return

      const poolId = PoolId.id(+id)

      let assetNames: string[]

      try {
        assetNames = network.assetRegistry.getNamesByDenoms(poolDenoms)
      } catch (e) {
        if (e instanceof NotFoundError) {
          console.log(`Skipping pool ${id} because not all denoms are registered`)
          network.poolRegistry.unknown(
            new AnsPoolEntry(poolId, {
              dex: this.name.toLowerCase(),
              pool_type: poolType,
              assets: poolDenoms,
            })
          )
          return
        }
        throw e
      }

      // TODO: confirm whether we are including staking contracts
      const stakingContract = this.stakingContractEntry(assetNames, id)

      try {
        network.contractRegistry.register(stakingContract)
      } catch (e) {
        console.warn(`Failed to register staking contract for pool ${id}: ${e}`)
        return
      }

      network.poolRegistry.register(
        new AnsPoolEntry(poolId, {
          dex: this.name.toLowerCase(),
          pool_type: poolType,
          assets: assetNames,
        })
      )
    })
  }

  /**
   * Fetch a list of osmosis pools and only take the highest ones by volume.
   */
  private async fetchPoolList(): Promise<OsmosisPoolList> {
    if (this.poolListCache) {
      return this.poolListCache
    }

    // retrieve all the pools
    const { poolUrl, volumeUrl } = this.options
    let poolList: OsmosisPoolList = await fetch(poolUrl).then((res) => res.json())

    // If the volumeUrl is specified, we sort the actual pools by volume
    if (volumeUrl) {
      // retrieve the highest volume pools, to sort the actual pools by volume
      const volumeList: OsmosisPoolVolumeList = await fetch(volumeUrl).then((res) => res.json())

      // sort the pools by volume
      const sortedPools = poolList.pools.sort((a, b) => {
        const aVolume = volumeList.data.find((pool) => pool.pool_id === a.id)?.volume_7d ?? 0
        const bVolume = volumeList.data.find((pool) => pool.pool_id === b.id)?.volume_7d ?? 0
        return bVolume - aVolume
      })

      poolList = {
        ...poolList,
        pools: sortedPools.slice(0, MAX_POOLS),
      }
    } else {
      // sort all pools by their weight in descending order
      const sortedPools = poolList.pools.sort((a, b) =>
        compareLargeNumbers(b.total_weight ?? '0', a.total_weight ?? '0')
      )

      const processedPairs = new Set()
      const uniquePoolList = []

      for (const pool of sortedPools) {
        if (!pool.pool_assets?.length) continue
        // only add pools with unique pairs
        const pair = pool.pool_assets
          .map(({ token }) => token.denom)
          .sort()
          .join(',')

        if (!processedPairs.has(pair)) {
          processedPairs.add(pair)
          uniquePoolList.push(pool)
        }
      }
      poolList = {
        ...poolList,
        pools: uniquePoolList,
      }
    }

    this.poolListCache = poolList

    return poolList
  }

  private determineOsmosisPoolType = ({
    pool_assets,
    pool_params,
    id,
  }: OsmosisPool): PoolType | undefined => {
    if (pool_assets?.length) {
      if (pool_params.smooth_weight_change_params) {
        return 'LiquidityBootstrap'
      }
      const weights = pool_assets.map(({ weight }) => weight)
      if (weights.every((weight) => weight === weights[0])) {
        return 'ConstantProduct'
      }
      return 'Weighted'
    }

    console.warn(`Id: ${id} has unknown pool type`, pool_assets, pool_params)
    return undefined
  }
}

/*
{
    "@type": "/osmosis.gamm.v1beta1.Pool",
    "address": "osmo1mw0ac6rwlp5r8wapwk3zs6g29h8fcscxqakdzw9emkne6c8wjp9q0t3v8t",
    "id": "1",
    "pool_params": {
      "swap_fee": "0.002000000000000000",
      "exit_fee": "0.000000000000000000",
      "smooth_weight_change_params": null
    },
    "future_pool_governor": "24h",
    "total_shares": {
      "denom": "gamm/pool/1",
      "amount": "202566047707685524082948766"
    },
    "pool_assets": [
      {
        "token": {
          "denom": "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
          "amount": "1813583742408"
        },
        "weight": "536870912000000"
      },
      {
        "token": {
          "denom": "uosmo",
          "amount": "32934163845630"
        },
        "weight": "536870912000000"
      }
    ],
    "total_weight": "1073741824000000"
  }
 */

function compareLargeNumbers(a: string, b: string) {
  // Assuming that a and b are string representations of potentially very large numbers
  if (a.length !== b.length) {
    return a.length - b.length
  } else {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return a[i] > b[i] ? 1 : -1
      }
    }
  }
  return 0 // They are equal
}

interface OsmosisPoolList {
  pools: OsmosisPool[]
  pagination: Pagination
}

interface OsmosisPool {
  '@type': string
  address: string
  id: string
  pool_params: Pool_params
  future_pool_governor: string
  total_shares: Total_shares
  pool_assets?: PoolAssetsItem[]
  total_weight?: string
  pool_liquidity?: PoolLiquidityItem[]
  scaling_factors?: string[]
  scaling_factor_controller?: string
}

interface Pool_params {
  swap_fee: string
  exit_fee: string
  smooth_weight_change_params?: null
}

interface Total_shares {
  denom: string
  amount: string
}

interface PoolAssetsItem {
  token: Token
  weight: string
}

interface Token {
  denom: string
  amount: string
}

interface PoolLiquidityItem {
  denom: string
  amount: string
}

interface Pagination {
  next_key: null
  total: string
}

interface OsmosisPoolVolumeList {
  last_update_at: number
  data: PoolVolumeItem[]
}

interface PoolVolumeItem {
  pool_id: string
  volume_24h: number
  volume_7d: number
  fees_spent_24h: number
  fees_spent_7d: number
  fees_percentage: string
}
