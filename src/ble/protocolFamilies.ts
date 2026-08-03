export type Rgb = { r: number; g: number; b: number };

/** Which of the two strips the UI is addressing. Mapped to a module index per variant. */
export type Area = 1 | 2;

export type Payload = {
  label: string;
  bytes: number[];
};

export type ProtocolFamilyId = string;

/**
 * A candidate way of addressing one strip within a family's frame format.
 * Which one a given controller actually uses is determined by the Area Sweep.
 */
export type ZoneVariant = {
  id: string;
  label: string;
  color(rgb: Rgb, area: Area): Payload[];
  brightness(percent: number, area: Area): Payload[];
};

export type ProtocolFamily = {
  id: ProtocolFamilyId;
  label: string;
  hint: string;
  /** Lowercase UUID suffixes this family is normally found on. Used only for ordering. */
  serviceHints: string[];
  characteristicHints: string[];
  /** Handshake some firmware expects before it will accept commands. */
  preamble(): Payload[];
  powerOn(): Payload[];
  /** Broadcast (both areas at once). */
  color(rgb: Rgb): Payload[];
  brightness(percent: number): Payload[];
  zoneVariants: ZoneVariant[];
  /**
   * Set when area addressing is already known and needs no sweeping. The controller uses
   * this variant immediately instead of falling back to broadcast.
   */
  defaultZoneVariantId?: string;
  /**
   * Put an area into one of the controller's own animation modes. Optional — only firmware
   * with chip-side effects implements it, and only `static` and `breathe` are used so far.
   */
  hardwareMode?(mode: HardwareMode, area?: Area): Payload[];
  /** Switch the strips off and on. Optional — most families here only ever had `powerOn`. */
  power?(on: boolean): Payload[];
  /**
   * Rate of the controller's own animations, 1-5. Not per-area — the frame carries a single
   * byte for the whole controller. Meaningless unless a hardware mode is running.
   */
  hardwareSpeed?(value: number): Payload[];
};

/**
 * Mode types the controller runs itself, from `55 03 03 A1 A2` — one byte per area.
 * Captured 2026-07-31 by driving each mode from the vendor app in turn.
 *
 * `breathe` is the valuable one: it modulates the brightness of whatever static colour is
 * already set rather than stepping through a palette of its own, so the colour still comes
 * from us. Verified in the car — a colour set by our app kept breathing after our app was
 * closed. The others replace the colour with the chip's own fixed palette.
 */
export const HARDWARE_MODES = {
  static: 0x00,
  gradient: 0x01,
  breathe: 0x02,
  strobe: 0x03,
  automatic: 0x04,
} as const;

export type HardwareMode = keyof typeof HARDWARE_MODES;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ascii(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    bytes.push(text.charCodeAt(index) & 0xff);
  }
  return bytes;
}

function sumChecksum(bytes: number[]): number {
  return bytes.reduce((total, byte) => (total + byte) & 0xff, 0);
}

function rgbLabel(rgb: Rgb): string {
  return `${clampByte(rgb.r)},${clampByte(rgb.g)},${clampByte(rgb.b)}`;
}

/* -------------------------------------------------------------------------- */
/* ELK-BLEDOM / 7E family — the documented base protocol for this device class. */
/*                                                                             */
/* Byte 1 is a model / sequence identifier, NOT a zone. Published work says it  */
/* "seems to work when set to 0x00, but the app sets a unique value per         */
/* command", and different models are known to use 0x00/0x04/0x05/0x06/0x07/    */
/* 0xFF — so it is swept as its own dimension.                                  */
/* -------------------------------------------------------------------------- */

function bledomColorFrame(rgb: Rgb, byte1: number, byte7 = 0x00): number[] {
  return [0x7e, byte1, 0x05, 0x03, clampByte(rgb.r), clampByte(rgb.g), clampByte(rgb.b), byte7, 0xef];
}

function bledomBrightnessFrame(percent: number, byte1: number, byte7 = 0x00): number[] {
  return [0x7e, byte1, 0x01, clampPercent(percent), 0x00, 0x00, 0x00, byte7, 0xef];
}

/**
 * Module addressing candidates. The two areas may be numbered 0/1 or 1/2 — App Store
 * reviews for the vendor app refer to "modules 0-1-2-3" — so both bases are tried,
 * against each plausible field position.
 */
function bledomZoneVariants(byte1: number): ZoneVariant[] {
  const variants: ZoneVariant[] = [];

  for (const base of [0, 1]) {
    const moduleFor = (area: Area) => base + area - 1;
    const suffix = `${base}/${base + 1}`;

    variants.push({
      id: `bledom-b1-m${base}`,
      label: `Module in byte 1 (${suffix})`,
      color: (rgb, area) => [
        { label: `module ${moduleFor(area)} color ${rgbLabel(rgb)}`, bytes: bledomColorFrame(rgb, moduleFor(area)) },
      ],
      brightness: (percent, area) => [
        { label: `module ${moduleFor(area)} brightness`, bytes: bledomBrightnessFrame(percent, moduleFor(area)) },
      ],
    });

    variants.push({
      id: `bledom-b7-m${base}`,
      label: `Module in byte 7 (${suffix})`,
      color: (rgb, area) => [
        {
          label: `module ${moduleFor(area)} color ${rgbLabel(rgb)}`,
          bytes: bledomColorFrame(rgb, byte1, moduleFor(area)),
        },
      ],
      brightness: (percent, area) => [
        {
          label: `module ${moduleFor(area)} brightness`,
          bytes: bledomBrightnessFrame(percent, byte1, moduleFor(area)),
        },
      ],
    });

    variants.push({
      id: `bledom-select-m${base}`,
      label: `Select module, then colour (${suffix})`,
      color: (rgb, area) => [
        {
          label: `select module ${moduleFor(area)}`,
          bytes: [0x7e, byte1, 0x07, moduleFor(area), 0x00, 0x00, 0x00, 0x00, 0xef],
        },
        { label: `color ${rgbLabel(rgb)}`, bytes: bledomColorFrame(rgb, byte1) },
      ],
      brightness: (percent, area) => [
        {
          label: `select module ${moduleFor(area)}`,
          bytes: [0x7e, byte1, 0x07, moduleFor(area), 0x00, 0x00, 0x00, 0x00, 0xef],
        },
        { label: `brightness ${clampPercent(percent)}%`, bytes: bledomBrightnessFrame(percent, byte1) },
      ],
    });
  }

  return variants;
}

function makeBledom(byte1: number, primary: boolean): ProtocolFamily {
  const idHex = byte1.toString(16).padStart(2, "0").toUpperCase();

  return {
    id: `bledom-7e-${idHex.toLowerCase()}`,
    label: primary ? "ELK-BLEDOM (7E)" : `ELK-BLEDOM (7E, id ${idHex})`,
    hint: "Documented 7E protocol. Service FFF0 / char FFF3.",
    serviceHints: ["fff0"],
    characteristicHints: ["fff3"],
    preamble: () => {
      // The official app sends a time-of-day frame on connect; some firmware will not
      // accept commands until it has seen one. Format: 7E <id> 83 HH MM SS DOW 00 EF
      const now = new Date();
      return [
        {
          label: "time sync",
          bytes: [
            0x7e,
            byte1,
            0x83,
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
            (now.getDay() + 6) % 7,
            0x00,
            0xef,
          ],
        },
      ];
    },
    powerOn: () => [
      { label: "power on", bytes: [0x7e, byte1, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef] },
    ],
    color: (rgb) => [{ label: `color ${rgbLabel(rgb)}`, bytes: bledomColorFrame(rgb, byte1) }],
    brightness: (percent) => [
      { label: `brightness ${clampPercent(percent)}%`, bytes: bledomBrightnessFrame(percent, byte1) },
    ],
    zoneVariants: bledomZoneVariants(byte1),
  };
}

/* -------------------------------------------------------------------------- */
/* Triones / LEDBLE / "Happy Lighting".                                        */
/* -------------------------------------------------------------------------- */

function trionesColorFrame(rgb: Rgb, byte4 = 0x00, byte5 = 0xf0): number[] {
  return [0x56, clampByte(rgb.r), clampByte(rgb.g), clampByte(rgb.b), byte4, byte5, 0xaa];
}

const triones: ProtocolFamily = {
  id: "triones-56",
  label: "Triones / LEDBLE (56)",
  hint: "Service FFD5 / char FFD9, or FFE5 / FFE9.",
  serviceHints: ["ffd5", "ffe5"],
  characteristicHints: ["ffd9", "ffe9"],
  preamble: () => [],
  powerOn: () => [{ label: "power on", bytes: [0xcc, 0x23, 0x33] }],
  color: (rgb) => [{ label: `color ${rgbLabel(rgb)}`, bytes: trionesColorFrame(rgb) }],
  brightness: (percent) => {
    const value = clampByte((clampPercent(percent) / 100) * 255);
    return [
      {
        label: `scaled white ${clampPercent(percent)}%`,
        bytes: trionesColorFrame({ r: value, g: value, b: value }),
      },
    ];
  },
  zoneVariants: [0, 1].flatMap((base) => {
    const moduleFor = (area: Area) => base + area - 1;
    const suffix = `${base}/${base + 1}`;

    return [
      {
        id: `triones-byte4-m${base}`,
        label: `Module in byte 4 (${suffix})`,
        color: (rgb: Rgb, area: Area) => [
          { label: `module ${moduleFor(area)} color`, bytes: trionesColorFrame(rgb, moduleFor(area)) },
        ],
        brightness: (percent: number, area: Area) => {
          const value = clampByte((clampPercent(percent) / 100) * 255);
          return [
            {
              label: `module ${moduleFor(area)} brightness`,
              bytes: trionesColorFrame({ r: value, g: value, b: value }, moduleFor(area)),
            },
          ];
        },
      },
      {
        id: `triones-select-m${base}`,
        label: `Select module, then colour (${suffix})`,
        color: (rgb: Rgb, area: Area) => [
          { label: `select module ${moduleFor(area)}`, bytes: [0xbb, 0x10 + moduleFor(area), 0x00, 0x44] },
          { label: `color ${rgbLabel(rgb)}`, bytes: trionesColorFrame(rgb) },
        ],
        brightness: (percent: number, area: Area) => {
          const value = clampByte((clampPercent(percent) / 100) * 255);
          return [
            { label: `select module ${moduleFor(area)}`, bytes: [0xbb, 0x10 + moduleFor(area), 0x00, 0x44] },
            { label: "brightness", bytes: trionesColorFrame({ r: value, g: value, b: value }) },
          ];
        },
      },
    ];
  }),
};

/* -------------------------------------------------------------------------- */
/* MagicHome / LEDnet checksum framing.                                        */
/* -------------------------------------------------------------------------- */

function magicHomeColorFrame(rgb: Rgb, byte5 = 0x00): number[] {
  const frame = [0x31, clampByte(rgb.r), clampByte(rgb.g), clampByte(rgb.b), 0x00, byte5, 0x0f];
  return [...frame, sumChecksum(frame)];
}

const magicHome: ProtocolFamily = {
  id: "magichome-31",
  label: "MagicHome / LEDnet (31)",
  hint: "Checksummed 0x31 frame. Service FFE5 / char FFE9.",
  serviceHints: ["ffe5"],
  characteristicHints: ["ffe9"],
  preamble: () => [],
  powerOn: () => [{ label: "power on", bytes: [0x71, 0x23, 0x0f, sumChecksum([0x71, 0x23, 0x0f])] }],
  color: (rgb) => [{ label: `color ${rgbLabel(rgb)}`, bytes: magicHomeColorFrame(rgb) }],
  brightness: (percent) => {
    const value = clampByte((clampPercent(percent) / 100) * 255);
    return [
      {
        label: `scaled white ${clampPercent(percent)}%`,
        bytes: magicHomeColorFrame({ r: value, g: value, b: value }),
      },
    ];
  },
  zoneVariants: [0, 1].map((base) => {
    const moduleFor = (area: Area) => base + area - 1;
    return {
      id: `magichome-byte5-m${base}`,
      label: `Module in byte 5 (${base}/${base + 1})`,
      color: (rgb: Rgb, area: Area) => [
        { label: `module ${moduleFor(area)} color`, bytes: magicHomeColorFrame(rgb, moduleFor(area)) },
      ],
      brightness: (percent: number, area: Area) => {
        const value = clampByte((clampPercent(percent) / 100) * 255);
        return [
          {
            label: `module ${moduleFor(area)} brightness`,
            bytes: magicHomeColorFrame({ r: value, g: value, b: value }, moduleFor(area)),
          },
        ];
      },
    };
  }),
};

/* -------------------------------------------------------------------------- */
/* Transparent UART bridges (HM-10 and clones).                                */
/* -------------------------------------------------------------------------- */

const uartAscii: ProtocolFamily = {
  id: "uart-ascii",
  label: "UART ASCII text",
  hint: "HM-10 style transparent bridge. Service FFE0 / char FFE1.",
  serviceHints: ["ffe0"],
  characteristicHints: ["ffe1"],
  preamble: () => [],
  powerOn: () => [{ label: "AT+ON", bytes: ascii("AT+ON\r\n") }],
  color: (rgb) => [
    { label: `AT+RGB=${rgbLabel(rgb)}`, bytes: ascii(`AT+RGB=${rgbLabel(rgb)}\r\n`) },
    { label: `plain ${rgbLabel(rgb)}`, bytes: ascii(`${rgbLabel(rgb)}\n`) },
  ],
  brightness: (percent) => [
    { label: `AT+BRIGHT=${clampPercent(percent)}`, bytes: ascii(`AT+BRIGHT=${clampPercent(percent)}\r\n`) },
  ],
  zoneVariants: [0, 1].flatMap((base) => {
    const moduleFor = (area: Area) => base + area - 1;
    const suffix = `${base}/${base + 1}`;

    return [
      {
        id: `uart-zone-prefix-m${base}`,
        label: `AT+ZONE, then colour (${suffix})`,
        color: (rgb: Rgb, area: Area) => [
          { label: `AT+ZONE=${moduleFor(area)}`, bytes: ascii(`AT+ZONE=${moduleFor(area)}\r\n`) },
          { label: `AT+RGB=${rgbLabel(rgb)}`, bytes: ascii(`AT+RGB=${rgbLabel(rgb)}\r\n`) },
        ],
        brightness: (percent: number, area: Area) => [
          { label: `AT+ZONE=${moduleFor(area)}`, bytes: ascii(`AT+ZONE=${moduleFor(area)}\r\n`) },
          { label: `AT+BRIGHT=${clampPercent(percent)}`, bytes: ascii(`AT+BRIGHT=${clampPercent(percent)}\r\n`) },
        ],
      },
      {
        id: `uart-indexed-m${base}`,
        label: `AT+RGBn= (${suffix})`,
        color: (rgb: Rgb, area: Area) => [
          {
            label: `AT+RGB${moduleFor(area)}=${rgbLabel(rgb)}`,
            bytes: ascii(`AT+RGB${moduleFor(area)}=${rgbLabel(rgb)}\r\n`),
          },
        ],
        brightness: (percent: number, area: Area) => [
          {
            label: `AT+BRIGHT${moduleFor(area)}=`,
            bytes: ascii(`AT+BRIGHT${moduleFor(area)}=${clampPercent(percent)}\r\n`),
          },
        ],
      },
    ];
  }),
};

/* -------------------------------------------------------------------------- */
/* Generic 0xAA55 framed protocol with a trailing sum checksum.                */
/* -------------------------------------------------------------------------- */

function aa55ColorFrame(rgb: Rgb, zone: number): number[] {
  const frame = [0xaa, 0x55, zone, 0x01, clampByte(rgb.r), clampByte(rgb.g), clampByte(rgb.b), 0xff];
  return [...frame, sumChecksum(frame)];
}

const aa55Frame: ProtocolFamily = {
  id: "aa55-frame",
  label: "AA55 checksum frame",
  hint: "Generic framed binary protocol.",
  serviceHints: [],
  characteristicHints: [],
  preamble: () => [],
  powerOn: () => {
    const frame = [0xaa, 0x55, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00];
    return [{ label: "power on", bytes: [...frame, sumChecksum(frame)] }];
  },
  color: (rgb) => [{ label: `color ${rgbLabel(rgb)}`, bytes: aa55ColorFrame(rgb, 0x00) }],
  brightness: (percent) => {
    const frame = [0xaa, 0x55, 0x00, 0x03, clampByte((clampPercent(percent) / 100) * 255), 0x00, 0x00, 0x00];
    return [{ label: `brightness ${clampPercent(percent)}%`, bytes: [...frame, sumChecksum(frame)] }];
  },
  zoneVariants: [0, 1].map((base) => {
    const moduleFor = (area: Area) => base + area - 1;
    return {
      id: `aa55-byte2-m${base}`,
      label: `Module in byte 2 (${base}/${base + 1})`,
      color: (rgb: Rgb, area: Area) => [
        { label: `module ${moduleFor(area)} color`, bytes: aa55ColorFrame(rgb, moduleFor(area)) },
      ],
      brightness: (percent: number, area: Area) => {
        const frame = [
          0xaa,
          0x55,
          moduleFor(area),
          0x03,
          clampByte((clampPercent(percent) / 100) * 255),
          0x00,
          0x00,
          0x00,
        ];
        return [{ label: `module ${moduleFor(area)} brightness`, bytes: [...frame, sumChecksum(frame)] }];
      },
    };
  }),
};

/* -------------------------------------------------------------------------- */

const jsonDebug: ProtocolFamily = {
  id: "json-debug",
  label: "JSON (debug)",
  hint: "Only useful against custom firmware.",
  serviceHints: [],
  characteristicHints: [],
  preamble: () => [],
  powerOn: () => [{ label: "power on", bytes: ascii(JSON.stringify({ power: true })) }],
  color: (rgb) => [{ label: `color ${rgbLabel(rgb)}`, bytes: ascii(JSON.stringify({ rgb })) }],
  brightness: (percent) => [
    {
      label: `brightness ${clampPercent(percent)}%`,
      bytes: ascii(JSON.stringify({ brightness: clampPercent(percent) })),
    },
  ],
  zoneVariants: [
    {
      id: "json-zone",
      label: "zone field",
      color: (rgb, area) => [
        { label: `zone ${area} color`, bytes: ascii(JSON.stringify({ zone: area, rgb })) },
      ],
      brightness: (percent, area) => [
        {
          label: `zone ${area} brightness`,
          bytes: ascii(JSON.stringify({ zone: area, brightness: clampPercent(percent) })),
        },
      ],
    },
  ],
};


/* -------------------------------------------------------------------------- */
/* Raw colour bytes with no framing at all. Documented on FFB0-class devices,   */
/* e.g. a 4-byte "BB GG RR WW" write. Every other family here has a header and  */
/* footer, so these would never match such a controller.                        */
/* -------------------------------------------------------------------------- */

function makeRaw(order: "rgb" | "bgr", withWhite: boolean): ProtocolFamily {
  const label = `Raw ${order.toUpperCase()}${withWhite ? "W" : ""} bytes`;

  const body = (rgb: Rgb): number[] => {
    const r = clampByte(rgb.r);
    const g = clampByte(rgb.g);
    const b = clampByte(rgb.b);
    const base = order === "rgb" ? [r, g, b] : [b, g, r];
    return withWhite ? [...base, 0x00] : base;
  };

  return {
    id: `raw-${order}${withWhite ? "w" : ""}`,
    label,
    hint: "No header or footer. Service FFB0 / char FFB1.",
    serviceHints: ["ffb0"],
    characteristicHints: ["ffb1", "ffb2"],
    preamble: () => [],
    powerOn: () => [],
    color: (rgb) => [{ label: `raw ${rgbLabel(rgb)}`, bytes: body(rgb) }],
    brightness: (percent) => {
      const value = clampByte((clampPercent(percent) / 100) * 255);
      return [
        { label: `raw white ${clampPercent(percent)}%`, bytes: body({ r: value, g: value, b: value }) },
      ];
    },
    zoneVariants: [0, 1].flatMap((base) => {
      const moduleFor = (area: Area) => base + area - 1;
      const suffix = `${base}/${base + 1}`;

      return [
        {
          id: `raw-prefix-m${base}`,
          label: `Module byte first (${suffix})`,
          color: (rgb: Rgb, area: Area) => [
            { label: `module ${moduleFor(area)} ${rgbLabel(rgb)}`, bytes: [moduleFor(area), ...body(rgb)] },
          ],
          brightness: (percent: number, area: Area) => {
            const value = clampByte((clampPercent(percent) / 100) * 255);
            return [
              {
                label: `module ${moduleFor(area)} brightness`,
                bytes: [moduleFor(area), ...body({ r: value, g: value, b: value })],
              },
            ];
          },
        },
        {
          id: `raw-suffix-m${base}`,
          label: `Module byte last (${suffix})`,
          color: (rgb: Rgb, area: Area) => [
            { label: `module ${moduleFor(area)} ${rgbLabel(rgb)}`, bytes: [...body(rgb), moduleFor(area)] },
          ],
          brightness: (percent: number, area: Area) => {
            const value = clampByte((clampPercent(percent) / 100) * 255);
            return [
              {
                label: `module ${moduleFor(area)} brightness`,
                bytes: [...body({ r: value, g: value, b: value }), moduleFor(area)],
              },
            ];
          },
        },
      ];
    }),
  };
}


/* -------------------------------------------------------------------------- */
/* Bracketed ASCII text protocol, recovered by decompiling the vendor Android   */
/* app (com.mingmao.zyblack, "Vehicle ambient light control program").          */
/*                                                                             */
/* Colour is sent as "[06rrggbb]" — the app formats an ARGB int with            */
/* Integer.toHexString(...).substring(2), i.e. lowercase hex, alpha stripped.   */
/* The 06/10/09 prefix is a channel selector, which is the most likely area     */
/* field. "[0A01]" is sent immediately after connecting.                        */
/* -------------------------------------------------------------------------- */

function hex6(rgb: Rgb): string {
  return [rgb.r, rgb.g, rgb.b]
    .map((value) => clampByte(value).toString(16).padStart(2, "0"))
    .join("");
}

function bracket(text: string): number[] {
  return ascii(`[${text}]`);
}

/** Channel prefixes for the colour command, in the app's own order. */
const bracketColorChannels = ["06", "10", "09"];

/** Channel prefixes for the 3-digit value command. */
const bracketLevelChannels = ["1C0", "0F0", "130", "1D0"];

const bracketAscii: ProtocolFamily = {
  id: "bracket-ascii",
  label: "Bracket ASCII [06rrggbb]",
  hint: "Recovered from the vendor Android app.",
  serviceHints: [],
  characteristicHints: [],
  preamble: () => [{ label: "handshake [0A01]", bytes: bracket("0A01") }],
  powerOn: () => [{ label: "power [460 1]", bytes: bracket("4601") }],
  color: (rgb) => [{ label: `[06${hex6(rgb)}]`, bytes: bracket(`06${hex6(rgb)}`) }],
  brightness: (percent) => [
    {
      label: `[1C0${clampPercent(percent)}]`,
      bytes: bracket(`1C0${String(clampPercent(percent)).padStart(3, "0")}`),
    },
  ],
  zoneVariants: [
    { a: 0, b: 1 },
    { a: 0, b: 2 },
    { a: 1, b: 2 },
  ].map(({ a, b }) => {
    const channelFor = (area: Area) => (area === 1 ? a : b);

    return {
      id: `bracket-ch-${a}${b}`,
      label: `Channels ${bracketColorChannels[a]} / ${bracketColorChannels[b]}`,
      color: (rgb: Rgb, area: Area) => [
        {
          label: `[${bracketColorChannels[channelFor(area)]}${hex6(rgb)}]`,
          bytes: bracket(`${bracketColorChannels[channelFor(area)]}${hex6(rgb)}`),
        },
      ],
      brightness: (percent: number, area: Area) => [
        {
          label: `[${bracketLevelChannels[channelFor(area)]}${clampPercent(percent)}]`,
          bytes: bracket(
            `${bracketLevelChannels[channelFor(area)]}${String(clampPercent(percent)).padStart(3, "0")}`,
          ),
        },
      ],
    };
  }),
};


/* -------------------------------------------------------------------------- */
/* SmartLed A5 frame — recovered from com.leguangqi.smartled ("My SmartLed"),   */
/* cn/imengduo/lanya/DeviceHelper.java. This is the app that ships with         */
/* YX-LED fiber light modules, and it hardcodes exactly this controller's       */
/* service FFB0 / write characteristic FFB1.                                    */
/*                                                                             */
/* A single 20-byte frame carries the whole state; the app keeps one "current   */
/* command" string and patches byte ranges in place, so we mirror that here.    */
/* No checksum — HexUtil.hexStringToBytes(cmd) is written verbatim.             */
/* -------------------------------------------------------------------------- */

const SMARTLED_BASE = [
  0xa5, 0xff, 0x01, 0x00, 0x05, 0x00, 0x00, 0x00, 0xff, 0x64,
  0x00, 0x00, 0x05, 0xff, 0x01, 0xff, 0x01, 0x01, 0x00, 0x00,
];

/** Mirrors DateCenter.currentCmd — the frame is stateful across commands. */
let smartledFrame = [...SMARTLED_BASE];

function smartledColorFrame(rgb: Rgb, areaByteIndex?: number, areaValue?: number): number[] {
  const next = [...smartledFrame];
  next[1] = 0xff; // switch on
  next[2] = 0x01; // static colour mode

  const isWhite = clampByte(rgb.r) === 255 && clampByte(rgb.g) === 255 && clampByte(rgb.b) === 255;
  if (isWhite) {
    next[5] = 0x00;
    next[6] = 0x00;
    next[7] = 0x00;
    next[8] = 0xff;
  } else {
    next[5] = clampByte(rgb.r);
    next[6] = clampByte(rgb.g);
    next[7] = clampByte(rgb.b);
    next[8] = 0x00;
  }

  if (areaByteIndex !== undefined && areaValue !== undefined) {
    next[areaByteIndex] = areaValue;
  }

  smartledFrame = next;
  return next;
}

function smartledBrightnessFrame(percent: number, areaByteIndex?: number, areaValue?: number): number[] {
  const next = [...smartledFrame];
  next[1] = 0xff;
  next[9] = clampPercent(percent);

  if (areaByteIndex !== undefined && areaValue !== undefined) {
    next[areaByteIndex] = areaValue;
  }

  smartledFrame = next;
  return next;
}

/**
 * The vendor app addresses multiple light kits as separate BLE devices, so it has no
 * in-frame area selector. This controller drives two areas over one connection, so the
 * unused bytes are the candidates: [3] mode-value, [11] voice-value, [18] and [19].
 */
const smartledAreaByteCandidates = [3, 18, 19, 11];

const smartled: ProtocolFamily = {
  id: "smartled-a5",
  label: "SmartLed A5 frame",
  hint: "From the My SmartLed app. Service FFB0 / char FFB1.",
  serviceHints: ["ffb0"],
  characteristicHints: ["ffb1"],
  preamble: () => [],
  powerOn: () => {
    const next = [...smartledFrame];
    next[1] = 0xff;
    smartledFrame = next;
    return [{ label: "power on", bytes: next }];
  },
  color: (rgb) => [{ label: `colour ${rgbLabel(rgb)}`, bytes: smartledColorFrame(rgb) }],
  brightness: (percent) => [
    { label: `brightness ${clampPercent(percent)}%`, bytes: smartledBrightnessFrame(percent) },
  ],
  zoneVariants: smartledAreaByteCandidates.flatMap((byteIndex) =>
    [0, 1].map((base) => {
      const valueFor = (area: Area) => base + area - 1;
      return {
        id: `smartled-b${byteIndex}-m${base}`,
        label: `Area in byte ${byteIndex} (${base}/${base + 1})`,
        color: (rgb: Rgb, area: Area) => [
          {
            label: `area ${valueFor(area)} colour`,
            bytes: smartledColorFrame(rgb, byteIndex, valueFor(area)),
          },
        ],
        brightness: (percent: number, area: Area) => [
          {
            label: `area ${valueFor(area)} brightness`,
            bytes: smartledBrightnessFrame(percent, byteIndex, valueFor(area)),
          },
        ],
      };
    }),
  ),
};

/* -------------------------------------------------------------------------- */
/* Lenze 55/AA frame — THE REAL PROTOCOL.                                      */
/*                                                                             */
/* Captured 2026-07-31 from the vendor iOS app "Ambient Light Control"          */
/* (ShenZhen Lenze Technology) driving this exact controller, via PacketLogger  */
/* HCI trace. Not inferred, not guessed — observed on the wire.                 */
/*                                                                             */
/*   55 | LEN | CMD | payload... | CKSUM | AA                                   */
/*                                                                             */
/*   LEN   = byte count of CMD + payload                                        */
/*   CKSUM = ~(LEN + CMD + payload) & 0xFF   (one's complement)                 */
/*                                                                             */
/* Sent to FFB1 (handle 0x0014) as WRITE WITHOUT RESPONSE. Replies arrive on    */
/* FFB2 (handle 0x0016) once its CCCD (0x0017) is written 0100.                 */
/*                                                                             */
/* Both areas travel in ONE frame — there is no area-selector byte, which is    */
/* why every sweep over candidate bytes failed:                                 */
/*                                                                             */
/*   55 07 04 R1 G1 B1 R2 G2 B2 CK AA                                           */
/*                                                                             */
/* Observed frames, all checksum-verified:                                      */
/*   550100feaa               query state  -> full state dump on FFB2           */
/*   550101fdaa               query info                                        */
/*   550704ff0102ff0102f0aa   red both areas                                    */
/*   55070403fe1203fe12ceaa   green both areas                                  */
/*   5507040101fd0101fdf6aa   blue both areas                                   */
/*   550704ff01020101fdf3aa   area 1 red, area 2 blue                           */
/*   55020500f8aa / 55020501f7aa   cmd 0x05, one byte — believed on/off         */
/* -------------------------------------------------------------------------- */

const LENZE_HEADER = 0x55;
const LENZE_TAIL = 0xaa;

function lenzeFrame(cmd: number, payload: number[]): number[] {
  const body = [1 + payload.length, cmd, ...payload];
  const checksum = ~sumChecksum(body) & 0xff;
  return [LENZE_HEADER, ...body, checksum, LENZE_TAIL];
}

/**
 * The colour command carries both areas at once, so setting one area requires remembering
 * the other. Mirrors how the vendor app holds full state and re-sends it.
 */
const lenzeArea: Record<Area, Rgb> = {
  1: { r: 255, g: 255, b: 255 },
  2: { r: 255, g: 255, b: 255 },
};

/**
 * Seed the remembered colours without sending anything.
 *
 * Every frame carries BOTH areas, so the half not being edited is filled from memory. On a
 * cold start that memory defaulted to white, which meant the first single-area change after
 * reopening the app visibly reset the other area. The UI knows the real colours, so it
 * hands them over on launch and on connect.
 */
export function seedLenzeAreas(area1: Rgb, area2: Rgb): void {
  lenzeArea[1] = area1;
  lenzeArea[2] = area2;
}

function lenzeCurrentFrame(): number[] {
  return lenzeFrame(0x04, [
    clampByte(lenzeArea[1].r), clampByte(lenzeArea[1].g), clampByte(lenzeArea[1].b),
    clampByte(lenzeArea[2].r), clampByte(lenzeArea[2].g), clampByte(lenzeArea[2].b),
  ]);
}

function lenzeColorFrame(rgb: Rgb, area?: Area): number[] {
  const areas: Area[] = area ? [area] : [1, 2];
  for (const a of areas) {
    lenzeArea[a] = rgb;
  }
  return lenzeCurrentFrame();
}

/**
 * Brightness, like colour, carries both areas in one frame, so the half not being edited is
 * filled from memory.
 */
const lenzeBrightness: Record<Area, number> = { 1: 100, 2: 100 };

export function seedLenzeBrightness(area1: number, area2: number): void {
  lenzeBrightness[1] = clampPercent(area1);
  lenzeBrightness[2] = clampPercent(area2);
}

/**
 * CAPTURED 2026-07-31 from the vendor app: `55 03 02 B1 B2 CK AA`, one byte per area, 0-100
 * (0x00-0x64), dead linear with no gamma curve.
 *
 * This replaces the earlier stand-in that scaled the stored RGB on the phone. That worked,
 * but it dimmed the colour rather than the light — and it meant colour and brightness could
 * not be set independently, since every brightness move rewrote the colour frame.
 */
function lenzeBrightnessFrame(percent: number, area?: Area): number[] {
  const areas: Area[] = area ? [area] : [1, 2];
  for (const a of areas) {
    lenzeBrightness[a] = clampPercent(percent);
  }

  return lenzeFrame(0x02, [
    Math.round(lenzeBrightness[1]),
    Math.round(lenzeBrightness[2]),
  ]);
}

/** Like colour and brightness, the mode byte carries both areas in one frame. */
const lenzeMode: Record<Area, number> = { 1: HARDWARE_MODES.static, 2: HARDWARE_MODES.static };

function lenzeModeFrame(mode: HardwareMode, area?: Area): number[] {
  const areas: Area[] = area ? [area] : [1, 2];
  for (const a of areas) {
    lenzeMode[a] = HARDWARE_MODES[mode];
  }

  return lenzeFrame(0x03, [lenzeMode[1], lenzeMode[2]]);
}

const lenze: ProtocolFamily = {
  id: "lenze-55",
  label: "Lenze 55/AA frame (captured)",
  hint: "Captured from the vendor iOS app. Service FFB0 / char FFB1, write without response.",
  serviceHints: ["ffb0"],
  characteristicHints: ["ffb1"],
  // The app opens by asking the controller for its current state, then forces both areas
  // back to static colour. cmd 0x03 carries one byte per area and the vendor app sends
  // `00 00` before setting a colour and `01 01` before starting an effect, so it reads as
  // static-vs-dynamic. Without it, a controller left running a hardware effect by the vendor
  // app blends over our colour writes, which is the likeliest cause of colours coming out
  // washed next to the vendor app's.
  preamble: () => [
    { label: "query state", bytes: lenzeFrame(0x00, []) },
    { label: "static mode both areas", bytes: lenzeModeFrame("static") },
  ],
  // CAPTURED: `55 02 23 S CK AA`, 1-5, matching the vendor app's own Speed slider.
  hardwareSpeed: (value) => [
    { label: `speed ${value}`, bytes: lenzeFrame(0x23, [Math.max(1, Math.min(5, Math.round(value)))]) },
  ],
  hardwareMode: (mode, area) => [
    { label: `${mode} mode${area ? ` area ${area}` : ""}`, bytes: lenzeModeFrame(mode, area) },
  ],
  // 0x05 00 was captured and echoed back by the controller; 0x05 01 is the obvious pair.
  powerOn: () => [{ label: "switch on", bytes: lenzeFrame(0x05, [0x01]) }],
  power: (on) => [
    { label: on ? "switch on" : "switch off", bytes: lenzeFrame(0x05, [on ? 0x01 : 0x00]) },
  ],
  color: (rgb) => [{ label: `colour ${rgbLabel(rgb)} both areas`, bytes: lenzeColorFrame(rgb) }],
  brightness: (percent) => [
    { label: `brightness ${clampPercent(percent)}%`, bytes: lenzeBrightnessFrame(percent) },
  ],
  // Area addressing is captured, not guessed, so it applies without an Area Sweep.
  defaultZoneVariantId: "lenze-inline",
  // Areas are positional within the one frame, so there is nothing to sweep.
  zoneVariants: [
    {
      id: "lenze-inline",
      label: "Both areas in one frame (captured)",
      color: (rgb: Rgb, area: Area) => [
        { label: `area ${area} colour ${rgbLabel(rgb)}`, bytes: lenzeColorFrame(rgb, area) },
      ],
      brightness: (percent: number, area: Area) => [
        { label: `area ${area} brightness ${clampPercent(percent)}%`, bytes: lenzeBrightnessFrame(percent, area) },
      ],
    },
  ],
};

/**
 * Ordered so the highest-probability combinations come first: the captured Lenze
 * protocol, then the older guessed families kept only for reference, then the
 * debug profile.
 */
export const protocolFamilies: ProtocolFamily[] = [
  lenze,
  smartled,
  bracketAscii,
  makeBledom(0x00, true),
  makeRaw("bgr", true),
  makeRaw("rgb", true),
  makeRaw("rgb", false),
  makeRaw("bgr", false),
  triones,
  magicHome,
  uartAscii,
  aa55Frame,
  makeBledom(0x04, false),
  makeBledom(0x05, false),
  makeBledom(0x06, false),
  makeBledom(0x07, false),
  makeBledom(0xff, false),
  jsonDebug,
];

/** Accepts a plain string so profiles persisted by older builds still resolve. */
export function getProtocolFamily(id: string): ProtocolFamily {
  return protocolFamilies.find((family) => family.id === id) ?? protocolFamilies[0];
}

export function getZoneVariant(familyId: string, variantId: string | null | undefined): ZoneVariant | null {
  const family = getProtocolFamily(familyId);
  // Families whose area addressing was captured rather than guessed need no sweep, so an
  // unset variantId still resolves.
  const wanted = variantId ?? family.defaultZoneVariantId;
  if (!wanted) {
    return null;
  }

  return family.zoneVariants.find((variant) => variant.id === wanted) ?? null;
}

/** Vivid, unmistakable colours used by the identification sweep. */
export const sweepColors: Array<{ name: string; rgb: Rgb }> = [
  { name: "RED", rgb: { r: 255, g: 0, b: 0 } },
  { name: "GREEN", rgb: { r: 0, g: 255, b: 0 } },
  { name: "BLUE", rgb: { r: 0, g: 0, b: 255 } },
];

/** Area 1 goes red, area 2 goes blue — an unmistakable split if addressing works. */
export const zoneTestColors: Record<Area, Rgb> = {
  1: { r: 255, g: 0, b: 0 },
  2: { r: 0, g: 0, b: 255 },
};
