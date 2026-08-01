import { memo } from "react";
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { ControlTarget } from "../types";

/**
 * Live preview of the two zones, drawn on a photo of the actual cabin.
 *
 * The lights in the photo are recoloured rather than covered. `tools/build_interior_layers.py`
 * splits `interior.png` into three plates: a base with every lit strip knocked back to dim
 * grey, and one alpha mask per area holding the exact shape of that area's lights. Tinting a
 * mask with `tintColor` paints the real fibre lines, vent rings and floor bloom in the chosen
 * colour, so the preview keeps the photo's shapes instead of pasting rectangles over them.
 *
 * An earlier version drew crude coloured blooms at hand-measured coordinates; regenerate the
 * plates with the tool if the source photo is ever replaced.
 *
 * Layout rules, learned the hard way: the container is an explicit pixel size and every
 * overlay is absolutely positioned *inside* it. Nothing may depend on flex or percentage
 * sizing from the parent, or it collapses the surrounding ScrollView.
 */

type Props = {
  area1Color: string;
  area2Color: string;
  activeTarget: ControlTarget;
  onSelectArea?: (target: ControlTarget) => void;
  /** Hides the legend chips where the surrounding section already offers area selection. */
  hideLegend?: boolean;
};

/** Source photo and both masks are 1399 x 1124. */
const ASPECT = 1124 / 1399;
const SCREEN_PADDING = 32;

const W = Math.min(360, Dimensions.get("window").width - SCREEN_PADDING);
const H = Math.round(W * ASPECT);

/** Unselected zone fades back so the active target is obvious. */
const DIMMED = 0.25;

const BASE = require("../../assets/interior-base.png");
const AREA1_MASK = require("../../assets/interior-area1.png");
const AREA2_MASK = require("../../assets/interior-area2.png");

function InteriorPreviewBase({
  area1Color,
  area2Color,
  activeTarget,
  onSelectArea,
  hideLegend = false,
}: Props) {
  const a1Active = activeTarget === "area1" || activeTarget === "both";
  const a2Active = activeTarget === "area2" || activeTarget === "both";
  const size = { width: W, height: H };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.canvas, size]}>
        <Image source={BASE} style={size} resizeMode="cover" />
        <Image
          source={AREA2_MASK}
          style={[styles.layer, size, { tintColor: area2Color, opacity: a2Active ? 1 : DIMMED }]}
          resizeMode="cover"
        />
        <Image
          source={AREA1_MASK}
          style={[styles.layer, size, { tintColor: area1Color, opacity: a1Active ? 1 : DIMMED }]}
          resizeMode="cover"
        />
      </View>

      {hideLegend ? null : (
      <View style={styles.legend}>
        <Pressable
          style={[styles.chip, a1Active && styles.chipActive]}
          onPress={() => onSelectArea?.("area1")}
        >
          <View style={[styles.dot, { backgroundColor: area1Color }]} />
          <Text style={[styles.chipText, !a1Active && styles.chipMuted]}>Area 1 · doors</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, a2Active && styles.chipActive]}
          onPress={() => onSelectArea?.("area2")}
        >
          <View style={[styles.dot, { backgroundColor: area2Color }]} />
          <Text style={[styles.chipText, !a2Active && styles.chipMuted]}>Area 2 · vents</Text>
        </Pressable>
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: "center", marginBottom: 6 },
  canvas: { borderRadius: 14, overflow: "hidden", backgroundColor: "#05070C" },
  layer: { position: "absolute", left: 0, top: 0 },
  legend: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2A3550",
    backgroundColor: "#141B2B",
  },
  chipActive: { borderColor: "#5B8DEF", backgroundColor: "#1B2740" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { color: "#DCE5F5", fontSize: 12 },
  chipMuted: { color: "#7A87A3" },
});

export const InteriorPreview = memo(InteriorPreviewBase);
