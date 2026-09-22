import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from "react-native-iap";
import { Platform } from "react-native";

/**
 * Whether the app is unlocked, and how it got that way.
 *
 * Deliberately small: a boolean the UI can gate on, plus enough context to explain itself on
 * the paywall. Everything else — prices, offers, renewal dates — belongs to the store and is
 * read when the paywall is open, not cached here.
 */

/** Same ids in both stores, so one constant serves both. See docs/monetisation.md. */
export const PRODUCT_IDS = {
  monthly: "elegant_ambient_monthly",
  yearly: "elegant_ambient_yearly",
  lifetime: "elegant_ambient_lifetime",
} as const;

export type ProductKey = keyof typeof PRODUCT_IDS;

export const SUBSCRIPTION_IDS = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly];
export const ALL_PRODUCT_IDS = Object.values(PRODUCT_IDS);

/**
 * `unavailable`: the store answered but has nothing to sell, so the app is left open for this
 * session. Never cached — the next launch asks again.
 */
export type EntitlementSource = "purchase" | "legacy" | "cache" | "unavailable" | "none";

export type Entitlement = {
  unlocked: boolean;
  source: EntitlementSource;
  /** When the store last confirmed this, epoch ms. Null when it never has. */
  checkedAt: number | null;
};

const CACHE_KEY = "ambient-entitlement-cache";
const LEGACY_KEY = "ambient-legacy-user";

/** The key the app has written its settings under since v1. */
const APP_STATE_KEY = "ambient-light-controller-state";

const LOCKED: Entitlement = { unlocked: false, source: "none", checkedAt: null };

/**
 * Decide once whether this install predates the paywall, and remember the answer.
 *
 * Anyone already using the app installed it when it was free, and taking it away from them
 * would be a worse outcome than the revenue is worth. Saved settings are the evidence: the
 * app writes them the first time anything is changed, so their presence on the first run of a
 * paywalled build means this phone was using the free version.
 *
 * Decided once and stored, because settings can be cleared later and that must not silently
 * revoke someone's access.
 */
export async function resolveLegacyUser(): Promise<boolean> {
  try {
    const decided = await AsyncStorage.getItem(LEGACY_KEY);
    if (decided !== null) {
      return decided === "true";
    }

    const existing = await AsyncStorage.getItem(APP_STATE_KEY);
    const legacy = existing !== null;
    await AsyncStorage.setItem(LEGACY_KEY, legacy ? "true" : "false");
    return legacy;
  } catch {
    // Storage unavailable is not the user's fault; do not lock them out over it.
    return true;
  }
}

async function readCache(): Promise<Entitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<Entitlement>;
    if (typeof parsed.unlocked !== "boolean") {
      return null;
    }

    return {
      unlocked: parsed.unlocked,
      source: "cache",
      checkedAt: typeof parsed.checkedAt === "number" ? parsed.checkedAt : null,
    };
  } catch {
    return null;
  }
}

async function writeCache(entitlement: Entitlement): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ unlocked: entitlement.unlocked, checkedAt: entitlement.checkedAt }),
    );
  } catch {
    // A cache that cannot be written just means the next launch asks the store again.
  }
}

/**
 * Ask the store what this account owns.
 *
 * Covers both shapes in one call: `getAvailablePurchases` returns active subscriptions and
 * owned non-consumables alike, on both platforms.
 */
async function queryStore(): Promise<boolean> {
  const purchases = await getAvailablePurchases();

  return purchases.some((purchase) => {
    const id = (purchase as { productId?: string; id?: string }).productId
      ?? (purchase as { id?: string }).id;
    return typeof id === "string" && ALL_PRODUCT_IDS.includes(id as (typeof ALL_PRODUCT_IDS)[number]);
  });
}

/**
 * The current entitlement, preferring the store but never letting it lock anyone out.
 *
 * The app drives lights in a car, and cars sit in underground car parks. If the store cannot
 * be reached, a cached unlock stands — a paying user must never find their lights dead because
 * the phone had no signal. The reverse error, someone keeping access a while after cancelling,
 * costs far less than that.
 */
export async function loadEntitlement(): Promise<Entitlement> {
  if (await resolveLegacyUser()) {
    return { unlocked: true, source: "legacy", checkedAt: Date.now() };
  }

  const cached = await readCache();

  try {
    await initConnection();
    const owned = await queryStore();

    // A store with nothing on sale is not a reason to lock the cabin. It happened for real:
    // iOS 1.5 was approved and released while its subscriptions were still unreviewed, so
    // every new install met a paywall with no way through it. If the store offers no
    // products at all, let this session in and ask again next launch — not cached, so the
    // paywall returns by itself once the products are live.
    if (!owned && (await loadPrices()).length === 0) {
      console.warn("[entitlement] store returned no products; leaving the app open this session");
      return { unlocked: true, source: "unavailable", checkedAt: Date.now() };
    }

    const fresh: Entitlement = {
      unlocked: owned,
      source: owned ? "purchase" : "none",
      checkedAt: Date.now(),
    };
    await writeCache(fresh);
    return fresh;
  } catch {
    // Store unreachable. Trust the last thing it told us rather than locking the cabin.
    return cached ?? LOCKED;
  }
}

/**
 * Buy one of the products.
 *
 * `requestPurchase` is event-based: it returns once the store's sheet is done with, but the
 * purchase itself arrives through `purchaseUpdatedListener` a moment later. Asking the store
 * what this account owns the instant it returns is a race, and losing it made a completed
 * purchase report "did not complete" while the listener quietly unlocked the app behind the
 * message. So poll briefly instead of trusting one immediate answer.
 */
export async function purchase(key: ProductKey): Promise<Entitlement> {
  const sku = PRODUCT_IDS[key];

  await initConnection();

  if (key === "lifetime") {
    // "apple" and "google" here are the SDK platforms, not the stores.
    await requestPurchase({ request: { apple: { sku }, google: { skus: [sku] } }, type: "in-app" });
  } else {
    // Android needs the offer token or Play sells the bare base plan and the free trial is
    // silently skipped — the sheet then charges immediately while the paywall promised three
    // free days. Prefer the trial offer; fall back to whatever offer the store returns.
    const offers = await subscriptionOffersFor(sku);
    const trial = offers.find((offer) => offer.id === TRIAL_OFFER_ID) ?? offers[0];

    await requestPurchase({
      request: {
        apple: { sku },
        google: trial?.offerTokenAndroid
          ? { skus: [sku], subscriptionOffers: [{ sku, offerToken: trial.offerTokenAndroid }] }
          : { skus: [sku] },
      },
      type: "subs",
    });
  }

  let owned = false;
  for (let attempt = 0; attempt < 8 && !owned; attempt += 1) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
    }
    try {
      owned = await queryStore();
    } catch {
      // Keep trying; the store is often briefly unavailable right after a purchase.
    }
  }
  const entitlement: Entitlement = {
    unlocked: owned,
    source: owned ? "purchase" : "none",
    checkedAt: Date.now(),
  };
  await writeCache(entitlement);
  return entitlement;
}

/**
 * Hand every finished purchase back to the store.
 *
 * Google auto-refunds and revokes anything not acknowledged within three days, and the failure
 * is silent — everything looks right until the refunds arrive. This runs for every purchase
 * event, including ones that arrive without the app asking, such as a subscription renewing
 * while the app happens to be open.
 */
export function startPurchaseListeners(onChange: (entitlement: Entitlement) => void): () => void {
  const updated = purchaseUpdatedListener(async (purchaseEvent) => {
    try {
      await finishTransaction({ purchase: purchaseEvent, isConsumable: false });
    } catch {
      // Already finished, or the store rejected it; the next query is the source of truth.
    }

    try {
      const owned = await queryStore();
      const entitlement: Entitlement = {
        unlocked: owned,
        source: owned ? "purchase" : "none",
        checkedAt: Date.now(),
      };
      await writeCache(entitlement);
      onChange(entitlement);
    } catch {
      // Leave the current state alone rather than guessing.
    }
  });

  const failed = purchaseErrorListener(() => {
    // Cancelling a purchase is not an error worth surfacing; the paywall stays as it was.
  });

  return () => {
    updated.remove();
    failed.remove();
    void endConnection();
  };
}

/** Apple requires this to be reachable from the paywall — guideline 3.1.1. */
export async function restore(): Promise<Entitlement> {
  await initConnection();

  try {
    const owned = await queryStore();
    const entitlement: Entitlement = {
      unlocked: owned,
      source: owned ? "purchase" : "none",
      checkedAt: Date.now(),
    };
    await writeCache(entitlement);
    return entitlement;
  } catch {
    return (await readCache()) ?? LOCKED;
  }
}

/** Where the user manages or cancels, which both stores require to be reachable. */
export const MANAGE_URL = Platform.select({
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
  default: "https://apps.apple.com/account/subscriptions",
});

/** The offer id created on both stores; see docs and play-offers.rb. */
const TRIAL_OFFER_ID = "free-trial-3d";

type StoreOffer = {
  id?: string;
  offerTokenAndroid?: string | null;
  paymentMode?: string | null;
  period?: { unit?: string; value?: number } | null;
  periodCount?: number | null;
  pricingPhasesAndroid?: { pricingPhaseList?: Array<{ billingPeriod?: string; priceAmountMicros?: string }> } | null;
};

/** "P3D" and friends, as ISO 8601 durations. */
function describePeriod(unit: string | undefined, value: number): string {
  if (!unit || value < 1) {
    return "";
  }

  const plural = value === 1 ? unit : `${unit}s`;
  return `${value} ${plural} free`;
}

function describeIsoPeriod(iso: string | undefined): string {
  const match = /^P(\d+)([DWMY])$/.exec(iso ?? "");
  if (!match) {
    return "";
  }

  const value = Number(match[1]);
  const unit = { D: "day", W: "week", M: "month", Y: "year" }[match[2]] ?? "";
  return describePeriod(unit, value);
}

/**
 * The free period this account would actually get, as the store reports it.
 *
 * Both platforms describe a trial differently — iOS as a payment mode plus a period, Android
 * as a first pricing phase costing nothing — and both only report one when this account is
 * still eligible. Saying "3 days free" to someone who has already used their trial would be a
 * promise the purchase sheet then breaks.
 */
function trialFromOffers(offers: StoreOffer[]): string {
  for (const offer of offers) {
    if (offer.paymentMode === "free-trial" && offer.period?.unit) {
      return describePeriod(offer.period.unit, offer.period.value ?? 1);
    }

    const free = offer.pricingPhasesAndroid?.pricingPhaseList?.find(
      (phase) => phase.priceAmountMicros === "0",
    );
    if (free) {
      return describeIsoPeriod(free.billingPeriod);
    }
  }

  return "";
}

/** The offers Play knows about for one subscription, used to buy with the trial attached. */
async function subscriptionOffersFor(sku: string): Promise<StoreOffer[]> {
  try {
    const found = (await fetchProducts({ skus: [sku], type: "subs" })) as
      | Array<{ id?: string; productId?: string; subscriptionOffers?: StoreOffer[] | null }>
      | null;

    const product = (found ?? []).find((row) => (row.productId ?? row.id) === sku);
    return product?.subscriptionOffers ?? [];
  } catch {
    return [];
  }
}

export type PriceTag = {
  key: ProductKey;
  /** Formatted by the store in the viewer's own currency — never hardcode this. */
  displayPrice: string;
  /**
   * What the store will actually give this account before charging, e.g. "3 days free".
   * Empty when there is no trial — which is the truth for anyone who has subscribed before,
   * since an introductory offer is spent once per account.
   */
  trial: string;
};

/**
 * Prices as the store formats them.
 *
 * Both stores require the price shown on a paywall to be the real, localised one, and a
 * hardcoded "$14.99" is wrong the moment someone opens the app outside the US. Returns only
 * what the store actually knows about, so a product still in review simply does not appear.
 */
export async function loadPrices(): Promise<PriceTag[]> {
  await initConnection();

  const [subs, oneTime] = await Promise.all([
    fetchProducts({ skus: SUBSCRIPTION_IDS, type: "subs" }),
    fetchProducts({ skus: [PRODUCT_IDS.lifetime], type: "in-app" }),
  ]);

  const rows = [...(subs ?? []), ...(oneTime ?? [])] as Array<{
    id?: string;
    productId?: string;
    displayPrice?: string;
    subscriptionOffers?: Array<StoreOffer & { displayPrice?: string | null }> | null;
  }>;

  const byId = new Map<string, string>();
  const trials = new Map<string, string>();
  for (const row of rows) {
    const id = row.productId ?? row.id;
    if (!id) {
      continue;
    }

    trials.set(id, trialFromOffers(row.subscriptionOffers ?? []));

    // A subscription's price lives in its offers on Android — the product-level displayPrice
    // comes back empty, which silently dropped both subscriptions from the paywall and left
    // only the one-time product showing. Prefer the product price, fall back to the offers.
    const offers = (row.subscriptionOffers ?? [])
      .map((offer) => offer?.displayPrice ?? "")
      .filter((price) => price.length > 0);

    // The free-trial offer prices at zero; the recurring price is the one worth showing.
    const recurring = offers.find((price) => !/^(free|0[.,]00|₺?0\b)/i.test(price.trim()));
    const price = row.displayPrice || recurring || offers[0] || "";

    if (price) {
      byId.set(id, price);
    }
  }

  return (Object.keys(PRODUCT_IDS) as ProductKey[])
    .map((key) => ({
      key,
      displayPrice: byId.get(PRODUCT_IDS[key]) ?? "",
      trial: trials.get(PRODUCT_IDS[key]) ?? "",
    }))
    .filter((row) => row.displayPrice.length > 0);
}
