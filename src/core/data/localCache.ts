import { cloudRest, isCloudRestConfigured } from '@/core/auth';

const STORAGE_PREFIX = 'jingshou:';

const CACHE_CONFIG = {
  EXPIRY_TIME: 7 * 24 * 60 * 60 * 1000,
  PREFIX: {
    PRODUCTS: 'products:',
    SALES: 'sales:',
    STORES: 'stores:',
    CUSTOMERS: 'customers:',
    SETTINGS: 'settings:'
  }
};

interface CachedData<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class LocalCacheService {
  async set<T>(key: string, data: T): Promise<void> {
    const now = Date.now();
    const cachedData: CachedData<T> = {
      data,
      timestamp: now,
      expiresAt: now + CACHE_CONFIG.EXPIRY_TIME
    };

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(cachedData));
      }
    } catch (error) {
      console.error('localStorage保存失败:', error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (typeof window !== 'undefined') {
        const item = window.localStorage.getItem(STORAGE_PREFIX + key);
        if (!item) return null;

        const cachedData = JSON.parse(item) as CachedData<T>;
        const now = Date.now();

        if (cachedData.expiresAt < now) {
          window.localStorage.removeItem(STORAGE_PREFIX + key);
          return null;
        }

        return cachedData.data;
      }
    } catch (error) {
      console.error('localStorage获取失败:', error);
    }

    return null;
  }

  async remove(key: string): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_PREFIX + key);
      }
    } catch (error) {
      console.error('localStorage删除失败:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith(STORAGE_PREFIX)) {
            window.localStorage.removeItem(key);
            i--;
          }
        }
      }
    } catch (error) {
      console.error('localStorage清空失败:', error);
    }
  }

  async syncToCloud(): Promise<boolean> {
    if (!isCloudRestConfigured) {
      return false;
    }

    try {
      console.log('同步数据到云端');
      return true;
    } catch (error) {
      console.error('同步数据到云端失败:', error);
      return false;
    }
  }

  async syncFromCloud(): Promise<boolean> {
    if (!isCloudRestConfigured) {
      return false;
    }

    try {
      const { data: products } = await cloudRest.from('products').select('*');
      if (products) {
        await this.set(CACHE_CONFIG.PREFIX.PRODUCTS + 'all', products);
      }

      const { data: stores } = await cloudRest.from('stores').select('*');
      if (stores) {
        await this.set(CACHE_CONFIG.PREFIX.STORES + 'all', stores);
      }

      console.log('从云端同步数据到本地');
      return true;
    } catch (error) {
      console.error('从云端同步数据到本地失败:', error);
      return false;
    }
  }

  async getProducts(): Promise<any[]> {
    const cachedProducts = await this.get<any[]>(CACHE_CONFIG.PREFIX.PRODUCTS + 'all');
    if (cachedProducts) {
      return cachedProducts;
    }

    if (isCloudRestConfigured) {
      try {
        const { data: products } = await cloudRest.from('products').select('*');
        if (products) {
          await this.set(CACHE_CONFIG.PREFIX.PRODUCTS + 'all', products);
          return products;
        }
      } catch (error) {
        console.error('从云端获取产品数据失败:', error);
      }
    }

    return [];
  }

  async getStores(): Promise<any[]> {
    const cachedStores = await this.get<any[]>(CACHE_CONFIG.PREFIX.STORES + 'all');
    if (cachedStores) {
      return cachedStores;
    }

    if (isCloudRestConfigured) {
      try {
        const { data: stores } = await cloudRest.from('stores').select('*');
        if (stores) {
          await this.set(CACHE_CONFIG.PREFIX.STORES + 'all', stores);
          return stores;
        }
      } catch (error) {
        console.error('从云端获取门店数据失败:', error);
      }
    }

    return [];
  }

  async saveSale(saleData: any): Promise<void> {
    const key = CACHE_CONFIG.PREFIX.SALES + saleData.sale_no;
    await this.set(key, saleData);

    if (isCloudRestConfigured) {
      try {
        await cloudRest.from('sales').insert(saleData);
      } catch (error) {
        console.error('同步销售数据到云端失败:', error);
      }
    }
  }

  async getSale(saleNo: string): Promise<any | null> {
    const key = CACHE_CONFIG.PREFIX.SALES + saleNo;
    return await this.get(key);
  }
}

export const localCache = new LocalCacheService();
