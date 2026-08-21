// The map marker and the timeline dot are the same "place" idea rendered in
// two different scales -- a shared path keeps them visually the same mark
// rather than two different shapes that happen to mean the same thing.
// Classic map-pin outline (an "upside-down teardrop": round top, point at
// the bottom), drawn in a 24x24 box with its tip at (12, 24) -- every user
// of this path aligns that tip to the actual point/coordinate it marks.
export const PIN_PATH_D = "M12 0C7.03 0 3 4.03 3 9c0 6.25 9 15 9 15s9-8.75 9-15c0-4.97-4.03-9-9-9z";
