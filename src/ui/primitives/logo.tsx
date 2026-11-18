import { useId, type ComponentProps } from "react";

import { cn } from "@/ui/lib/utils";

const AURA = "M625.2 300 664 100H709.1L747.7 300H709.9L702.7 256H671.1L663.5 300ZM674.8 231.1H698.8L686.7 150.4ZM830.2 302.7Q807.5 302.7 794.9 294.9Q782.3 287.2 777.2 272.5Q772.2 257.8 772.2 236.8V100H812.4V242.5Q812.4 249.9 813.5 257Q814.6 264.2 818.5 268.6Q822.3 273.1 830.2 273.1Q838.3 273.1 842.2 268.6Q846 264.2 847 257Q848 249.9 848 242.5V100H888.2V236.8Q888.2 257.8 883.2 272.5Q878.1 287.2 865.5 294.9Q852.9 302.7 830.2 302.7ZM922.6 300V100H974.5Q994.7 100 1009.2 104.6Q1023.6 109.1 1031.4 120.7Q1039.2 132.3 1039.2 152.8Q1039.2 165.2 1037.1 174.7Q1035 184.2 1029.7 191.2Q1024.3 198.3 1014.7 202.5L1042.4 300H1000.6L977.7 209.4H963.4V300ZM963.4 185.2H975.2Q985.1 185.2 990.8 182Q996.4 178.8 998.8 172.2Q1001.1 165.7 1001.1 156Q1001.1 142.2 996.1 134.9Q991 127.7 977.2 127.7H963.4ZM1062.7 300 1101.5 100H1146.6L1185.2 300H1147.4L1140.2 256H1108.6L1101 300ZM1112.3 231.1H1136.3L1124.2 150.4Z";
const CARD = "M1266 302.2Q1244.8 302.2 1233.1 293.3Q1221.3 284.4 1216.8 269.4Q1212.2 254.3 1212.2 235.8V165.2Q1212.2 144.9 1216.8 129.9Q1221.3 114.8 1233.1 106.5Q1244.8 98.3 1266 98.3Q1284.8 98.3 1295.8 105.2Q1306.8 112.1 1311.6 124.9Q1316.4 137.8 1316.4 155.8V171.6H1290V157.5Q1290 146.4 1288.9 137.9Q1287.8 129.4 1282.8 124.7Q1277.9 120 1266.3 120Q1254.4 120 1249 125.1Q1243.6 130.1 1242 139.4Q1240.3 148.6 1240.3 161V240.2Q1240.3 255.3 1242.8 264.1Q1245.3 272.8 1251 276.5Q1256.6 280.2 1266.3 280.2Q1277.6 280.2 1282.6 275.2Q1287.5 270.1 1288.7 261.2Q1290 252.3 1290 240.5V225.7H1316.4V240.5Q1316.4 258.8 1312 272.7Q1307.5 286.7 1296.6 294.4Q1285.8 302.2 1266 302.2ZM1338.2 300 1380.7 100H1407.6L1450.3 300H1423.9L1414.7 249.6H1374L1364.4 300ZM1377.7 229.6H1411L1394.2 139.5ZM1476.5 300V100H1516.8Q1536.8 100 1549.9 105.3Q1563 110.6 1569.3 122.3Q1575.6 134.1 1575.6 153.1Q1575.6 164.7 1573.1 174.2Q1570.6 183.7 1565.2 190.2Q1559.8 196.8 1550.9 199.8L1579.3 300H1552.3L1526.2 206.2H1504.4V300ZM1504.4 186.2H1515.1Q1526.9 186.2 1534.3 183.2Q1541.7 180.2 1545.2 173.1Q1548.6 165.9 1548.6 153.1Q1548.6 135.6 1542.2 127.8Q1535.8 120 1516.8 120H1504.4ZM1610.7 300V100H1654.1Q1676.4 100 1689.3 106.8Q1702.3 113.6 1707.9 127.2Q1713.4 140.7 1713.4 161V234.6Q1713.4 255.8 1707.9 270.4Q1702.3 284.9 1689.8 292.5Q1677.4 300 1656.4 300ZM1638.6 280H1654.4Q1669.7 280 1676.1 274.1Q1682.5 268.1 1683.9 256.8Q1685.3 245.4 1685.3 229.4V164.4Q1685.3 148.9 1683.3 139.3Q1681.3 129.6 1674.6 125.2Q1668 120.7 1653.7 120.7H1638.6Z";

const MASK_BOX = { maskUnits: "userSpaceOnUse", x: 0, y: 0, width: 680, height: 440 } as const;

/** Mask: white keeps, black cuts. Ring hole and the gaps that make the bands pass over/under each other. */
function Cuts({ id, lines }: { id: string; lines: readonly (readonly [number, number, number, number])[] }) {
  return (
    <mask id={id} {...MASK_BOX}>
      <rect width="680" height="440" fill="#fff" />
      {lines.map(([x1, y1, x2, y2]) => (
        <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth="78" />
      ))}
      <circle cx="461" cy="218" r="135" fill="#000" />
    </mask>
  );
}

const LOW_BAND = [250, 238, 350, 338] as const;
const HIGH_BAND_CUT = [152, 308, 330, 130] as const;

/**
 * AuraCard brand block (symbol + wordmark), source `public/brand/auracard-logo.svg`.
 * White parts follow `currentColor` (the surrounding text color), emerald parts follow `--primary`; the cut-outs are
 * transparent, so the background shows through.
 * Decorative: the accessible name belongs to the surrounding link.
 */
export function Logo({ className, ...props }: ComponentProps<"svg">) {
  const id = useId();
  const mask = { c: `${id}c-mask`, lowBand: `${id}low-band-mask`, highBand: `${id}high-band-mask` };
  return (
    <svg viewBox="45 59 1677 316" aria-hidden="true" focusable="false" className={cn("w-auto", className)} {...props}>
      <defs>
        <Cuts id={mask.c} lines={[LOW_BAND, HIGH_BAND_CUT]} />
        <Cuts id={mask.lowBand} lines={[HIGH_BAND_CUT]} />
        <Cuts id={mask.highBand} lines={[]} />
      </defs>
      <g transform="translate(40 51) scale(.76)" fill="none" strokeWidth="62">
        <path d="M317.2 87.2A166 166 0 1 0 317.2 348.8" className="stroke-current" mask={`url(#${mask.c})`} />
        <line x1="250" y1="238" x2="350" y2="338" className="stroke-primary" mask={`url(#${mask.lowBand})`} />
        <circle cx="461" cy="218" r="166" className="stroke-primary" />
        <line x1="152" y1="308" x2="350" y2="110" className="stroke-primary" mask={`url(#${mask.highBand})`} />
        <polygon
          points="400,306 551,155 506,110 451,165 406,120 361,165 406,210 355,261"
          className="fill-current stroke-none"
        />
      </g>
      <path d={AURA} className="fill-current" />
      <path d={CARD} className="fill-primary" />
    </svg>
  );
}
