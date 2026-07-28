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
};

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

/**
 * Ordered so the highest-probability combinations come first: the documented 7E
 * protocol, then the other known families, then the 7E model-identifier variants,
 * then the debug profile.
 */
export const protocolFamilies: ProtocolFamily[] = [
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
  if (!variantId) {
    return null;
  }

  return getProtocolFamily(familyId).zoneVariants.find((variant) => variant.id === variantId) ?? null;
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
