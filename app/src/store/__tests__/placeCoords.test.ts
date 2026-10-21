import { describe, expect, it } from "vitest";
import { parseCoordinate } from "../placeCoords";
import { parseCoords } from "../visualData";

// Expected values come from Gramps desktop's own
// conv_lat_lon(lat, long, "D.D8") (gramps/gen/utils/place.py).
const MATCHES_GRAMPS: [string, "lat" | "long", number][] = [
  ["42° 41′ 55″ N", "lat", 42.69861111],
  ["2° 53′ 44″ E", "long", 2.89555556],
  ["42°41′55″N", "lat", 42.69861111],
  ["42.6986", "lat", 42.6986],
  ["-33.8688", "lat", -33.8688],
  ["33°52'7.68\"S", "lat", -33.8688],
  ["151°12'33.48\"E", "long", 151.2093],
  ["N50º52'21.92\"", "lat", 50.87275556],
  ["E14º52'21.92\"", "long", 14.87275556],
  ["N50º52.3456'", "lat", 50.87242667],
  ["W14º52.9876'", "long", -14.88312667],
  ["124°52'21.92''W", "long", -124.87275556],
  ["-50:52:21.92", "lat", -50.87275556],
  ["+50:52", "lat", 50.86666667],
  ["-0:30", "long", -0.5],
  ["12.5N", "lat", 12.5],
  ["3.25W", "long", -3.25],
  ["S12.5", "lat", -12.5],
  ["-12.5N", "lat", -12.5],
  ["1e1", "lat", 10],
  ["50°N", "lat", 50],
  ["2°5'W", "long", -2.08333333],
];

describe("parseCoordinate", () => {
  it.each(MATCHES_GRAMPS)("parses %s (%s) as Gramps does", (text, kind, expected) => {
    expect(parseCoordinate(text, kind)).toBeCloseTo(expected, 7);
  });

  it.each([
    ["-12.5S", "lat"],
    ["50°60'0\"N", "lat"],
    ["50°52.5'30\"N", "lat"],
    ["abc", "lat"],
    ["42° 41′ 55″ E", "lat"],
    ["2° 53′ 44″ N", "long"],
  ] as [string, "lat" | "long"][])("rejects %s (%s) as Gramps does", (text, kind) => {
    expect(parseCoordinate(text, kind)).toBeNull();
  });

  it("takes O (ouest/oeste/ovest) as west on a longitude", () => {
    expect(parseCoordinate("2°53'44\"O", "long")).toBeCloseTo(-2.89555556, 7);
  });
});

describe("parseCoords", () => {
  it("places DMS text where Gramps does, not at its whole degrees", () => {
    const [lat, long] = parseCoords("42° 41′ 55″ N", "2° 53′ 44″ E")!;
    expect(lat).toBeCloseTo(42.69861111, 7);
    expect(long).toBeCloseTo(2.89555556, 7);
  });

  it("keeps a southern/western DMS sign", () => {
    const [lat, long] = parseCoords("33°52'7.68\"S", "70°40'0\"W")!;
    expect(lat).toBeLessThan(0);
    expect(long).toBeLessThan(0);
  });
});
