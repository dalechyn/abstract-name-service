import { AnsAssetEntry, AnsPoolEntry, AssetInfo, PoolId } from '../objects'
import { Exchange } from './exchange'
import { Network } from '../networks/network'

const OSMOSIS = 'Osmosis'

interface OsmosisOptions {
  poolUrl: string
  volumeUrl: string
}

export class Osmosis extends Exchange {
  options: OsmosisOptions

  private poolListCache: OsmosisPoolList | undefined

  constructor(options: OsmosisOptions) {
    super(OSMOSIS)
    this.options = options
    this.poolListCache = undefined
  }

  private async fetchPoolList(): Promise<OsmosisPoolList> {
    if (this.poolListCache) {
      return this.poolListCache
    }

    // retrieve all the pools
    const { poolUrl, volumeUrl } = this.options
    let poolList: OsmosisPoolList = await fetch(poolUrl).then((res) => res.json())

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
      pools: sortedPools.slice(0, volumeList.data.length),
    }
    this.poolListCache = poolList

    return poolList
  }

  private determinePoolType = ({
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

  async registerAssets(network: Network) {
    const poolList = await this.fetchPoolList()
    throw new Error('Not implemented')
    const ansAssetEntries: AnsAssetEntry[] = []

    // Register the assets in the pools
    poolList.pools
      .flatMap(({ pool_assets }) => pool_assets)
      .filter<PoolAssetsItem>((poolAsset): poolAsset is PoolAssetsItem => !!poolAsset)
      .forEach(({ token: { denom } }) => {
        // only add to ansAssetEntries if it's not already there
        // TODO: search chain-registry
        // const newEntry = new AnsAssetEntry(
        //   symbol,
        //   native ? AssetInfo.native(denom) : AssetInfo.cw20(token_address)
        // )
        // network.assetRegistry.register(newEntry)
      })

    return []
  }

  async registerPools(network: Network) {
    console.log(`Retrieving pools for ${this.name} on ${network.networkId}`)
    throw new Error('Not implemented')

    // const poolList = await this.fetchPoolList()
    // console.log(`Retrieved ${poolList.pools.length} pools for ${this.name} on ${network.networkId}`)
    //
    // poolList.pools.forEach((pool: OsmosisPool) => {
    //   const { pool_assets, id } = pool
    //
    //   const assets = pool_assets?.map(({ token }) => token).map(({ denom }) => denom.toLowerCase())
    //   if (!assets) return
    //   const poolType = this.determinePoolType(pool)
    //   if (!poolType) return
    //
    //   network.poolRegistry.register(
    //     new AnsPoolEntry(PoolId.id(+id), {
    //       dex: this.name.toLowerCase(),
    //       pool_type: poolType,
    //       assets,
    //     })
    //   )
    // })
  }
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
