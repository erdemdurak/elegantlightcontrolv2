import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  MANAGE_URL,
  loadPrices,
  purchase,
  restore,
  type Entitlement,
  type PriceTag,
  type ProductKey,
} from "../billing/entitlement";

/**
 * The screen in front of everything else.
 *
 * Prices come from the store rather than this file: both stores require the real, localised
 * price to be shown, and a hardcoded "$14.99" is wrong for everyone outside one country. A tier
 * the store does not return — still in review, or not available in that storefront — simply
 * does not appear rather than being offered and then failing.
 */

/**
 * The pages in `web/`, deployed to Netlify. Apple checks both links during review, so they
 * have to resolve — change SITE here if the Netlify site is named differently.
 */
const SITE = "https://elegant-ambient.netlify.app";
const TERMS_URL = `${SITE}/terms`;
const PRIVACY_URL = `${SITE}/privacy`;

/**
 * What each tier is, with no claim about a trial.
 *
 * Whether a free trial applies is decided by the store, per account, and it is spent once —
 * so anyone who has subscribed before gets none. Promising "3 days free" in fixed text told
 * those people something the purchase sheet then contradicted by charging immediately.
 */
const LABELS: Record<ProductKey, { title: string; detail: string }> = {
  lifetime: { title: "Lifetime", detail: "One payment. Yours permanently." },
  yearly: { title: "Yearly", detail: "Billed yearly. Cancel any time." },
  monthly: { title: "Monthly", detail: "Billed monthly. Cancel any time." },
};

/** Lifetime first: it is the honest pick for an app with no running costs to fund. */
const ORDER: ProductKey[] = ["lifetime", "yearly", "monthly"];

type Props = {
  onUnlocked: (entitlement: Entitlement) => void;
  /** Present only when the paywall was opened voluntarily, so it can be dismissed. */
  onClose?: () => void;
};

export function Paywall({ onUnlocked, onClose }: Props) {
  const [prices, setPrices] = useState<PriceTag[] | null>(null);
  const [busy, setBusy] = useState<ProductKey | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadPrices()
      .then((rows) => {
        if (!cancelled) {
          setPrices(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // An empty list rather than a spinner forever; the retry is reopening the app.
          setPrices([]);
          setMessage("Could not reach the store. Check your connection and try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuy = async (key: ProductKey) => {
    setBusy(key);
    setMessage(null);

    try {
      const entitlement = await purchase(key);
      if (entitlement.unlocked) {
        onUnlocked(entitlement);
        return;
      }
      setMessage("The purchase did not complete.");
    } catch {
      // Cancelling is the common case here and is not worth an error message.
      setMessage(null);
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    setBusy("restore");
    setMessage(null);

    try {
      const entitlement = await restore();
      if (entitlement.unlocked) {
        onUnlocked(entitlement);
        return;
      }
      setMessage("No previous purchase found on this account.");
    } catch {
      setMessage("Could not reach the store to restore.");
    } finally {
      setBusy(null);
    }
  };

  const ordered = (prices ?? []).slice().sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Elegant Ambient Pro</Text>
      <Text style={styles.body}>
        Control the ambient lighting in your cabin: presets for both zones, the colour wheel,
        brightness, the daily schedule and automatic preset cycling.
      </Text>

      {prices === null ? (
        <ActivityIndicator style={styles.spinner} color="#7FB2FF" />
      ) : (
        ordered.map((row) => (
          <Pressable
            key={row.key}
            style={[styles.tier, row.key === "lifetime" ? styles.tierFeatured : null]}
            disabled={busy !== null}
            onPress={() => handleBuy(row.key)}
          >
            <View style={styles.tierText}>
              <Text style={styles.tierTitle}>{LABELS[row.key].title}</Text>
              <Text style={styles.tierDetail}>
                {row.trial ? `${row.trial}, then ` : ""}
                {row.trial
                  ? LABELS[row.key].detail.replace(/^Billed/, "billed")
                  : LABELS[row.key].detail}
              </Text>
            </View>
            <Text style={styles.tierPrice}>
              {busy === row.key ? "..." : row.displayPrice}
            </Text>
          </Pressable>
        ))
      )}

      {prices !== null && ordered.length === 0 ? (
        <Text style={styles.note}>No purchase options are available right now.</Text>
      ) : null}

      {message ? <Text style={styles.note}>{message}</Text> : null}

      <Pressable style={styles.secondary} disabled={busy !== null} onPress={handleRestore}>
        <Text style={styles.secondaryText}>
          {busy === "restore" ? "Restoring..." : "Restore Purchases"}
        </Text>
      </Pressable>

      {onClose ? (
        <Pressable style={styles.secondary} disabled={busy !== null} onPress={onClose}>
          <Text style={styles.secondaryText}>Back to the app</Text>
        </Pressable>
      ) : null}

      <Text style={styles.legal}>
        Subscriptions renew automatically until cancelled. Cancel any time in your account
        settings, at least 24 hours before the period ends. Any free period is shown above when
        your account qualifies for one, and is offered once. Lifetime is a single payment and
        does not renew.
      </Text>

      <View style={styles.links}>
        <Pressable onPress={() => void Linking.openURL(TERMS_URL)}>
          <Text style={styles.link}>Terms</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)}>
          <Text style={styles.link}>Privacy</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(MANAGE_URL)}>
          <Text style={styles.link}>Manage</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#141B33",
  },
  content: {
    padding: 22,
    gap: 14,
  },
  title: {
    color: "#F2F6FF",
    fontSize: 26,
    fontWeight: "800",
  },
  body: {
    color: "#A9B7D6",
    fontSize: 14,
    lineHeight: 20,
  },
  spinner: {
    marginVertical: 24,
  },
  tier: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#2B3557",
    backgroundColor: "#1D2748",
    padding: 16,
    gap: 12,
  },
  tierFeatured: {
    borderColor: "#7FB2FF",
  },
  tierText: {
    flexShrink: 1,
    gap: 3,
  },
  tierTitle: {
    color: "#F2F6FF",
    fontSize: 17,
    fontWeight: "700",
  },
  tierDetail: {
    color: "#A9B7D6",
    fontSize: 12,
  },
  tierPrice: {
    color: "#F2F6FF",
    fontSize: 17,
    fontWeight: "800",
  },
  secondary: {
    alignItems: "center",
    paddingVertical: 12,
  },
  secondaryText: {
    color: "#7FB2FF",
    fontSize: 14,
    fontWeight: "700",
  },
  note: {
    color: "#FFC46B",
    fontSize: 13,
  },
  legal: {
    color: "#7C89A8",
    fontSize: 11,
    lineHeight: 16,
  },
  links: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingBottom: 12,
  },
  link: {
    color: "#7FB2FF",
    fontSize: 12,
    fontWeight: "700",
  },
});
